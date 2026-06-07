# Panel Expert-Review Skill — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision note (v2):** revised after a panel review of v1 (run `w2np626pk`). Fixed two dropped spec requirements (PII pre-flight; decline/redirect routing), real bugs (hook JSON escaping; cost-guard didn't abort; synth crash → no return; `/tmp` PII leak; `node --check` is invalid for a Workflow harness), and brittleness (replaced the lib-mirror+drift-test with a generated `build-panel.js`; recalibrated `estimateTokens`). Phase 0 is now a real gate. Collapsed 11→8 phases.

**Goal:** Build `panel` — a cross-project Claude Code skill that runs a diversity-enforced, adversarial, multi-lens expert panel over any artifact (Review mode) or open question (Council mode), then synthesizes ranked, edit-ready output — while declining tasks it is wrong for and screening for PII.

**Architecture:** Deterministic logic lives in a pure, unit-tested `lib.js`. The Workflow harness `panel.js` is **generated** from `panel.template.js` + `lib.js` by `build-panel.js` (Workflow scripts can't `require` local files, so the lib is inlined at build time — no manual copy-paste). A `/panel` command resolves args, applies the decline + PII gates, and invokes `Workflow` (preferring the `args` parameter; hardened `/tmp` embedding only as a tested fallback). `SKILL.md` carries intent triggers for natural-language invocation. A guarded, debounced PostToolUse hook auto-triggers on new specs/plans.

**Tech Stack:** Node.js **≥18** (built-in `node:test`, `node:vm`), plain JavaScript (no deps), Claude Code skills/commands/hooks, the `Workflow` tool.

**Spec:** `docs/superpowers/specs/2026-06-04-panel-skill-design.md` — read it first.

**Harness-testing note (important):** a Workflow harness has `export const meta` **and** a top-level `return`. That combination is invalid in plain Node (`node --check` will fail), so we never `node --check panel.js`. Instead the orchestration is validated by (a) a `vm`-based **dry-run test** that mocks the Workflow globals and asserts the pipeline reaches `return` without throwing, and (b) the real end-to-end run in Phase 8. Deterministic logic is fully unit-tested in `lib.js`.

---

## File Structure

All paths inside `~/Documents/github/panel/` unless noted.

| File | Responsibility |
| --- | --- |
| `lib.js` | Pure, tested logic + lens library (single source of truth). CommonJS (`module.exports`). |
| `panel.template.js` | The harness orchestration with a `// __LIB__` injection marker. Not run directly. |
| `build-panel.js` | Generates `panel.js` = template with `lib.js` body inlined at `// __LIB__`. |
| `panel.js` | **Generated** Workflow harness. Committed, but always reproducible via `build-panel.js`. |
| `test/lib.test.js` | Unit tests for every `lib.js` function. |
| `test/build.test.js` | Asserts committed `panel.js` equals a fresh build (never stale). |
| `test/dry-run.test.js` | `vm`-based harness dry-run with mocked Workflow globals. |
| `test/golden.test.js` | Automated golden-set scoring (panel vs single-agent seed-match counts). |
| `commands/panel.md` | `/panel` command. Symlinked to `~/.claude/commands/panel.md`. |
| `hooks/on-doc-write.sh` | Auto-trigger hook (path-filtered, debounced, JSON-safe, PII-prescreened). |
| `hooks/README.md` | How to disable the hook. |
| `SKILL.md` | Skill entry + intent triggers + routing/decline table. |
| `references/golden/` | Validation fixtures + seeded-flaw answer key. |
| `docs/superpowers/{specs,plans}/…` | Spec + this plan. |

**Install symlinks (Phase 7):** `~/.claude/skills/panel → repo` and `~/.claude/commands/panel.md → repo/commands/panel.md`.

---

## Phase 0 — Gated de-risk (real pass/fail, not notes)

### Task 0: Spikes that must PASS before building

**Files:** Create `docs/superpowers/notes/2026-06-04-derisk.md` (records results + the confirmed contracts).

- [ ] **Step 1: Node preflight.**

Run: `node --version` (must be ≥18) and `node -e "require('node:test'); require('node:vm'); console.log('node ok')"`
Expected: `node ok`. If not, STOP and ask the user to upgrade Node.

- [ ] **Step 2: Live substrate spike (proves dynamic lenses + Stage-4 conditional spawn + `args` threading).**

Write a throwaway Workflow that: (a) reads its input from the `args` parameter (NOT `__ARGS`), (b) spawns one `agent()` with a schema, (c) conditionally spawns a second `agent()` based on the first's output. Invoke it **via `Workflow({ script, args: {...} })`** (the `args` param, not embedding).
Record in the note: does `args` threading work? (PASS → command prefers `args`, skipping the `/tmp` embed entirely. FAIL → command uses the hardened embed fallback in Task 11.) Confirm conditional spawn works.
If the whole spike fails, STOP — the substrate doesn't support the design.

- [ ] **Step 3: Hook contract assertion.**

Use the `update-config` skill (or `claude-code-guide`) to confirm the **exact** PostToolUse contract, and record it as two concrete shapes in the note:
- stdin JSON includes `tool_name` and `tool_input.file_path`.
- stdout JSON `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"…"}}` injects context.
If the real contract differs, record the real one — Tasks 13/14 reference this note as the source of truth. If context-injection isn't supported by PostToolUse at all, record the supported alternative (e.g., `Stop` hook) and adapt Task 13.

- [ ] **Step 4: Measure a fresh cost baseline.**

From the substrate spike (or a tiny 2-lens panel run), record approximate tokens/agent so `estimateTokens` (Task 4) can be calibrated against a **freshly measured** number, not the historical 790k. Note the number.

- [ ] **Step 5: Commit the note.**

```bash
cd ~/Documents/github/panel
git add docs/superpowers/notes/2026-06-04-derisk.md
git commit -m "chore(derisk): gated spikes — substrate/args, hook contract, fresh cost baseline"
```

---

## Phase 1 — `lib.js` pure logic + tests

> Prerequisite for all of Phase 1: Node ≥18 (Task 0 Step 1).

### Task 1: `resolveArgs` + `detectMode`

**Files:** Create `lib.js`, `test/lib.test.js`.

- [ ] **Step 1: Write the failing test.**

```javascript
// test/lib.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { resolveArgs, detectMode } = require('../lib.js')

test('resolveArgs prefers threaded args, falls back to embedded, else {}', () => {
  assert.deepEqual(resolveArgs({ a: 1 }, { b: 2 }), { a: 1 })
  assert.deepEqual(resolveArgs(undefined, { b: 2 }), { b: 2 })
  assert.deepEqual(resolveArgs(undefined, null), {})
})
test('detectMode: artifact => review, question => council, else null', () => {
  assert.equal(detectMode({ path: '/x/spec.md' }), 'review')
  assert.equal(detectMode({ content: 'doc body' }), 'review')
  assert.equal(detectMode({ question: 'should we ship X given constraints A,B,C?' }), 'council')
  assert.equal(detectMode({}), null)
})
```

- [ ] **Step 2: Run to verify it fails.**

Run: `cd ~/Documents/github/panel && node --test`
Expected: FAIL — `Cannot find module '../lib.js'`.

- [ ] **Step 3: Implement.**

```javascript
// lib.js
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

module.exports = { resolveArgs, detectMode }
```

- [ ] **Step 4: Run to verify it passes.**

Run: `cd ~/Documents/github/panel && node --test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
cd ~/Documents/github/panel && git add lib.js test/lib.test.js && git commit -m "feat(lib): resolveArgs + detectMode"
```

### Task 2: `suggestRedirect` (the decline/routing gate — spec §3)

**Files:** Modify `lib.js`, `test/lib.test.js`.

- [ ] **Step 1: Write the failing test (append).**

```javascript
const { suggestRedirect } = require('../lib.js')

test('suggestRedirect declines taste/aesthetic questions -> frontend-design', () => {
  const r = suggestRedirect({ question: 'what aesthetic should the site have?' })
  assert.ok(r && r.decline && /frontend-design/.test(r.redirect))
})
test('suggestRedirect declines factual/web questions -> deep-research', () => {
  const r = suggestRedirect({ question: 'what are the latest 2026 SEO statistics?' })
  assert.ok(r && r.decline && /deep-research/.test(r.redirect))
})
test('suggestRedirect declines tiny/unscoped questions -> brainstorming', () => {
  const r = suggestRedirect({ question: 'ideas?' })
  assert.ok(r && r.decline && /brainstorm/i.test(r.redirect))
})
test('suggestRedirect passes a real constrained question (null)', () => {
  assert.equal(suggestRedirect({ question: 'should we adopt event sourcing given our team size, latency SLA, and audit needs?' }), null)
})
test('suggestRedirect never declines an artifact', () => {
  assert.equal(suggestRedirect({ content: 'a doc to review' }), null)
  assert.equal(suggestRedirect({ path: '/x/plan.md' }), null)
})
```

- [ ] **Step 2: Run to verify it fails.**

Run: `cd ~/Documents/github/panel && node --test`
Expected: FAIL — `suggestRedirect is not a function`.

- [ ] **Step 3: Implement (add to `lib.js`, export it).**

```javascript
// Lightweight backstop for the spec §3 "When NOT to use" routing. Catches the
// OBVIOUS decline cases for bare questions; the command/skill still applies the
// full routing-table judgment. Artifacts are always reviewable (never declined).
function suggestRedirect({ question = '', content = '', path = '' } = {}) {
  if (path || (content && content.trim())) return null
  const q = String(question).toLowerCase().trim()
  if (!q) return null
  if (/\b(aesthetic|visual|look ?and ?feel|colou?r|palette|font|typography|brand(ing| identity)?|design language|vibe|styling)\b/.test(q))
    return { decline: true, redirect: 'frontend-design (scope first with superpowers:brainstorming)', reason: 'taste/visual decision' }
  if (/\b(latest|current|today|right now|this year|2026|statistics|market size|how many|who won|recent|news)\b/.test(q))
    return { decline: true, redirect: 'deep-research', reason: 'web/factual question' }
  if (q.split(/\s+/).length <= 6)
    return { decline: true, redirect: 'superpowers:brainstorming', reason: 'underspecified / unscoped' }
  return null
}
```

Add to `module.exports`.

- [ ] **Step 4: Run to verify it passes.**

Run: `cd ~/Documents/github/panel && node --test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
cd ~/Documents/github/panel && git add lib.js test/lib.test.js && git commit -m "feat(lib): suggestRedirect decline/routing gate (spec §3)"
```

### Task 3: `looksLikePII` (the PII pre-flight — spec §8e)

**Files:** Modify `lib.js`, `test/lib.test.js`.

- [ ] **Step 1: Write the failing test (append).**

```javascript
const { looksLikePII } = require('../lib.js')

test('looksLikePII flags SSN, email, applicant terms; clears plain text', () => {
  assert.equal(looksLikePII('SSN 123-45-6789').hit, true)
  assert.equal(looksLikePII('contact jane@doe.com').hit, true)
  assert.equal(looksLikePII('the applicant date of birth is unknown').hit, true)
  assert.equal(looksLikePII('a normal design spec about caching').hit, false)
})
test('looksLikePII returns the matched signals', () => {
  const r = looksLikePII('SSN 123-45-6789 email a@b.co')
  assert.ok(r.signals.includes('ssn') && r.signals.includes('email'))
})
```

- [ ] **Step 2: Run to verify it fails.**

Run: `cd ~/Documents/github/panel && node --test`
Expected: FAIL — `looksLikePII is not a function`.

- [ ] **Step 3: Implement (add to `lib.js`, export it).**

```javascript
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
```

Add to `module.exports`.

- [ ] **Step 4: Run to verify it passes.**

Run: `cd ~/Documents/github/panel && node --test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
cd ~/Documents/github/panel && git add lib.js test/lib.test.js && git commit -m "feat(lib): looksLikePII pre-flight heuristic (spec §8e)"
```

### Task 4: `enforceGuardrail`, `pickUnusedStance`, `estimateTokens`, `needsConfirm`

**Files:** Modify `lib.js`, `test/lib.test.js`.

- [ ] **Step 1: Write the failing test (append).**

```javascript
const { enforceGuardrail, pickUnusedStance, estimateTokens, needsConfirm } = require('../lib.js')

test('enforceGuardrail dedupes (case-insensitive), caps, drops empties', () => {
  const { selected, dropped } = enforceGuardrail(
    [{ key: 'Risk' }, { key: 'risk' }, { key: '' }, { key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }], 5)
  assert.deepEqual(selected.map(l => l.key), ['Risk', 'a', 'b', 'c', 'd'])
  assert.ok(dropped.some(d => d.reason === 'duplicate key'))
  assert.ok(dropped.some(d => d.reason === 'missing key'))
})
test('pickUnusedStance returns first unused priority, case-insensitive, else null', () => {
  const LIB = ['skeptic', 'risk', 'simplicity']
  assert.equal(pickUnusedStance(LIB, ['Risk'], ['risk', 'simplicity', 'skeptic']), 'simplicity')
  assert.equal(pickUnusedStance(LIB, ['risk', 'simplicity', 'skeptic'], ['risk', 'simplicity']), null)
})
test('estimateTokens grows with size/lenses and lands near the measured baseline', () => {
  assert.ok(estimateTokens({ artifactChars: 40000, lensCount: 5 }) > estimateTokens({ artifactChars: 2000, lensCount: 3 }))
  const est = estimateTokens({ artifactChars: 24000, lensCount: 5 })
  assert.ok(est > 400000 && est < 1500000, `out of band: ${est}`)
})
test('needsConfirm fires at/above threshold', () => {
  assert.equal(needsConfirm(750000, 700000), true)
  assert.equal(needsConfirm(500000, 700000), false)
})
```

- [ ] **Step 2: Run to verify it fails.**

Run: `cd ~/Documents/github/panel && node --test`
Expected: FAIL — functions undefined.

- [ ] **Step 3: Implement (add all four to `lib.js`, export them).**

```javascript
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
```

Add all four to `module.exports`.

- [ ] **Step 4: Run to verify it passes.**

Run: `cd ~/Documents/github/panel && node --test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
cd ~/Documents/github/panel && git add lib.js test/lib.test.js && git commit -m "feat(lib): guardrail, unused-stance, recalibrated cost estimate"
```

### Task 5: Lens library

**Files:** Modify `lib.js`, `test/lib.test.js`.

- [ ] **Step 1: Write the failing test (append).**

```javascript
const { LENS_LIBRARY, LENS_KEYS } = require('../lib.js')

test('lens library: 6–8 lightweight stances, well-formed', () => {
  assert.ok(LENS_KEYS.length >= 6 && LENS_KEYS.length <= 8)
  for (const k of LENS_KEYS) {
    const l = LENS_LIBRARY[k]
    assert.ok(l.name && l.mandate && l.catches && Array.isArray(l.questions) && l.questions.length >= 2)
    assert.ok(l.mandate.length < 240, `lens ${k} mandate too long`)
  }
})
```

- [ ] **Step 2: Run to verify it fails.**

Run: `cd ~/Documents/github/panel && node --test`
Expected: FAIL — `LENS_LIBRARY` undefined.

- [ ] **Step 3: Implement (add to `lib.js`, export `LENS_LIBRARY` + `LENS_KEYS`).**

```javascript
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
```

Add `LENS_LIBRARY` and `LENS_KEYS` to `module.exports`.

- [ ] **Step 4: Run to verify it passes.**

Run: `cd ~/Documents/github/panel && node --test`
Expected: PASS (full `lib.js` suite green).

- [ ] **Step 5: Commit.**

```bash
cd ~/Documents/github/panel && git add lib.js test/lib.test.js && git commit -m "feat(lib): 8-stance lens library"
```

---

## Phase 2 — Build infra (generate `panel.js` from template + lib)

### Task 6: `build-panel.js` + build idempotency test

**Files:** Create `panel.template.js` (stub for now), `build-panel.js`, `test/build.test.js`.

- [ ] **Step 1: Create a minimal `panel.template.js` stub.**

```javascript
export const meta = {
  name: 'panel-review',
  description: 'Diversity-enforced adversarial multi-lens expert panel (Review/Council).',
  phases: [{ title: 'Convene' }, { title: 'Independent' }, { title: 'Pressure-test' }, { title: 'Synthesize' }],
}

// __LIB__

// orchestration appended in Phase 3
```

- [ ] **Step 2: Write `build-panel.js`.**

```javascript
// build-panel.js — generates panel.js by inlining lib.js into panel.template.js.
// Workflow scripts cannot require() local files, so the lib is inlined at build.
const fs = require('node:fs')
const path = require('node:path')
function buildSource() {
  const libRaw = fs.readFileSync(path.join(__dirname, 'lib.js'), 'utf8')
  const libBody = libRaw
    .replace(/^'use strict'\n/, '')
    .replace(/\nmodule\.exports = \{[\s\S]*\}\s*$/, '')
    .trim()
  const tpl = fs.readFileSync(path.join(__dirname, 'panel.template.js'), 'utf8')
  if (!tpl.includes('// __LIB__')) throw new Error('panel.template.js missing // __LIB__ marker')
  return tpl.replace('// __LIB__', libBody)
}
if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, 'panel.js'), buildSource())
  console.log('built panel.js')
}
module.exports = { buildSource }
```

- [ ] **Step 3: Write the build idempotency test.**

```javascript
// test/build.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { buildSource } = require('../build-panel.js')

test('committed panel.js matches a fresh build (run `node build-panel.js`)', () => {
  const onDisk = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8')
  assert.equal(onDisk, buildSource(), 'panel.js is stale — run `node build-panel.js` and commit')
})
```

- [ ] **Step 4: Build and run tests.**

Run: `cd ~/Documents/github/panel && node build-panel.js && node --test`
Expected: prints `built panel.js`; all tests PASS (build test confirms panel.js == fresh build).

- [ ] **Step 5: Commit.**

```bash
cd ~/Documents/github/panel && git add panel.template.js build-panel.js panel.js test/build.test.js && git commit -m "feat(build): generate panel.js from template + lib (no manual mirror)"
```

---

## Phase 3 — Harness orchestration (in `panel.template.js`) + dry-run test

### Task 7: Resolve → decline → PII → cost-abort → Stages 1–4

**Files:** Modify `panel.template.js`, then rebuild.

- [ ] **Step 1: Replace everything after the `// __LIB__` marker in `panel.template.js` with the full orchestration.**

```javascript
// ---- arg / mode / decline / PII / cost resolution ----
const __ARGS = null
const a = resolveArgs(typeof args !== 'undefined' ? args : undefined, __ARGS)
// a: { mode?, target?, content?, question?, title?, costAck?, piiAck? }

const redirect = suggestRedirect({ question: a.question, content: a.content, path: a.target })
if (redirect && !a.costAck) {
  return { declined: true, redirect: redirect.redirect, reason: redirect.reason,
    message: `panel: this looks like a ${redirect.reason}; better handled by ${redirect.redirect}. Re-invoke with costAck:true to force a panel anyway.` }
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

// ---- Stage 3: Pressure-test ----
const VERDICT_SCHEMA = { type: 'object', additionalProperties: false, required: ['verdict', 'adjusted_severity', 'rationale', 'refined_recommendation'], properties: {
  verdict: { type: 'string', enum: ['confirmed', 'rejected', 'reframe'] },
  adjusted_severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit', 'drop'] },
  rationale: { type: 'string' }, refined_recommendation: { type: 'string' } } }
const COUNCIL_POSITION_SCHEMA = { type: 'object', additionalProperties: false, required: ['lens', 'survived', 'notes', 'recommendation', 'confidence'], properties: {
  lens: { type: 'string' }, recommendation: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  survived: { type: 'boolean' }, notes: { type: 'string' } } }

phase('Pressure-test')
let reviewSurvivors = []
let councilPositions = []
if (MODE === 'review') {
  const verified = await parallel(independent.flatMap(r => (r.findings || []).map(f => () =>
    agent(`${TARGET_BLOCK}\n\nReviewer (lens ${r.lens}) raised:\nTITLE: ${f.title}\nSECTION: ${f.section}\nISSUE: ${f.issue}\nCLAIMED: ${f.severity}\nFIX: ${f.recommendation}\n\nADVERSARIALLY VERIFY. First TRY TO REFUTE (wrong? already handled? misread?). Then RE-RATE severity honestly (use "drop" if it shouldn't be reported). If real but mis-stated, verdict "reframe" + fix it. ${SEVERITY}`,
      { label: `verify:${r.lens}:${f.title.slice(0, 22)}`, phase: 'Pressure-test', schema: VERDICT_SCHEMA }
    ).then(v => ({ lens: r.lens, finding: f, verdict: v })).catch(() => null)))
  )
  reviewSurvivors = verified.filter(v => v && v.verdict && v.verdict.verdict !== 'rejected' && v.verdict.adjusted_severity !== 'drop')
  log(`Pressure-test: ${reviewSurvivors.length} findings survived`)
} else {
  councilPositions = (await parallel(independent.map(p => () =>
    agent(`The question: ${QUESTION}\n\nYour position (lens ${p.lens}): ${p.recommendation} (confidence ${p.confidence}).\nClaims + disconfirming tests:\n${(p.claims || []).map((c, i) => `${i + 1}. CLAIM: ${c.claim}\n   TEST: ${c.disconfirming_test}`).join('\n')}\n\nMentally run each disconfirming test against what you know (you are NOT executing code). Report whether your recommendation SURVIVES, what the tests showed, and your (possibly revised) recommendation + confidence. Be honest if a test undercuts you.`,
      { label: `pressure:${p.lens}`, phase: 'Pressure-test', schema: COUNCIL_POSITION_SCHEMA }
    ).catch(() => null)))).filter(Boolean)
  log(`Pressure-test: ${councilPositions.length} positions stress-tested`)
}

