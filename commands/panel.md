---
description: Run the diversity-enforced adversarial expert panel on an artifact (Review) or open question (Council)
argument-hint: [review:|council:] [thorough] <file path | pasted content | question>
allowed-tools: Workflow, Bash, Read, Write, Glob
---

Run the expert panel on: `$ARGUMENTS`. Follow exactly.

## 0. Resolve the harness
Locate `panel.js`: try `~/.claude/skills/panel/panel.js`, else Glob `**/panel/panel.js`. If absent, say the skill isn't installed and stop.

## 1. Parse arguments (explicit rules)
- **Mode override:** leading `review:` or `council:` sets mode; strip it. Else mode `auto`.
- **Depth:** default is **light** (cheap: diverse lenses → one batched verification → synthesis; ~6–8 subagents). If the user includes the word `thorough` (or asks for a deep/exhaustive panel), set `thorough: true` and strip the token — this adds per-lens batched skeptics, a completeness critic, and the unanimity loop-back (~10–14 subagents, several× the tokens). Default to light unless thoroughness is explicitly requested.
- **Target type:**
  - existing file path → `Read` it: `content`=body, `target`=path, `title`=filename.
  - else **document-like** (≥2 newlines OR >100 chars) → `content`.
  - else **question** (single line, ≤100 chars, no path separator, often ends `?`) → `question`.
  - empty or genuinely ambiguous → ask the user which they mean. Override prefix always wins.

## 2. Decline gate (spec §3 — do this BEFORE invoking)
Apply the routing table: if the target is blank-page generation, a taste/visual/aesthetic decision, an unscoped question, a web/factual lookup, or a tight iterative loop, **do not run the panel** — tell the user the better tool (brainstorming, frontend-design, deep-research, an iterative build skill) and ask if they still want a panel. The harness also returns `declined` for obvious cases as a backstop; to run anyway, re-invoke with `forcePanel:true` (this overrides ONLY the decline gate, not the cost or PII gates).

## 3. PII gate (spec §8e)
If the resolved `content`/`question` plausibly contains applicant PII (SSN, emails, addresses, "applicant"/DOB), tell the user and ask to confirm before proceeding. Set `piiAck:true` only after they confirm. (The harness also returns `needsPiiConfirm` as a backstop.)

## 4. Invoke (hardened embed — Phase 0 confirmed `args` threading does NOT work via scriptPath)
Per the Phase-0 de-risk note (`args` threading via `scriptPath` returned false), embed args into a hardened scratch copy:
1. `mktemp -d` a `0700` dir; create the scratch file there; `chmod 600` it. Register cleanup immediately so a crash/timeout can't strand a PII-bearing file — e.g. in a Bash step, `trap 'rm -f "$scratch"' EXIT`.
2. `Read` the resolved `panel.js`, replace `const __ARGS = null` with `const __ARGS = <args JSON>;` (args = `{ mode, target, content, question, title, thorough, forcePanel, costAck, piiAck }`, include only what applies), `Write` to the scratch path. (Never edit the committed harness; never write the artifact to a predictable world-readable path.) **If scripting the substitution with JS `String.replace`, pass a replacer FUNCTION (`.replace(needle, () => out)`), never a replacement string — artifacts containing `` $` ``, `$'`, or `$$` (regexes, SQL dollar-quoting) trigger $-substitution and silently corrupt the embedded content** (observed 2026-06-11: a spec's `$$` reached the lenses as `$`, producing a false finding). After writing, verify round-trip: parse the embedded JSON back out and compare lengths.
3. Invoke `Workflow({ scriptPath: "<scratch>" })`.
4. **Delete the scratch file after the run returns** (it may contain PII) — and rely on the `trap` as a backstop if the run errors.

It runs in the background; tell the user and point to `/workflows`. The harness may short-circuit and return `declined` (re-invoke with `forcePanel:true`), `needsPiiConfirm` (`piiAck:true`), or `needsCostConfirm` (`costAck:true`) — relay it and only re-invoke with the matching flag after the user agrees. `forcePanel`, `piiAck`, and `costAck` are independent: each waives only its own gate.

## 5. Relay
If the harness returns `{error, message}` (e.g. `no_mode`, `convene_failed`, `too_few_lenses`, `degraded`), relay the `message` and stop — do not silently retry. If `error` is `synthesis_failed`, tell the user synthesis failed and relay `report_partial` (the raw verified findings) so the run isn't a total loss. Otherwise relay `report` verbatim, then note `depth`, `ran/requested`, and any `loopback`. If a light run surfaced serious issues and the user wants more rigor, offer to re-run with `thorough`. Review → offer to apply edits. Council → surface user-only decisions explicitly. Chat-only unless asked to write back.
