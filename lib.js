'use strict'

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

module.exports = { resolveArgs, detectMode, suggestRedirect, looksLikePII, enforceGuardrail, pickUnusedStance, estimateTokens, needsConfirm, LENS_LIBRARY, LENS_KEYS, countSeedMatches }