// ---- Stage 4: Completeness + unanimity loop-back + synthesize ----
phase('Synthesize')
const digest = MODE === 'review'
  ? reviewSurvivors.map((v, i) => `${i + 1}. [${v.lens}/${v.verdict.adjusted_severity}] ${v.finding.title} — ${v.verdict.refined_recommendation || v.finding.recommendation}`).join('\n')
  : councilPositions.map((p, i) => `${i + 1}. [${p.lens}/${p.confidence}/${p.survived ? 'survived' : 'weakened'}] ${p.recommendation}`).join('\n')

const completeness = await agent(
  `${TARGET_BLOCK}\n\nThe panel produced:\n${digest || '(nothing)'}\n\nYou are the COMPLETENESS CRITIC. What did every lens collectively MISS? Return 1–4 net-new findings only. ${SEVERITY}`,
  { label: 'completeness', phase: 'Synthesize', schema: FINDINGS_SCHEMA }
).catch(() => null)
const completenessFindings = (completeness && completeness.findings) || []

function unanimityTripped() {
  if (MODE === 'review') return reviewSurvivors.filter(v => ['blocker', 'major'].includes(v.verdict.adjusted_severity)).length === 0
  return new Set(councilPositions.map(p => p.recommendation.trim().toLowerCase().slice(0, 40))).size <= 1
}
let loopbackNote = ''
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

