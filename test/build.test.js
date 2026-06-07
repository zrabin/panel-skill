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
