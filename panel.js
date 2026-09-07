export const meta = {
  name: 'panel-review',
  description: 'Diversity-enforced adversarial multi-lens expert panel (Review/Council).',
  phases: [{ title: 'Convene' }, { title: 'Independent' }, { title: 'Pressure-test' }, { title: 'Synthesize' }],
}

function resolveArgs(threaded, embedded) {
  if (threaded && Object.keys(threaded).length) return threaded
  return embedded || {}
}

// Low-level mode: artifact => review, else question => council, else null.
// NOTE: the decline decision (suggestRedirect) is applied BEFORE this.
function detectMode({ path, content, question } = {}) {
  const hasArtifact = Boolean(path) || (typeof content === 'string' && content.trim().length > 0)
  if (hasArtifact) return 'review'
  if (typeof question === 'string' && question.trim().length > 0) return 'council'
  return null
}

// Lightweight backstop for the spec §3 "When NOT to use" routing. Catches the
// OBVIOUS decline cases for bare questions; the command/skill still applies the
// full routing-table judgment. Artifacts are always reviewable (never declined).
function suggestRedirect({ question = '', content = '', path = '' } = {}) {
  if (path || (content && content.trim())) return null
  const q = String(question).toLowerCase().trim()
  if (!q) return null
  if (/\b(aesthetic|visual|look ?and ?feel|colou?r|palette|font|typography|brand(ing| identity)?|design language|vibe|styling)\b/.test(q))
    return { decline: true, redirect: 'frontend-design (scope first with superpowers:brainstorming)', reason: 'taste/visual decision' }
  if (/\b(statistics|market size|industry benchmark|how many|who won|state of the art|newest|in the news)\b/.test(q))
    return { decline: true, redirect: 'deep-research', reason: 'web/factual question' }
  if (q.split(/\s+/).length <= 6)
    return { decline: true, redirect: 'superpowers:brainstorming', reason: 'underspecified / unscoped' }
  return null
}

// Calibrated, NON-blocking PII heuristic (spec §8e): a hit triggers a confirm,
// not a refusal. Deliberately catches common signals; false positives are fine
// (the user just confirms). Used by the command (pre-invoke) and hook (pre-inject).
function looksLikePII(text = '') {
  const t = String(text)
  const signals = []
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(t)) signals.push('ssn')
  if (/\b(?:\d[ -]?){13,16}\b/.test(t)) signals.push('card-like')
  if (/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/.test(t)) signals.push('email')
  if (/\b\d{1,5}\s+\w+(?:\s+\w+){0,3}\s+(?:st|street|ave|avenue|rd|road|blvd|lane|ln|dr|drive)\b/i.test(t)) signals.push('address')
  if (/\b(applicant|tenant|date of birth|\bdob\b|household member)\b/i.test(t)) signals.push('applicant-term')
  return { hit: signals.length > 0, signals }
}

function enforceGuardrail(lenses, cap = 5) {
  const seen = new Set(); const selected = []; const dropped = []
  for (const l of lenses || []) {
    const key = l && typeof l.key === 'string' ? l.key.trim() : ''
    if (!key) { dropped.push({ ...l, reason: 'missing key' }); continue }
    const norm = key.toLowerCase()
    if (seen.has(norm)) { dropped.push({ ...l, reason: 'duplicate key' }); continue }
    if (selected.length >= cap) { dropped.push({ ...l, reason: 'over cap' }); continue }
    seen.add(norm); selected.push(l)
  }
  return { selected, dropped }
}

function pickUnusedStance(libraryKeys, usedKeys, priority) {
  const lib = new Set((libraryKeys || []).map(k => k.toLowerCase()))
  const used = new Set((usedKeys || []).map(k => k.toLowerCase()))
  for (const k of (priority && priority.length ? priority : (libraryKeys || []))) {
    const lk = k.toLowerCase()
    if (lib.has(lk) && !used.has(lk)) return k
  }
  return null
}

