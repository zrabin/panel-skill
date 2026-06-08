# Cursor Adapter

Use this file when the `panel` skill runs in Cursor. Cursor integration is a
Project Rules adapter: install `.cursor/rules/panel.mdc` into a Cursor project,
then trigger it by asking for a panel review or council.

The Cursor adapter does not invoke the Claude Code Workflow harness.

## 1. Install as a Project Rule

Cursor Project Rules live in `.cursor/rules` as `.mdc` files. Install the panel
rule into each Cursor project that should have panel access:

```bash
PANEL_SKILL_ROOT="${PANEL_SKILL_ROOT:-$HOME/Documents/github/panel}"
mkdir -p .cursor/rules
ln -sfn "$PANEL_SKILL_ROOT/.cursor/rules/panel.mdc" .cursor/rules/panel.mdc
```

Use Project Rules rather than the legacy `.cursorrules` file.

## 2. Resolve the Run

Parse the user request like the other adapters:

- Leading `review:` or `council:` forces mode.
- The word `thorough` opts into the thorough run; otherwise use light.
- Existing file path means Review. Read that file as the artifact.
- Pasted document-like text means Review.
- A scoped open question means Council.
- Empty or ambiguous target means ask one short clarification.

Run the decline gate before spending tokens:

| Target | Action |
| --- | --- |
| Blank-page generation / ideation | Decline and route to brainstorming. |
| Taste, visual, or aesthetic decision | Decline and route to design tools. |
| Web or factual lookup | Decline and route to web research. |
| Tight create -> react -> revise loop | Decline and route to an iterative build workflow. |

The panel is a critic and decider. It needs a concrete artifact or a scoped
question.

## 3. Apply Shared Preflight

When the panel skill checkout is available, use the shared helper so Cursor gets
the same mode, redirect, PII, and cost decisions as Claude Code and Codex:

```bash
PANEL_SKILL_ROOT="${PANEL_SKILL_ROOT:-$HOME/Documents/github/panel}"
node "$PANEL_SKILL_ROOT/panel-preflight.js" '{"content":"artifact text","title":"spec.md"}'
```

The helper returns JSON with `ok`, `mode`, `depth`, `title`, `estimate`, and any
gate such as `declined`, `needsPiiConfirm`, or `needsCostConfirm`.

If the helper is unavailable, manually apply the same checks:

- Ask before proceeding if the target plausibly contains PII such as emails,
  addresses, SSNs, applicant data, DOB, tenant records, or card-like numbers.
- Ask before proceeding on long artifacts above about 25k characters or whenever
  a thorough run would require many repeated reads.

## 4. Convene Lenses

Choose the minimum useful set of genuinely distinct critique lenses, usually 3
to 5. Start from the shipped library:

`skeptic`, `enduser`, `rigor`, `feasibility`, `simplicity`, `risk`,
`completeness`, `strategic`

Add at most 1-2 ad-hoc niche lenses only when the target clearly needs domain
expertise the library lacks. List the selected lenses and one-line rationale
before running them.

Abort rather than reporting thin consensus if fewer than two distinct lenses
make sense.

## 5. Independent Lens Pass

Cursor Project Rules provide persistent instructions, not a built-in panel
runtime. Run lenses serially in the same chat unless the active Cursor
environment provides an explicit parallel-agent mechanism.

For each lens, keep the pass independent:

- Do not let later lenses see earlier lens conclusions.
- Use only the target and that lens's mandate.
- Store outputs separately until synthesis.

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

## 6. Pressure-Test

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

Do not verify one agent per finding. Verification is batched.

## 7. Synthesize

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
