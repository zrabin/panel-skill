export const meta = {
  name: 'panel-review',
  description: 'Diversity-enforced adversarial multi-lens expert panel (Review/Council).',
  phases: [{ title: 'Convene' }, { title: 'Independent' }, { title: 'Pressure-test' }, { title: 'Synthesize' }],
}

// __LIB__

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
  { label: 'convene', phase: 'Convene', schema: SELECT_SCHEMA }
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
  return agent(p, { label: `lens:${l.key}`, phase: 'Independent', schema: MODE === 'review' ? FINDINGS_SCHEMA : POSITION_SCHEMA }).catch(() => null)
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
    { label, phase: 'Pressure-test', schema: BATCH_VERDICT_SCHEMA }
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
      { label: `pressure:${p.lens}`, phase: 'Pressure-test', schema: COUNCIL_POSITION_SCHEMA }
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
    { label: 'completeness', phase: 'Synthesize', schema: FINDINGS_SCHEMA }
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
      { label: stance ? `loopback:${stance}` : 'loopback:assumption', phase: 'Synthesize',
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
  { label: 'synthesize', phase: 'Synthesize' }
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
