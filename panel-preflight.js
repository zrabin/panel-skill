#!/usr/bin/env node
'use strict'

const {
  detectMode,
  estimateTokens,
  looksLikePII,
  needsConfirm,
  suggestRedirect,
} = require('./lib.js')

function preflight(input = {}, options = {}) {
  const a = input || {}
  const path = a.target || a.path || ''
  const content = typeof a.content === 'string' ? a.content : ''
  const question = typeof a.question === 'string' ? a.question : ''

  const redirect = suggestRedirect({ question, content, path })
  if (redirect && !a.forcePanel) {
    return {
      ok: false,
      declined: true,
      redirect: redirect.redirect,
      reason: redirect.reason,
      message: `panel: this looks like a ${redirect.reason}; better handled by ${redirect.redirect}.`,
    }
  }

  const mode = a.mode && a.mode !== 'auto'
    ? a.mode
    : detectMode({ path, content, question })
  if (!mode) {
    return {
      ok: false,
      error: 'no_mode',
      message: 'panel: provide an artifact (Review) or a question (Council).',
    }
  }

  const title = a.title || path || (question ? question.slice(0, 60) : '(untitled)')
  const pii = looksLikePII(content || question)
  if (pii.hit && !a.piiAck) {
    return {
      ok: false,
      needsPiiConfirm: true,
      signals: pii.signals,
      message: `panel: the target looks like it may contain PII (${pii.signals.join(', ')}).`,
    }
  }

  const lensCount = Number.isInteger(a.lensCount) ? a.lensCount : 4
  const estimate = estimateTokens({ artifactChars: content.length, lensCount })
  const tokenThreshold = options.tokenThreshold == null
    ? (a.tokenThreshold == null ? 700000 : a.tokenThreshold)
    : options.tokenThreshold
  if (needsConfirm(estimate, tokenThreshold) && !a.costAck) {
    return {
      ok: false,
      needsCostConfirm: true,
      estimate,
      message: `panel: estimated ~${Math.round(estimate / 1000)}k tokens (over threshold).`,
    }
  }

  return {
    ok: true,
    mode,
    depth: a.thorough === true ? 'thorough' : 'light',
    title,
    estimate,
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => { data += chunk })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

async function main() {
  try {
    const raw = process.argv[2] || await readStdin()
    const input = raw && raw.trim() ? JSON.parse(raw) : {}
    process.stdout.write(`${JSON.stringify(preflight(input), null, 2)}\n`)
  } catch (err) {
    process.stderr.write(`panel-preflight: ${err.message}\n`)
    process.exitCode = 2
  }
}

if (require.main === module) {
  main()
}

module.exports = { preflight }