// Rough, intentionally approximate. Calibrated so a ~24k-char/5-lens run lands
// near the measured baseline (recalibrate the factor in Task 0 Step 4 if needed).
function estimateTokens({ artifactChars = 0, lensCount = 4 } = {}) {
  return Math.round(lensCount * (artifactChars / 4 + 2000) * 18)
}
function needsConfirm(estimate, threshold = 700000) { return estimate >= threshold }

// Modes of critique, not subject-matter experts. Lightweight (a sharp name
// suffices; SPP shows verbose backstories add nothing). Domain specialization
// happens at runtime; niche expertise is ephemeral (added per-run by the Stage-1
// selector), never added here.
const LENS_LIBRARY = {
  skeptic:      { name: 'Skeptic / Devil’s Advocate', mandate: 'Attack the central assumption; find the fatal flaw.', catches: 'load-bearing assumptions that don’t hold; the likeliest reason this fails', questions: ['What must be true for this to work, and is it?', 'What is the strongest case this is wrong?'] },
  enduser:      { name: 'End-User / Audience Advocate', mandate: 'Represent whoever consumes the output.', catches: 'friction, confusion, unmet needs for the real audience', questions: ['Who is this for and what do they need here?', 'Where will they get stuck?'] },
  rigor:        { name: 'Rigor / Correctness', mandate: 'Check internal logic, consistency, whether the argument holds.', catches: 'contradictions, unsupported claims, non-sequiturs', questions: ['Do the parts cohere?', 'Which claim is asserted but unsupported?'] },
  feasibility:  { name: 'Feasibility / Operator', mandate: 'Pressure-test whether this can be built/run under real constraints.', catches: 'unrealistic effort, missing dependencies, operational burden', questions: ['Can this be done with real time/cost/people?', 'What does it assume is available that isn’t?'] },
  simplicity:   { name: 'Simplicity / YAGNI', mandate: 'Find what is over-built and what to cut.', catches: 'machinery for completeness not need; premature generality', questions: ['What is the simplest version that delivers 90%?', 'What can be deleted with no real loss?'] },
  risk:         { name: 'Risk / Failure-modes', mandate: 'Hunt what breaks: edge cases, security, scale.', catches: 'unhandled failure paths, security/PII exposure, scale breakage', questions: ['What goes wrong at the edges or under load?', 'What would an attacker or auditor exploit?'] },
  completeness: { name: 'Completeness / Gaps', mandate: 'Find what is missing — the thing nobody raised.', catches: 'absent sections, unaddressed scenarios, silent omissions', questions: ['What is conspicuously not addressed?', 'What scenario is never mentioned?'] },
  strategic:    { name: 'Strategic / So-what', mandate: 'Judge whether this serves the real goal; is it the right problem?', catches: 'misaligned effort, opportunity cost, wrong problem', questions: ['Does this advance the actual objective?', 'Is there a higher-leverage move?'] },
}
const LENS_KEYS = Object.keys(LENS_LIBRARY)

// Fuzzy: a seed counts as matched if >=60% of its salient words appear in the text.
function countSeedMatches(text = '', seeds = []) {
  const hay = String(text).toLowerCase()
  let n = 0
  for (const seed of seeds) {
    const words = String(seed).toLowerCase().split(/\W+/).filter(w => w.length > 3)
    const hits = words.filter(w => hay.includes(w)).length
    if (words.length && hits / words.length >= 0.6) n++
  }
  return n
}

// ---- arg / mode / decline / PII / cost resolution ----
const __ARGS = null
const a = resolveArgs(typeof args !== 'undefined' ? args : undefined, __ARGS)
// a: { mode?, target?, content?, question?, title?, costAck?, piiAck? }

const redirect = suggestRedirect({ question: a.question, content: a.content, path: a.target })
if (redirect && !a.forcePanel) {
  return { declined: true, redirect: redirect.redirect, reason: redirect.reason,
    message: `panel: this looks like a ${redirect.reason}; better handled by ${redirect.redirect}. Re-invoke with forcePanel:true to run a panel anyway.` }
}

