// test/golden.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { countSeedMatches } = require('../lib.js')

test('countSeedMatches does fuzzy keyword matching', () => {
  const seeds = ['no error handling on the network call', 'unbounded retry loop']
  const text = 'The fetch has no error handling on the network call; also the retry loop is unbounded.'
  assert.equal(countSeedMatches(text, seeds), 2)
})