const synthInput = MODE === 'review'
  ? reviewSurvivors.map((v, i) => `${i + 1}. ${v.lens}/${v.verdict.adjusted_severity}: ${v.finding.title} @ ${v.finding.section} — ${v.verdict.refined_recommendation || v.finding.recommendation}`).join('\n')
  : councilPositions.map((p, i) => `${i + 1}. ${p.lens}/${p.confidence}/${p.survived}: ${p.recommendation} (${p.notes})`).join('\n')
const compInput = completenessFindings.map((f, i) => `C${i + 1}. ${f.severity}: ${f.title} @ ${f.section} — ${f.recommendation}`).join('\n')
const degraded = ranLenses < selected.length

const report = await agent(
  MODE === 'review'
    ? `SYNTHESIZER for a panel review of "${TITLE}". Markdown report: 1) Verdict line. 2) Blockers (issue + concrete edit; merge dupes). 3) Majors. 4) Minors/nits. 5) Themes (2–3 sentences). 6) Diversity note (one line; loop-back: "${loopbackNote || 'none'}").${degraded ? ` 7) NOTE: degraded — ${ranLenses}/${selected.length} lenses.` : ''}\n\nVERIFIED:\n${synthInput || '(none)'}\n\nCOMPLETENESS/LOOPBACK:\n${compInput || '(none)'}\n\nNo padding. This is the edit plan.`
    : `SYNTHESIZER for a council on:\n${QUESTION}\n\nMarkdown report: 1) Recommendation + confidence. 2) Key tradeoffs. 3) Dissent / minority report (never smooth over disagreement). 4) Diversity note (loop-back: "${loopbackNote || 'none'}").${degraded ? ` 5) NOTE: degraded — ${ranLenses}/${selected.length}.` : ''}\n\nPOSITIONS:\n${synthInput}\n\nADDITIONAL:\n${compInput || '(none)'}`,
  { label: 'synthesize', phase: 'Synthesize' }
).catch(() => null)