let MODE = (a.mode && a.mode !== 'auto') ? a.mode : detectMode({ path: a.target, content: a.content, question: a.question })
if (!MODE) {
  return { error: 'no_mode', message: 'panel: provide an artifact (Review) or a question (Council).' }
}
const TITLE = a.title || a.target || (a.question ? a.question.slice(0, 60) : '(untitled)')
const ARTIFACT = a.content || ''
const QUESTION = a.question || ''
const LENS_CAP = 5

const pii = looksLikePII(ARTIFACT || QUESTION)
if (pii.hit && !a.piiAck) {
  return { needsPiiConfirm: true, signals: pii.signals,
    message: `panel: the target looks like it may contain PII (${pii.signals.join(', ')}). Re-invoke with piiAck:true to proceed.` }
}

const estimate = estimateTokens({ artifactChars: ARTIFACT.length, lensCount: 4 })
if (needsConfirm(estimate) && !a.costAck) {
  return { needsCostConfirm: true, estimate,
    message: `panel: estimated ~${Math.round(estimate/1000)}k tokens (over threshold). Re-invoke with costAck:true to proceed.` }
}

log(`panel: mode=${MODE} target="${TITLE}" est=~${Math.round(estimate/1000)}k tok`)

const TARGET_BLOCK = MODE === 'review'
  ? `You are reviewing this ARTIFACT titled "${TITLE}":\n\n<artifact>\n${ARTIFACT}\n</artifact>`
  : `The panel is deliberating this OPEN QUESTION:\n\n<question>\n${QUESTION}\n</question>`
const SEVERITY = `SEVERITY: blocker=must-fix/wrong-unsafe; major=should-fix real gap; minor=worth fixing; nit=cosmetic.`

// ---- Stage 1: Convene ----
const LIBRARY_DIGEST = LENS_KEYS.map(k => `- ${k}: ${LENS_LIBRARY[k].name} — ${LENS_LIBRARY[k].mandate}`).join('\n')
const SELECT_SCHEMA = { type: 'object', additionalProperties: false, required: ['lenses', 'rationale'], properties: {
  rationale: { type: 'string' },
  lenses: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'source', 'why'], properties: {
    key: { type: 'string' }, source: { type: 'string', enum: ['library', 'adhoc'] }, why: { type: 'string' }, mandate: { type: 'string' } } } },
} }

phase('Convene')
const selection = await agent(
  `${TARGET_BLOCK}\n\nYou are the PANEL CONVENER. Choose the MINIMUM set of genuinely DISTINCT critique lenses (diversity is the lever; 3 is fine, never exceed ${LENS_CAP}). Draw from the library; invent at most 1–2 ad-hoc niche lenses ONLY if the topic needs expertise the library lacks (source="adhoc", give a one-line mandate). Never pick two lenses that surface the same class of issue.\n\nLIBRARY:\n${LIBRARY_DIGEST}\n\nReturn the chosen lenses (each with the distinct dimension it covers) + a one-line rationale.`,
  { model: 'sonnet', label: 'convene', phase: 'Convene', schema: SELECT_SCHEMA }
).catch(() => null)
if (!selection || !selection.lenses) return { error: 'convene_failed', message: 'panel: lens selection failed.' }

const { selected, dropped } = enforceGuardrail(selection.lenses, LENS_CAP)
if (selected.length < 2) return { error: 'too_few_lenses', message: 'panel: fewer than 2 distinct lenses; aborting rather than reporting thin consensus.' }
const usedKeysSoFar = selected.map(l => l.key)
log(`Convened ${selected.length}: ${usedKeysSoFar.join(', ')}${dropped.length ? ` (dropped ${dropped.length})` : ''} — ${selection.rationale}`)

function lensMandate(l) {
  if (l.source === 'library' && LENS_LIBRARY[l.key]) {
    const x = LENS_LIBRARY[l.key]
    return `LENS: ${x.name}. ${x.mandate} Questions: ${x.questions.join(' / ')}. For THIS target, focus on: ${l.why}.`
  }
  return `LENS (ad-hoc): ${l.key}. ${l.mandate || ''} For THIS target, focus on: ${l.why}.`
}

