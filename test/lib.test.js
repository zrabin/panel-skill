// test/lib.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { resolveArgs, detectMode } = require('../lib.js')
const { suggestRedirect } = require('../lib.js')
const { looksLikePII } = require('../lib.js')
const { enforceGuardrail, pickUnusedStance, estimateTokens, needsConfirm } = require('../lib.js')
const { LENS_LIBRARY, LENS_KEYS } = require('../lib.js')

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

test('suggestRedirect does NOT false-positive on a decision question mentioning "current ... rate"', () => {
  // regression: the word "current" used to wrongly route strategic questions to deep-research
  const q = 'Should we prioritize an onboarding checklist over a human call, given our current trial-to-paid conversion rate is 11% and support can handle 30 calls/week?'
  assert.equal(suggestRedirect({ question: q }), null)
})
test('suggestRedirect still declines a genuine statistics lookup', () => {
  const r = suggestRedirect({ question: 'what are the newest 2026 SEO statistics across the market?' })
  assert.ok(r && r.decline && /deep-research/.test(r.redirect))
})

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

test('lens library: 6–8 lightweight stances, well-formed', () => {
  assert.ok(LENS_KEYS.length >= 6 && LENS_KEYS.length <= 8)
  for (const k of LENS_KEYS) {
    const l = LENS_LIBRARY[k]
    assert.ok(l.name && l.mandate && l.catches && Array.isArray(l.questions) && l.questions.length >= 2)
    assert.ok(l.mandate.length < 240, `lens ${k} mandate too long`)
  }
})