return {
  mode: MODE, title: TITLE, lenses: usedKeysSoFar, ran: ranLenses, requested: selected.length,
  loopback: loopbackNote || null,
  counts: MODE === 'review' ? { survivors: reviewSurvivors.length, completeness: completenessFindings.length } : { positions: councilPositions.length },
  report: report || '(synthesis failed — see survivors)\n' + (synthInput || ''),
}
```

- [ ] **Step 2: Rebuild and run unit tests.**

Run: `cd ~/Documents/github/panel && node build-panel.js && node --test`
Expected: `built panel.js`; lib + build tests PASS. (Dry-run test added next.)

- [ ] **Step 3: Commit.**

```bash
cd ~/Documents/github/panel && git add panel.template.js panel.js && git commit -m "feat(harness): full pipeline — decline+PII+cost gates, stages 1–4, catch+fallback"
```

### Task 8: `vm`-based dry-run test (orchestration reaches `return`)

**Files:** Create `test/dry-run.test.js`.

- [ ] **Step 1: Write the dry-run test.**

```javascript
// test/dry-run.test.js — run panel.js in a vm with mocked Workflow globals and
// assert the pipeline reaches return without throwing. (panel.js has `export`
// + top-level `return`, so it can't be required directly — vm-wrap it.)
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function mockAgent(label) {
  const l = String(label || '')
  if (l.startsWith('convene')) return { rationale: 'distinct', lenses: [
    { key: 'rigor', source: 'library', why: 'logic' }, { key: 'risk', source: 'library', why: 'failure modes' }, { key: 'simplicity', source: 'library', why: 'cut' }] }
  if (l.startsWith('lens:')) return { lens: l.split(':')[1], findings: [
    { title: 'x', section: 's', issue: 'i', severity: 'major', recommendation: 'fix' }] }
  if (l.startsWith('verify:')) return { verdict: 'confirmed', adjusted_severity: 'major', rationale: 'r', refined_recommendation: 'fix' }
  if (l.startsWith('pressure:')) return { lens: 'x', recommendation: 'do it', confidence: 'medium', survived: true, notes: 'n' }
  if (l.startsWith('completeness')) return { lens: 'completeness', findings: [] }
  if (l.startsWith('loopback')) return { findings: [] }
  if (l.startsWith('synthesize')) return '# Report\nverdict: ok'
  return {}
}

