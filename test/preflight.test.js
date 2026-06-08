// test/preflight.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { preflight } = require('../panel-preflight.js')

test('preflight accepts a concrete artifact as light review', () => {
  const result = preflight({ content: 'A concrete spec to review.', title: 'spec.md' })
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'review')
  assert.equal(result.depth, 'light')
  assert.equal(result.title, 'spec.md')
})

test('preflight accepts a scoped open question as council', () => {
  const result = preflight({ question: 'Should we adopt event sourcing given team size and audit needs?' })
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'council')
  assert.equal(result.depth, 'light')
})

test('preflight returns redirect instead of running underspecified question', () => {
  const result = preflight({ question: 'ideas?' })
  assert.equal(result.ok, false)
  assert.equal(result.declined, true)
  assert.match(result.redirect, /brainstorm/i)
})

test('preflight requires PII acknowledgement before proceeding', () => {
  const blocked = preflight({ content: 'Applicant email is ada@example.com.' })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.needsPiiConfirm, true)
  assert.deepEqual(blocked.signals, ['email', 'applicant-term'])

  const acknowledged = preflight({ content: 'Applicant email is ada@example.com.', piiAck: true })
  assert.equal(acknowledged.ok, true)
})

test('preflight requires cost acknowledgement over threshold', () => {
  const blocked = preflight(
    { content: 'x'.repeat(2000) },
    { tokenThreshold: 1 }
  )
  assert.equal(blocked.ok, false)
  assert.equal(blocked.needsCostConfirm, true)
  assert.ok(blocked.estimate > 1)

  const acknowledged = preflight(
    { content: 'x'.repeat(2000), costAck: true },
    { tokenThreshold: 1 }
  )
  assert.equal(acknowledged.ok, true)
})