// ---- Stage 2: Independent ----
const FINDINGS_SCHEMA = { type: 'object', additionalProperties: false, required: ['lens', 'findings'], properties: {
  lens: { type: 'string' },
  findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'section', 'issue', 'severity', 'recommendation'], properties: {
    title: { type: 'string' }, section: { type: 'string' }, issue: { type: 'string' },
    severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] }, recommendation: { type: 'string' } } } },
} }
const POSITION_SCHEMA = { type: 'object', additionalProperties: false, required: ['lens', 'recommendation', 'confidence', 'claims'], properties: {
  lens: { type: 'string' }, recommendation: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  claims: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['claim', 'disconfirming_test'], properties: {
    claim: { type: 'string' }, disconfirming_test: { type: 'string' } } } },
} }

phase('Independent')
const independent = (await parallel(selected.map(l => () => {
  const p = MODE === 'review'
    ? `${TARGET_BLOCK}\n\n${lensMandate(l)}\n\n${SEVERITY}\n\nReview through YOUR lens ONLY. Return 2–6 concrete findings, each anchored to a section with a near-verbatim suggested edit. Set lens to "${l.key}".`
    : `${TARGET_BLOCK}\n\n${lensMandate(l)}\n\nDeliberate through YOUR lens ONLY. Give a recommendation + confidence, and 2–4 FALSIFIABLE claims, each with a disconfirming test. Set lens to "${l.key}".`
  return agent(p, { model: 'opus', label: `lens:${l.key}`, phase: 'Independent', schema: MODE === 'review' ? FINDINGS_SCHEMA : POSITION_SCHEMA }).catch(() => null)
}))).filter(Boolean)
const ranLenses = independent.length
if (ranLenses < 2) return { error: 'degraded', ran: ranLenses, requested: selected.length, message: `panel: only ${ranLenses} lens(es) returned; aborting.` }
log(`Independent: ${ranLenses}/${selected.length} returned`)

