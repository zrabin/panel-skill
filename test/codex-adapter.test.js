// test/codex-adapter.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

function readRepoFile(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
}

test('root skill routes Codex users to the Codex adapter while preserving Claude command path', () => {
  const skill = readRepoFile('SKILL.md')
  assert.match(skill, /Claude Code/)
  assert.match(skill, /Codex/)
  assert.match(skill, /references\/codex\.md/)
  assert.match(skill, /\/panel/)
})

test('Codex adapter documents native orchestration and avoids Claude Workflow invocation', () => {
  const adapter = readRepoFile('references/codex.md')
  assert.match(adapter, /panel-preflight\.js/)
  assert.match(adapter, /spawn_agent/)
  assert.match(adapter, /wait_agent/)
  assert.match(adapter, /serial fallback/i)
  assert.match(adapter, /tool_search/)
  assert.match(adapter, /PII/)
  assert.doesNotMatch(adapter, /Workflow\(\{/)
})

test('README includes Codex installation and optional multi-agent setup', () => {
  const readme = readRepoFile('README.md')
  assert.match(readme, /~\/\.codex\/skills\/panel/)
  assert.match(readme, /\[features\]\s*\nmulti_agent = true/)
  assert.match(readme, /restart Codex/i)
})

test('Codex UI metadata keeps the skill discoverable by name', () => {
  const metadata = readRepoFile('agents/openai.yaml')
  assert.match(metadata, /display_name: "Panel Review"/)
  assert.match(metadata, /default_prompt: "Use \$panel/)
  assert.match(metadata, /allow_implicit_invocation: true/)
})
