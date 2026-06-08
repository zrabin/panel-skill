// test/cursor-adapter.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

function readRepoFile(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
}

test('root skill routes Cursor users to the Cursor adapter', () => {
  const skill = readRepoFile('SKILL.md')
  assert.match(skill, /Cursor/)
  assert.match(skill, /references\/cursor\.md/)
  assert.doesNotMatch(skill, /Cursor:\*\* no first-class adapter ships yet/)
})

test('Cursor project rule is an MDC agent-requested adapter', () => {
  const rule = readRepoFile('.cursor/rules/panel.mdc')
  assert.match(rule, /^---\n/)
  assert.match(rule, /description: Run the panel skill/)
  assert.match(rule, /alwaysApply: false/)
  assert.match(rule, /references\/cursor\.md/)
  assert.match(rule, /panel-preflight\.js/)
  assert.doesNotMatch(rule, /\.cursorrules/)
})

test('Cursor adapter documents serial orchestration and shared preflight', () => {
  const adapter = readRepoFile('references/cursor.md')
  assert.match(adapter, /Project Rules/)
  assert.match(adapter, /\.cursor\/rules\/panel\.mdc/)
  assert.match(adapter, /panel-preflight\.js/)
  assert.match(adapter, /serial/i)
  assert.match(adapter, /PII/)
  assert.doesNotMatch(adapter, /Workflow\(\{/)
})

test('README includes Cursor installation through project rules', () => {
  const readme = readRepoFile('README.md')
  assert.match(readme, /\.cursor\/rules\/panel\.mdc/)
  assert.match(readme, /Cursor project/i)
  assert.match(readme, /legacy `.cursorrules`/i)
})
