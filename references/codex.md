# Codex Adapter

Use this file when the `panel` skill runs in Codex. This is the native Codex
adapter for the panel workflow; it does not invoke the Claude Code Workflow
harness.

## 1. Resolve the Run

Parse the user request the same way as the Claude command:

- Leading `review:` or `council:` forces mode.
- The word `thorough` opts into the thorough run; otherwise use light.
- Existing file path means Review. Read that file as the artifact.
- Pasted document-like text means Review.
- A scoped open question means Council.
- Empty or ambiguous target means ask one short clarification.

Run the decline gate before spending tokens:

| Target | Action |
| --- | --- |
| Blank-page generation / ideation | Decline and route to `superpowers:brainstorming`. |
| Taste, visual, or aesthetic decision | Decline and route to frontend/Figma design tools. |
| Web or factual lookup | Decline and route to deep research or web browsing. |
| Tight create -> react -> revise loop | Decline and route to the iterative build skill. |

The panel is a critic and decider. It needs a concrete artifact or a scoped
question.

## 2. Apply PII and Cost Gates

Before fanning content out to subagents, screen the resolved target:

- If it plausibly contains PII such as emails, addresses, SSNs, applicant data,
  DOB, tenant records, or card-like numbers, tell the user and ask for
  confirmation before proceeding.
- Estimate cost as artifact size times lens count. If the target is large enough
  that the run would be expensive, ask before proceeding. As a rough rule, ask on
  long artifacts above about 25k characters or whenever a thorough run would
  require many repeated reads.

If this repository is available locally, use the shared preflight helper for the
same heuristics as Claude. Resolve `PANEL_SKILL_ROOT` to the skill checkout,
usually `~/.agents/skills/panel`:

```bash
PANEL_SKILL_ROOT="${PANEL_SKILL_ROOT:-$HOME/.agents/skills/panel}"
node "$PANEL_SKILL_ROOT/panel-preflight.js" '{"content":"artifact text","title":"spec.md"}'
```

The helper returns JSON with `ok`, `mode`, `depth`, `title`, `estimate`, and any
gate such as `declined`, `needsPiiConfirm`, or `needsCostConfirm`.

## 3. Convene Lenses

Choose the minimum useful set of genuinely distinct critique lenses, usually 3
to 5. Start from the shipped library:

`skeptic`, `enduser`, `rigor`, `feasibility`, `simplicity`, `risk`,
`completeness`, `strategic`

Add at most 1-2 ad-hoc niche lenses only when the target clearly needs domain
expertise the library lacks. List the selected lenses and one-line rationale
before running them.

Abort rather than reporting thin consensus if fewer than two distinct lenses
make sense.

## 4. Independent Lens Pass

Prefer Codex multi-agent orchestration for a real panel run when the user has
explicitly asked for a panel, subagents, delegation, or parallel expert review.
If the multi-agent tools are not already available, discover them with
`tool_search` using a query like `multi-agent spawn agent wait close subagent
tools`.

For each lens, call `spawn_agent` with a bounded, read-only task. Pass the target
content or exact file path, the selected lens mandate, and the required output
shape. Use `wait_agent` to collect results and `close_agent` when done.

Review mode lens output:

```json
{
  "lens": "risk",
  "findings": [
    {
      "title": "Short issue title",
      "section": "Where this appears",
      "issue": "Concrete problem",
      "severity": "blocker|major|minor|nit",
      "recommendation": "Specific edit or change"
    }
  ]
}
```

Council mode lens output:

```json
{
  "lens": "strategic",
  "recommendation": "Position from this lens",
  "confidence": "high|medium|low",
  "claims": [
    {
      "claim": "Falsifiable claim behind the recommendation",
      "disconfirming_test": "What would prove this wrong"
    }
  ]
}
```

Serial fallback: if subagents are unavailable or tool policy does not permit
spawning, run the same lens prompts one at a time in the main Codex turn and keep
the lens outputs separated until synthesis.

## 5. Pressure-Test

Light run:

- Review: batch all findings and adversarially verify them once. Try to refute
  each finding, then keep, drop, reframe, or rerate severity.
- Council: carry positions forward, but explicitly note weak claims and
  unresolved disagreement.

Thorough run:

- Review: verify each lens's findings separately.
- Council: stress-test each lens's claims against its disconfirming tests.
- Add a completeness critic pass asking what every lens missed.
- If the result is suspiciously unanimous, run one unused structurally distinct
  lens once as a loop-back.

Do not verify one subagent per finding. Verification is batched.

## 6. Synthesize

Merge duplicates, rank by real severity, and output only the report the user can
act on.

Review report shape:

1. Verdict line.
2. Blockers: issue plus concrete edit.
3. Majors.
4. Minors/nits.
5. Themes.
6. Diversity note with lenses run, degraded status if any, and loop-back status.

Council report shape:

1. Recommendation and confidence.
2. Key tradeoffs.
3. Dissent / minority report.
4. Diversity note with lenses run, degraded status if any, and loop-back status.

For Review, offer to apply the edits after reporting. For Council, surface any
decision that only the user can make.
