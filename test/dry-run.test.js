// test/dry-run.test.js — run panel.js in a vm with mocked Workflow globals and
// assert the pipeline reaches return without throwing. (panel.js has `export`
// + top-level `return`, so it can't be required directly — vm-wrap it.)
//
// Covers: light (default) vs thorough depth, the BATCHED verifier (light = 1
// global verify; thorough = 1 per lens), batched drop/rerate, the unanimity
// loop-back (thorough only), the decline/PII gates, and malformed-output safety.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const SRC = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8').replace(/^export const meta/m, 'const meta')

async function runWith(mock, args) {
  const ctx = {
    args, Math, JSON, console,
    log: () => {}, phase: () => {},
    agent: async (_p, opts) => mock(opts && opts.label),
    parallel: async (thunks) => Promise.all(thunks.map(t => t())),
    pipeline: async () => [],
  }
  return vm.runInNewContext(`(async () => {\n${SRC}\n})()`, ctx, { timeout: 5000 })
}

// Generic healthy mock. `verify:*` returns the BATCHED shape {verdicts:[]}, which
// makes verifyBatch keep every finding at its original severity (the default path).
function makeMock({ severity = 'major', verdicts = null } = {}) {
  return function mock(label) {
    const l = String(label || '')
    if (l.startsWith('convene')) return { rationale: 'distinct', lenses: [
      { key: 'rigor', source: 'library', why: 'logic' }, { key: 'risk', source: 'library', why: 'failure modes' }] }
    if (l.startsWith('lens:')) return { lens: l.split(':')[1], findings: [
      { title: 't', section: 's', issue: 'i', severity, recommendation: 'fix' }] }
    if (l.startsWith('verify')) return { verdicts: verdicts || [] }
    if (l.startsWith('pressure:')) return { lens: 'x', recommendation: 'do it', confidence: 'medium', survived: true, notes: 'n' }
    if (l.startsWith('completeness')) return { lens: 'completeness', findings: [] }
    if (l.startsWith('loopback')) return { findings: [] }
    if (l.startsWith('synthesize')) return '# Report\nverdict: ok'
    return {}
  }
}

test('light review (default) reaches a report and reports depth=light', async () => {
  const r = await runWith(makeMock(), { mode: 'review', content: 'a real doc body to review', title: 't' })
  assert.ok(r && typeof r.report === 'string' && r.mode === 'review')
  assert.equal(r.depth, 'light')
})

test('light council (default) reaches a report with no separate stress-test agent', async () => {
  const r = await runWith(makeMock(), { mode: 'council', question: 'should we adopt X given constraints A, B, and C in detail?' })
  assert.ok(r && typeof r.report === 'string' && r.mode === 'council')
  assert.equal(r.depth, 'light')
})

test('thorough review reaches a report and reports depth=thorough', async () => {
  const r = await runWith(makeMock(), { mode: 'review', thorough: true, content: 'doc body', title: 't' })
  assert.ok(r && typeof r.report === 'string')
  assert.equal(r.depth, 'thorough')
})

test('thorough review with only minor findings fires the unanimity loop-back', async () => {
  // all findings minor → no blocker/major survivors → unanimityTripped() → loop-back runs
  const r = await runWith(makeMock({ severity: 'minor' }), { mode: 'review', thorough: true, content: 'doc body', title: 't' })
  assert.ok(r && typeof r.report === 'string')
  assert.ok(r.loopback, `expected loop-back to fire, got: ${JSON.stringify(r.loopback)}`)
})

test('batched verifier can DROP a finding (survivors reflect the drop)', async () => {
  // 2 lenses × 1 finding → ids 0-0 and 1-0; drop 1-0, keep 0-0
  const verdicts = [
    { id: '0-0', verdict: 'confirmed', adjusted_severity: 'major' },
    { id: '1-0', verdict: 'rejected', adjusted_severity: 'drop' },
  ]
  const r = await runWith(makeMock({ verdicts }), { mode: 'review', content: 'doc body', title: 't' })
  assert.equal(r.counts.survivors, 1, `expected 1 survivor after drop, got ${r.counts.survivors}`)
})

test('decline gate returns a redirect for an aesthetic question', async () => {
  const r = await runWith(makeMock(), { question: 'what aesthetic should the site have?' })
  assert.ok(r && r.declined && /frontend-design/.test(r.redirect))
})

test('PII gate asks for confirm', async () => {
  const r = await runWith(makeMock(), { mode: 'review', content: 'applicant SSN 123-45-6789' })
  assert.ok(r && r.needsPiiConfirm)
})

test('synthesis failure returns a structured error (not a fake report)', async () => {
  const mock = (label) => {
    const l = String(label || '')
    if (l.startsWith('convene')) return { rationale: 'd', lenses: [
      { key: 'rigor', source: 'library', why: 'a' }, { key: 'risk', source: 'library', why: 'b' }] }
    if (l.startsWith('lens:')) return { lens: l.split(':')[1], findings: [
      { title: 't', section: 's', issue: 'i', severity: 'major', recommendation: 'fix' }] }
    if (l.startsWith('verify')) return { verdicts: [] }
    if (l.startsWith('synthesize')) return null // synthesizer fails
    return {}
  }
  const r = await runWith(mock, { mode: 'review', content: 'doc body', title: 't' })
  assert.equal(r.error, 'synthesis_failed')
  assert.ok(typeof r.report_partial === 'string')
  assert.equal(r.report, undefined)
})

// ---- malformed-output safety (missing required fields must not throw) ----
function mockMalformed(label) {
  const l = String(label || '')
  if (l.startsWith('convene')) return { rationale: 'd', lenses: [
    { key: 'rigor', source: 'library', why: 'logic' }, { key: 'risk', source: 'library', why: 'fm' }] }
  if (l.startsWith('lens:')) return { lens: l.split(':')[1], findings: [{ issue: 'some issue' }] } // no title/section/severity/recommendation
  if (l.startsWith('verify')) return { verdicts: [] } // keep-at-original (which is undefined → defaults)
  if (l.startsWith('pressure:')) return { lens: 'x', survived: true } // no recommendation/confidence/notes
  if (l.startsWith('completeness')) return { lens: 'completeness', findings: [{}] } // empty finding
  if (l.startsWith('loopback')) return { findings: [{}] }
  if (l.startsWith('synthesize')) return '# Report\nok'
  return {}
}

test('light review survives malformed agent output and reaches a report', async () => {
  const r = await runWith(mockMalformed, { mode: 'review', content: 'doc body', title: 't' })
  assert.ok(r && typeof r.report === 'string' && r.mode === 'review')
})
test('thorough council survives malformed agent output and reaches a report', async () => {
  const r = await runWith(mockMalformed, { mode: 'council', thorough: true, question: 'should we adopt X given constraints A, B, and C?' })
  assert.ok(r && typeof r.report === 'string' && r.mode === 'council')
})