async function run(args) {
  let src = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8').replace(/^export const meta/m, 'const meta')
  const ctx = {
    args, Math, JSON, console,
    log: () => {}, phase: () => {},
    agent: async (_p, opts) => mockAgent(opts && opts.label),
    parallel: async (thunks) => Promise.all(thunks.map(t => t())),
    pipeline: async () => [],
  }
  return vm.runInNewContext(`(async () => {\n${src}\n})()`, ctx, { timeout: 5000 })
}

test('review pipeline reaches a report', async () => {
  const r = await run({ mode: 'review', content: 'a real doc body to review', title: 't' })
  assert.ok(r && typeof r.report === 'string' && r.mode === 'review')
})
test('council pipeline reaches a report', async () => {
  const r = await run({ mode: 'council', question: 'should we adopt X given constraints A, B, and C in detail?' })
  assert.ok(r && r.mode === 'council')
})
test('decline gate returns a redirect for an aesthetic question', async () => {
  const r = await run({ question: 'what aesthetic should the site have?' })
  assert.ok(r && r.declined && /frontend-design/.test(r.redirect))
})
test('PII gate asks for confirm', async () => {
  const r = await run({ mode: 'review', content: 'applicant SSN 123-45-6789' })
  assert.ok(r && r.needsPiiConfirm)
})
```

- [ ] **Step 2: Run to verify (build first).**

Run: `cd ~/Documents/github/panel && node build-panel.js && node --test`
Expected: PASS — all four dry-run cases plus lib/build tests.

- [ ] **Step 3: Commit.**

```bash
cd ~/Documents/github/panel && git add test/dry-run.test.js && git commit -m "test(harness): vm dry-run — pipeline + decline/PII gates"
```

---

## Phase 4 — `/panel` command

### Task 9: `commands/panel.md`

**Files:** Create `commands/panel.md`.

- [ ] **Step 1: Write the command.**

````markdown
---
description: Run the diversity-enforced adversarial expert panel on an artifact (Review) or open question (Council)
argument-hint: [review:|council:] <file path | pasted content | question>
allowed-tools: Workflow, Bash, Read, Glob
---

Run the expert panel on: `$ARGUMENTS`. Follow exactly.

## 0. Resolve the harness
Locate `panel.js`: try `~/.claude/skills/panel/panel.js`, else Glob `**/panel/panel.js`. If absent, say the skill isn't installed and stop.

## 1. Parse arguments (explicit rules)
- **Mode override:** leading `review:` or `council:` sets mode; strip it. Else mode `auto`.
- **Target type:**
  - existing file path → `Read` it: `content`=body, `target`=path, `title`=filename.
  - else **document-like** (≥2 newlines OR >100 chars) → `content`.
  - else **question** (single line, ≤100 chars, no path separator, often ends `?`) → `question`.
  - empty or genuinely ambiguous → ask the user which they mean. Override prefix always wins.

## 2. Decline gate (spec §3 — do this BEFORE invoking)
Apply the routing table: if the target is blank-page generation, a taste/visual/aesthetic decision, an unscoped question, a web/factual lookup, or a tight iterative loop, **do not run the panel** — tell the user the better tool (brainstorming, frontend-design, deep-research, an iterative build skill) and ask if they still want a panel. The harness also returns `declined` for obvious cases as a backstop.

## 3. PII gate (spec §8e)
If the resolved `content`/`question` plausibly contains applicant PII (SSN, emails, addresses, "applicant"/DOB), tell the user and ask to confirm before proceeding. Set `piiAck:true` only after they confirm. (The harness also returns `needsPiiConfirm` as a backstop.)

## 4. Invoke (hardened embed — Phase 0 confirmed `args` threading does NOT work via scriptPath)
Per the Phase-0 de-risk note (`args` threading via `scriptPath` returned false), embed args into a hardened scratch copy:
1. `mktemp -d` a `0700` dir; create the scratch file there; `chmod 600` it.
2. `Read` the resolved `panel.js`, replace `const __ARGS = null` with `const __ARGS = <args JSON>;`, `Write` to the scratch path. (Never edit the committed harness; never write the artifact to a predictable world-readable path.)
3. Invoke `Workflow({ scriptPath: "<scratch>" })`.
4. **Delete the scratch file after the run returns** (it may contain PII).

It runs in the background; tell the user and point to `/workflows`. If the harness returns `needsCostConfirm`/`needsPiiConfirm`/`declined`, relay it and only re-invoke with the matching ack after the user agrees.

## 5. Relay
Relay `report` verbatim, then note `ran/requested` and any `loopback`. Review → offer to apply edits. Council → surface user-only decisions explicitly. Chat-only unless asked to write back.
````

- [ ] **Step 2: Verify front-matter + key references.**

Run: `cd ~/Documents/github/panel && node -e "const t=require('fs').readFileSync('commands/panel.md','utf8');const m=t.match(/^---\n([\s\S]*?)\n---/);if(!m||!/description:/.test(m[1]))throw new Error('bad front-matter');for(const s of ['panel.js','__ARGS','piiAck','mktemp','Decline gate'])if(!t.includes(s))throw new Error('missing '+s);console.log('command OK')"`
Expected: `command OK`.

- [ ] **Step 3: Commit.**

```bash
cd ~/Documents/github/panel && git add commands/panel.md && git commit -m "feat(command): /panel with decline + PII gates, args-first invoke, hardened fallback"
```

---

## Phase 5 — SKILL.md

### Task 10: `SKILL.md`

**Files:** Create `SKILL.md`.

- [ ] **Step 1: Write `SKILL.md` (triggers + routing/decline + modes).**

```markdown
---
name: panel
description: >-
  Run a diversity-enforced, adversarial, multi-lens "expert panel" over a document
  (Review mode) or an open question (Council mode), then synthesize ranked,
  edit-ready feedback. Use whenever the user asks to convene a panel, run a panel
  review, get a panel of experts / multiple expert perspectives, stress-test or
  pressure-test a doc/plan/spec/decision, "spin up subagents to review from
  relevant POVs and synthesize," or get red-team / devil's-advocate feedback.
  Triggers on phrasings like "let's have the panel review (this)", "convene a
  panel", "panel this", "get expert eyes on this", "run the panel", even
  mid-conversation or as an answer to a question. Artifacts → Review; open
  questions → Council. Do NOT use for blank-page generation, taste/visual/aesthetic
  decisions, unscoped questions, web fact-finding (use deep-research), or tight
  iterative create-revise loops — decline and redirect per the routing table.
