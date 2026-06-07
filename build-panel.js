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
