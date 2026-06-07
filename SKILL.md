---
name: panel
description: >-
  Run a diversity-enforced, adversarial, multi-lens "expert panel" over a document
  (Review mode) or an open question (Council mode), then synthesize ranked,
  edit-ready feedback. Use whenever the user asks to convene a panel, run a panel
  review, get a panel of experts / multiple expert perspectives, stress-test or
  pressure-test a doc/plan/spec/decision, "spin up subagents to review from
  relevant POVs and synthesize," or get red-team / devil's-advocate feedback.
  Triggers on phrasings like "let's have the panel review (this)", "convene a
  panel", "panel this", "get expert eyes on this", "run the panel", even
  mid-conversation or as an answer to a question. Artifacts → Review; open
  questions → Council. Do NOT use for blank-page generation, taste/visual/aesthetic
  decisions, unscoped questions, web fact-finding (use deep-research), or tight
  iterative create-revise loops — decline and redirect per the routing table.
---

# Panel — Expert Panel Review

Convene several genuinely distinct critique lenses, review blind and in parallel,
adversarially pressure-test, then synthesize. Diversity + verification are the
levers (not persona detail).

## Running it
The skill IS the `/panel` command. When invoked by name or natural language, run
`/panel` against the artifact or question under discussion (resolve the target from
the conversation; ask if ambiguous). The command handles mode detection, the
decline + PII gates, the cost guard, and the Workflow invocation.

## Depth: light (default) vs thorough
Default runs are **light** — diverse lenses → one batched verification pass → synthesis
(~6–8 subagents). Add `thorough` (e.g. "run a thorough panel", `/panel thorough review: …`)
only when the stakes justify it: thorough adds per-lens batched skeptics, a completeness
critic, and the unanimity loop-back (~10–14 subagents, several× the tokens). Don't default
to thorough — most reviews want light.

## When NOT to use (decline + redirect)
| Task | Use instead |
| --- | --- |
| Blank-page generation / ideation | superpowers:brainstorming, frontend-design |
| Taste / visual / aesthetic decisions | frontend-design, Figma skills, visual companion |
| Unscoped / underspecified question | brainstorming first, then optionally panel |
| Web fact-finding | deep-research |
| Tight create → react → revise loop | an iterative build skill, then panel the result |

The panel is a critic and decider, not a generator — it needs something concrete to
react to. In a design project it sits downstream: generate options first, then panel them.

## Output
- **Review:** ranked findings (blockers → majors → minors), each anchored with a
  concrete edit; themes; diversity/unanimity note.
- **Council:** recommendation + confidence, key tradeoffs, explicit dissent/minority report.

See `docs/superpowers/specs/2026-06-04-panel-skill-design.md` for the full design.