---

# Panel — Expert Panel Review

Convene several genuinely distinct critique lenses, review blind and in parallel,
adversarially pressure-test, then synthesize. Diversity + verification are the
levers (not persona detail).

## Running it
The skill IS the `/panel` command. When invoked by name or natural language, run
`/panel` against the artifact or question under discussion (resolve the target from
the conversation; ask if ambiguous). The command handles mode detection, the
decline + PII gates, the cost guard, and the Workflow invocation.

## When NOT to use (decline + redirect)
| Task | Use instead |
| --- | --- |
| Blank-page generation / ideation | superpowers:brainstorming, frontend-design |
| Taste / visual / aesthetic decisions | frontend-design, Figma skills, visual companion |
| Unscoped / underspecified question | brainstorming first, then optionally panel |
| Web fact-finding | deep-research |
| Tight create → react → revise loop | an iterative build skill, then panel the result |

The panel is a critic and decider, not a generator — it needs something concrete to
react to. In a design project it sits downstream: generate options first, then panel them.

## Output
- **Review:** ranked findings (blockers → majors → minors), each anchored with a
  concrete edit; themes; diversity/unanimity note.
- **Council:** recommendation + confidence, key tradeoffs, explicit dissent/minority report.

See `docs/superpowers/specs/2026-06-04-panel-skill-design.md` for the full design.
```

- [ ] **Step 2: Verify front-matter.**

Run: `cd ~/Documents/github/panel && node -e "const t=require('fs').readFileSync('SKILL.md','utf8');const m=t.match(/^---\n([\s\S]*?)\n---/);if(!m||!/name:\s*panel/.test(m[1]))throw new Error('bad');console.log('SKILL.md OK')"`
Expected: `SKILL.md OK`.

- [ ] **Step 3: Commit.**

```bash
cd ~/Documents/github/panel && git add SKILL.md && git commit -m "feat(skill): SKILL.md triggers + routing/decline table"
```

---

## Phase 6 — Auto-trigger hook

### Task 11: Hook script (JSON-safe, debounced, PII-prescreened) + test

**Files:** Create `hooks/on-doc-write.sh`.

- [ ] **Step 1: Write the hook (use the contract confirmed in Task 0 Step 3).**

```bash
#!/usr/bin/env bash
# PostToolUse hook: on a new Superpowers spec/plan write, inject a "run panel"
# instruction. Path-filtered, debounced per file+mtime, JSON-safe, PII-prescreened.
set -euo pipefail
input="$(cat)"