// ---- Stage 3: Pressure-test (BATCHED — light: 1 global verifier; thorough: 1 per lens) ----
// Cost control: verification is batched (a verifier rates MANY findings in one call),
// not one agent per finding. Light mode (default) also skips completeness + loop-back.
const THOROUGH = a.thorough === true
const BATCH_VERDICT_SCHEMA = { type: 'object', additionalProperties: false, required: ['verdicts'], properties: {
  verdicts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'verdict', 'adjusted_severity'], properties: {
    id: { type: 'string' }, verdict: { type: 'string', enum: ['confirmed', 'rejected', 'reframe'] },
    adjusted_severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit', 'drop'] }, refined_recommendation: { type: 'string' } } } } } }
const COUNCIL_POSITION_SCHEMA = { type: 'object', additionalProperties: false, required: ['lens', 'survived', 'notes', 'recommendation', 'confidence'], properties: {
  lens: { type: 'string' }, recommendation: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  survived: { type: 'boolean' }, notes: { type: 'string' } } }

// One verifier call over a batch of findings. Missing verdicts default to keep-at-original
// severity (never silently drop a real finding).
async function verifyBatch(findings, label) {
  if (!findings.length) return []
  const list = findings.map(f => `[id ${f.id}] (lens ${f.lens}) TITLE: ${f.title || ''} | SECTION: ${f.section || ''} | ISSUE: ${f.issue || ''} | CLAIMED: ${f.severity || ''} | FIX: ${f.recommendation || ''}`).join('\n')
  const res = await agent(
    `${TARGET_BLOCK}\n\nADVERSARIALLY VERIFY each finding below. For EACH: first TRY TO REFUTE it (wrong? already handled in the artifact? a misreading?), then RE-RATE its severity honestly (use "drop" if it should not be reported; verdict "reframe" if real but mis-stated, and improve the recommendation). Return exactly one verdict per id. ${SEVERITY}\n\nFINDINGS:\n${list}`,
    { model: 'sonnet', label, phase: 'Pressure-test', schema: BATCH_VERDICT_SCHEMA }
  ).catch(() => null)
  const byId = {}
  ;((res && res.verdicts) || []).forEach(v => { if (v && v.id) byId[v.id] = v })
  return findings.map(f => {
    const v = byId[f.id] || { verdict: 'confirmed', adjusted_severity: f.severity || 'minor' }
    return { lens: f.lens, finding: f, verdict: { verdict: v.verdict || 'confirmed', adjusted_severity: v.adjusted_severity || f.severity || 'minor', refined_recommendation: v.refined_recommendation || f.recommendation || '' } }
  })
}

phase('Pressure-test')
let reviewSurvivors = []
let councilPositions = []
if (MODE === 'review') {
  const allFindings = independent.flatMap((r, li) => (r.findings || []).map((f, fi) => ({ ...f, lens: r.lens, id: `${li}-${fi}` })))
  let verified
  if (THOROUGH) {
    const byLens = independent.map((r, li) => allFindings.filter(f => f.id.startsWith(`${li}-`)))
    verified = (await parallel(byLens.map((g, li) => () => verifyBatch(g, `verify:${independent[li].lens}`)))).flat()
  } else {
    verified = await verifyBatch(allFindings, 'verify:all')
  }
  reviewSurvivors = verified.filter(v => v && v.verdict && v.verdict.verdict !== 'rejected' && v.verdict.adjusted_severity !== 'drop')
  log(`Pressure-test (${THOROUGH ? 'thorough' : 'light'}): ${reviewSurvivors.length}/${allFindings.length} findings survived`)
} else if (THOROUGH) {
  councilPositions = (await parallel(independent.map(p => () =>
    agent(`The question: ${QUESTION}\n\nYour position (lens ${p.lens}): ${p.recommendation} (confidence ${p.confidence}).\nClaims + disconfirming tests:\n${(p.claims || []).map((c, i) => `${i + 1}. CLAIM: ${c.claim}\n   TEST: ${c.disconfirming_test}`).join('\n')}\n\nMentally run each disconfirming test against what you know (you are NOT executing code). Report whether your recommendation SURVIVES, what the tests showed, and your (possibly revised) recommendation + confidence. Be honest if a test undercuts you.`,
      { model: 'sonnet', label: `pressure:${p.lens}`, phase: 'Pressure-test', schema: COUNCIL_POSITION_SCHEMA }
    ).catch(() => null)))).filter(Boolean)
  log(`Pressure-test (thorough): ${councilPositions.length} positions stress-tested`)
} else {
  // light council: carry positions forward without a separate stress-test pass
  councilPositions = independent.map(p => ({ lens: p.lens, recommendation: p.recommendation || '', confidence: p.confidence || 'medium', survived: true, notes: '' }))
  log(`Pressure-test (light): ${councilPositions.length} positions`)
}

// ---- Stage 4: (THOROUGH only) completeness + unanimity loop-back; then synthesize ----
phase('Synthesize')
const digest = MODE === 'review'
  ? reviewSurvivors.map((v, i) => `${i + 1}. [${v.lens}/${v.verdict.adjusted_severity}] ${v.finding.title || 'untitled'} — ${v.verdict.refined_recommendation || v.finding.recommendation || ''}`).join('\n')
  : councilPositions.map((p, i) => `${i + 1}. [${p.lens}/${p.confidence || ''}/${p.survived ? 'survived' : 'weakened'}] ${p.recommendation || ''}`).join('\n')

let completenessFindings = []
let loopbackNote = ''
if (THOROUGH) {
  const completeness = await agent(
    `${TARGET_BLOCK}\n\nThe panel produced:\n${digest || '(nothing)'}\n\nYou are the COMPLETENESS CRITIC. What did every lens collectively MISS? Return 1–4 net-new findings only. ${SEVERITY}`,
    { model: 'opus', label: 'completeness', phase: 'Synthesize', schema: FINDINGS_SCHEMA }
  ).catch(() => null)
  completenessFindings = (completeness && completeness.findings) || []

  const unanimityTripped = () => MODE === 'review'
    ? reviewSurvivors.filter(v => ['blocker', 'major'].includes(v.verdict.adjusted_severity)).length === 0
    : new Set(councilPositions.map(p => (p.recommendation || '').trim().toLowerCase().slice(0, 40))).size <= 1
  if (unanimityTripped()) {
    const stance = pickUnusedStance(LENS_KEYS, usedKeysSoFar, ['risk', 'skeptic', 'simplicity', 'strategic', 'completeness'])
    log(`Unanimity tripped — running ${stance || 'assumption probe'}`)
    const probe = await agent(
      stance
        ? `${TARGET_BLOCK}\n\n${lensMandate({ key: stance, source: 'library', why: 'the panel agreed too easily; bring a genuinely different angle' })}\n\nThe rest of the panel found little to disagree on. Surface the strongest real concern they missed. ${MODE === 'review' ? SEVERITY : ''}`
        : `${TARGET_BLOCK}\n\nThe panel reached consensus. Name the strongest SHARED UNQUESTIONED ASSUMPTION beneath it and what happens if it is false.`,
      { model: 'sonnet', label: stance ? `loopback:${stance}` : 'loopback:assumption', phase: 'Synthesize',
        schema: (stance && MODE === 'review') ? FINDINGS_SCHEMA : { type: 'object', additionalProperties: false, required: ['result'], properties: { result: { type: 'string' } } } }
    ).catch(() => null)
    if (stance && MODE === 'review' && probe && probe.findings) { completenessFindings.push(...probe.findings); loopbackNote = `loop-back ran ${stance}; +${probe.findings.length} finding(s).` }
    else if (probe) loopbackNote = `loop-back: ${probe.result || ''}`
    // bounded: fires once.
  }
}

const synthInput = MODE === 'review'
  ? reviewSurvivors.map((v, i) => `${i + 1}. ${v.lens}/${v.verdict.adjusted_severity}: ${v.finding.title || 'untitled'} @ ${v.finding.section || ''} — ${v.verdict.refined_recommendation || v.finding.recommendation || ''}`).join('\n')
  : councilPositions.map((p, i) => `${i + 1}. ${p.lens}/${p.confidence || ''}/${p.survived}: ${p.recommendation || ''} (${p.notes || ''})`).join('\n')
const compInput = completenessFindings.map((f, i) => `C${i + 1}. ${f.severity || ''}: ${f.title || 'untitled'} @ ${f.section || ''} — ${f.recommendation || ''}`).join('\n')
const degraded = ranLenses < selected.length

const report = await agent(
  MODE === 'review'
    ? `SYNTHESIZER for a panel review of "${TITLE}". Markdown report: 1) Verdict line. 2) Blockers (issue + concrete edit; merge dupes). 3) Majors. 4) Minors/nits. 5) Themes (2–3 sentences). 6) Diversity note (one line; loop-back: "${loopbackNote || 'none'}").${degraded ? ` 7) NOTE: degraded — ${ranLenses}/${selected.length} lenses.` : ''}\n\nVERIFIED:\n${synthInput || '(none)'}\n\nCOMPLETENESS/LOOPBACK:\n${compInput || '(none)'}\n\nNo padding. This is the edit plan.`
    : `SYNTHESIZER for a council on:\n${QUESTION}\n\nMarkdown report: 1) Recommendation + confidence. 2) Key tradeoffs. 3) Dissent / minority report (never smooth over disagreement). 4) Diversity note (loop-back: "${loopbackNote || 'none'}").${degraded ? ` 5) NOTE: degraded — ${ranLenses}/${selected.length}.` : ''}\n\nPOSITIONS:\n${synthInput}\n\nADDITIONAL:\n${compInput || '(none)'}`,
  { model: 'opus', label: 'synthesize', phase: 'Synthesize' }
).catch(() => null)

const base = {
  mode: MODE, depth: THOROUGH ? 'thorough' : 'light', title: TITLE, lenses: usedKeysSoFar, ran: ranLenses, requested: selected.length,
  loopback: loopbackNote || null,
  counts: MODE === 'review' ? { survivors: reviewSurvivors.length, completeness: completenessFindings.length } : { positions: councilPositions.length },
}
// Synthesis failure is surfaced as a structured error, never as a normal report.
if (!report) {
  return { ...base, error: 'synthesis_failed', report_partial: synthInput || '(no findings)',
    message: 'panel: the synthesizer failed; returning the raw verified findings as report_partial.' }
}
return { ...base, report }