get() { printf '%s' "$input" | (jq -r "$1 // empty" 2>/dev/null || true); }
path="$(get '.tool_input.file_path')"
if [ -z "$path" ]; then
  path="$(printf '%s' "$input" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
fi

case "$path" in
  *"/docs/superpowers/specs/"*.md|*"/docs/superpowers/plans/"*.md) ;;
  *) exit 0 ;;
esac
[ -f "$path" ] || exit 0

mtime="$(stat -f %m "$path" 2>/dev/null || stat -c %Y "$path" 2>/dev/null || echo 0)"
marker="/tmp/panel-autotrigger-$(printf '%s' "$path-$mtime" | shasum | cut -d' ' -f1)"
[ -f "$marker" ] && exit 0
: > "$marker"

# PII pre-screen: if the file looks like it has PII, ask rather than auto-run.
pii_note=""
if grep -Eiq '([0-9]{3}-[0-9]{2}-[0-9]{4})|(applicant)|(date of birth)|([[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,})' "$path"; then
  pii_note=" The file may contain PII — confirm with the user before fanning it out (pass piiAck only after they agree)."
fi

msg="A new Superpowers document was written at $path. Per the panel skill's auto-trigger (ON by default), run the expert panel on it: invoke /panel review: $path . Announce the auto-run and respect the cost/PII guards.$pii_note If the user just asked you to panel this same file, do not double-run."

# JSON-safe: encode the message with jq (fallback: python) so quotes/paths can't break it.
if command -v jq >/dev/null 2>&1; then
  esc="$(printf '%s' "$msg" | jq -Rs .)"
else
  esc="$(printf '%s' "$msg" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')"
fi
printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":$esc}}"
exit 0
```

- [ ] **Step 2: Make executable + lint + JSON-validity test (including a path with a quote).**

```bash
cd ~/Documents/github/panel
chmod +x hooks/on-doc-write.sh
bash -n hooks/on-doc-write.sh && echo "syntax OK"
d="$(mktemp -d)/docs/superpowers/specs"; mkdir -p "$d"; f="$d/x.md"; echo "# t" > "$f"
out="$(printf '{"tool_input":{"file_path":"%s"}}' "$f" | hooks/on-doc-write.sh)"
echo "$out" | (jq . >/dev/null && echo "first-fire JSON valid")
echo "second fire (debounced, expect empty):"; printf '{"tool_input":{"file_path":"%s"}}' "$f" | hooks/on-doc-write.sh
echo "non-spec path (expect empty):"; printf '{"tool_input":{"file_path":"/tmp/x.txt"}}' | hooks/on-doc-write.sh
```
Expected: `syntax OK`; `first-fire JSON valid`; the second and third fires print nothing.

- [ ] **Step 3: Commit.**

```bash
cd ~/Documents/github/panel && git add hooks/on-doc-write.sh && git commit -m "feat(hook): auto-trigger — JSON-safe, debounced, path-filtered, PII-prescreened"
```

### Task 12: Register hook (default ON) + disable doc

**Files:** Modify `~/.claude/settings.json`; create `hooks/README.md`.

- [ ] **Step 1: Register via `update-config` (with manual fallback).**

Use the `update-config` skill to add (append to `PostToolUse` if it exists):

```json
{ "hooks": { "PostToolUse": [ { "matcher": "Write",
  "hooks": [ { "type": "command", "command": "~/.claude/skills/panel/hooks/on-doc-write.sh" } ] } ] } }
```

**If `update-config` is unavailable:** open `~/.claude/settings.json`, add the block above manually (merge into any existing `hooks.PostToolUse` array), and show the user the exact diff for their approval (audit trail per spec).

- [ ] **Step 2: Validate settings JSON.**

```bash
node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.claude/settings.json','utf8'));console.log('settings valid')"
```
Expected: `settings valid`.

- [ ] **Step 3: Write + commit the disable doc.**

```bash
cd ~/Documents/github/panel
printf '%s\n' '# Hook: panel auto-trigger' '' 'ON by default. Disable by removing the `on-doc-write.sh` PostToolUse entry from `~/.claude/settings.json` (use the update-config skill, or edit manually).' > hooks/README.md
git add hooks/README.md && git commit -m "docs(hook): how to disable the auto-trigger"
```

---

## Phase 7 — Install (symlinks)

### Task 13: Symlink skill + command

**Files:** symlinks only.

- [ ] **Step 1: Create symlinks.**

```bash
mkdir -p ~/.claude/skills ~/.claude/commands
ln -sfn ~/Documents/github/panel ~/.claude/skills/panel
ln -sfn ~/Documents/github/panel/commands/panel.md ~/.claude/commands/panel.md
```

- [ ] **Step 2: Verify.**

```bash
test -f ~/.claude/skills/panel/panel.js && test -f ~/.claude/skills/panel/SKILL.md && test -f ~/.claude/commands/panel.md && echo "symlinks OK"
```
Expected: `symlinks OK`.

- [ ] **Step 3: Record.**

```bash
cd ~/Documents/github/panel && git commit --allow-empty -m "chore: install panel skill+command symlinks"
```

---

## Phase 8 — Validation against success criteria

### Task 14: Golden fixtures + automated scoring test

**Files:** Create `references/golden/{coding-artifact.md,product-spec.md,marketing-question.md,agreeable.md,SEEDED.json}`, `test/golden.test.js`.

- [ ] **Step 1: Write fixtures + a machine-readable seed key.**

Each artifact ~15–40 lines. `SEEDED.json`: `{ "coding-artifact.md": ["no error handling on the network call","unbounded retry loop"], "product-spec.md": ["missing success metric","no failure-mode AC"] }` — the known issues, as short matchable phrases.

- [ ] **Step 2: Write the scoring helper test (pure, deterministic).**

```javascript
// test/golden.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { countSeedMatches } = require('../lib.js')

test('countSeedMatches does fuzzy keyword matching', () => {
  const seeds = ['no error handling on the network call', 'unbounded retry loop']
  const text = 'The fetch has no error handling; also the retry loop is unbounded.'
  assert.equal(countSeedMatches(text, seeds), 2)
})
```

- [ ] **Step 3: Implement `countSeedMatches` in `lib.js` (export it), rebuild, run tests.**

```javascript
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
```
Run: `cd ~/Documents/github/panel && node build-panel.js && node --test`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
cd ~/Documents/github/panel && git add references/golden lib.js panel.js test/golden.test.js && git commit -m "test(golden): fixtures + countSeedMatches scoring helper"
```

### Task 15: Run the success-criteria checks (live)

**Files:** Create `references/golden/RESULTS.md`.

- [ ] **Step 1: Gating check — beats a single agent.** Run `/panel review: references/golden/coding-artifact.md`; separately have one Opus agent review the same file. Use `countSeedMatches` against `SEEDED.json` for both. PASS if panel ≥ single AND panel catches ≥1 the single missed. Repeat for `product-spec.md`. Record counts in `RESULTS.md`.
- [ ] **Step 2: Cross-domain.** Run Review on the coding + spec fixtures and Council on `marketing-question.md`; confirm mode-appropriate output. (If the marketing question is phrased as taste/aesthetic, confirm it is **declined+redirected** instead — that is also a PASS for the decline gate.)
- [ ] **Step 3: Unanimity loop-back.** Run `/panel review: references/golden/agreeable.md`; PASS if `loopback` is non-null and fired once (`/workflows` shows one `loopback:*`).
- [ ] **Step 4: PII gate.** Run `/panel` on a small fixture containing `SSN 123-45-6789`; PASS if it returns `needsPiiConfirm` and only proceeds after `piiAck`.
- [ ] **Step 5: Decline gate.** Invoke with the question "what aesthetic should the site have?"; PASS if it declines and redirects to frontend-design (no panel runs).
- [ ] **Step 6: NL + auto-trigger no-double-fire.** (a) Without typing `/panel`, say "let's have the panel review references/golden/product-spec.md" → confirm auto-invoke. (b) Write a new file under a `docs/superpowers/specs/` path → confirm the hook injects the instruction once and doesn't double-fire if you also ask manually.
- [ ] **Step 7: Record + commit.**

```bash
cd ~/Documents/github/panel && git add references/golden/RESULTS.md && git commit -m "test(golden): success-criteria validation results"
```

---

## Self-Review (v2)

- **Panel-feedback coverage:** PII pre-flight → Tasks 3, 7, 9, 11, 15(4). Decline routing + detectMode fix → Tasks 2, 7, 9, 15(5). Hook JSON escaping → Task 11. Phase-0 gate (substrate/args/contract/cost) → Task 0. Cost-abort → Task 7. Synth/completeness `.catch`+fallback → Task 7. `/tmp` PII leak → Task 9 (args-first, hardened+unlinked fallback). Args-vs-embed → Tasks 0, 9. Lib-mirror replaced by build step → Tasks 6, dry-run via vm → Task 8. estimateTokens recalibrated → Task 4. Harness dry-run test → Task 8. Automated golden gate → Tasks 14–15. Council schema rename → Task 7. Arg-parse rules → Task 9. Node preflight → Task 0(1). `node --check` removed (invalid for harness) → noted in header + Tasks use build/dry-run instead.
- **Spec coverage:** modes §4 → 7,9,10; pipeline §5 → 7,8; lenses §6 → 5,7; output §7 → 7; invocation §8 (3 paths) → 9,10,11,12; location/substrate §9 → 0,6,13; §8e PII → 3,9,11; §3 decline → 2,9,10.
- **Placeholder scan:** all code complete; only `references/golden/*` fixture *prose* is authored at execution time (test data, shape specified).
- **Type consistency:** lib exports (`resolveArgs/detectMode/suggestRedirect/looksLikePII/enforceGuardrail/pickUnusedStance/estimateTokens/needsConfirm/countSeedMatches/LENS_LIBRARY/LENS_KEYS`) used consistently; harness reads match the schemas; `buildSource` used by both `build-panel.js` and `test/build.test.js`.
- **Consciously deferred:** coverage-map-ranked loop-back stance (kept simple priority array); full run-replay audit logging (harness returns lenses/counts/loopback — enough for validation).
