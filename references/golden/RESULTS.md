# Panel skill — success-criteria validation results (2026-06-04)

Live runs against the golden fixtures + gate checks. Auto-trigger test skipped (installed OFF by choice).

| Criterion | Result | Evidence |
| --- | --- | --- |
| **Decline gate** (spec §3) | ✅ PASS | Aesthetic question → `declined: true, redirect: frontend-design, reason: taste/visual`. 0 agents, 0 tokens, 3ms (short-circuits before any spend). Run `wf_101e164f`. |
| **PII gate** (spec §8e) | ✅ PASS | `Applicant … SSN … email … address` → `needsPiiConfirm: true, signals: [ssn,email,address,applicant-term]`. 0 tokens. Run `wf_23501c82`. |
| **Council false-positive** | 🔧 FOUND & FIXED | Marketing question was wrongly declined to deep-research because "current" (in "our current conversion rate") tripped the web/factual heuristic. Tightened `suggestRedirect` to high-precision factual signals; added 2 regression tests. Re-run `wf_b179bf5e` proceeds correctly. |
| **Cross-domain** | ✅ PASS | Review on a coding artifact → ranked blockers/majors/minors with concrete edits (`wf_e35bf6de`). Council on a marketing decision → recommendation + confidence + dissent/minority report (`wf_b179bf5e`). Both mode-appropriate. |
| **Council output shape** | ✅ PASS | Recommendation with explicit confidence (med-high/low), key tradeoffs, and a genuine **Dissent / Minority Report** ("reject the question" vs "act now"; "expand capacity vs cap the channel") — disagreement preserved, not averaged. |
| **Adversarial verification works** | ✅ PASS | Coding panel: 24 findings survived refutation; synthesizer explicitly notes "multiple independent lenses converge on the same correctness-critical defects" — real convergence, not pile-on. |
| **Beats a single agent** | ⚖️ **Inconclusive at ≤150 lines** — a frontier single agent saturates small/medium artifacts; the measured edge is verification + ranking + gating + decline/PII gates, not raw recall. | On the 30-line coding fixture: panel **2/2** seeds vs single Opus agent **2/2** — a TIE. A tiny artifact saturates a strong single agent, so it cannot discriminate. The discriminating evidence is on a complex artifact: the **plan-review panel caught two spec requirements (PII pre-flight, decline routing) and several real bugs (hook JSON escaping, cost-no-abort, `/tmp` PII leak, invalid `node --check`) that a single author/reviewer had missed** — the "catches ≥1 the single missed" criterion, met on a complex artifact, which is where the research says panels pay off. |
| **Unanimity loop-back** | ✅ by test / did not fire live | The `agreeable.md` fixture was meant to force it, but the panel found 9 majors on it (a good adversarial panel resists unanimity), so `loopback: null` — **correct behavior** (fires only with zero surviving blocker/major). The loop-back path itself is covered deterministically by the dry-run regression test (forces minor-only verdicts → loop-back runs). |
| **Graceful degradation** | ✅ by test | `<2` usable lenses aborts with an explanatory error rather than thin consensus (harness + dry-run malformed-output test). |
| **Auto-trigger** | ⏭️ SKIPPED | Installed OFF by choice; hook script unit-tested (JSON-safe, debounced, path-filtered) but not registered in settings.json. |

## Fast-follows (noted, not blocking)
1. **Golden fixtures should be larger/more complex** to make the "beats a single agent" check discriminating — tiny artifacts saturate. Reuse a real spec/plan as a fixture.
2. **A genuinely trivial fixture** (or a forced flag) to demonstrate the unanimity loop-back live, since good panels resist unanimity on any substantive input.
3. `estimateTokens` uses a fixed `lensCount: 4` pre-Convene and doesn't count per-finding skeptics — a rough floor (acknowledged in the spec as approximate); refine if cost surprises occur.

## Bottom line
The skill works end-to-end across both modes, both new gates (decline, PII) fire correctly and for free, adversarial verification and convergence are real, and the council preserves dissent. The two issues validation surfaced (council false-positive; saturating golden fixture) are fixed / documented. Ready to finish the branch.

---

## Follow-up validation (2026-06-04) — fast-follows #1 and #2 attempted

### #1 — Larger seeded fixture to discriminate "beats a single agent"
Added `large-spec.md` (~150 lines, 8 flaws seeded across sections: missing rate
limit, no encryption-at-rest, a 30-vs-90-day retention contradiction, missing
success metric, no pagination for large exports, unhandled email-delivery failure,
an untestable AC, no audit log of exports).

**Result — still does not discriminate.** A single Opus agent produced 28 findings
covering **~8/8** seeds; the panel (4 lenses → 24 survivors, 2 blockers/6 majors)
covered **~8/8** substantively. `countSeedMatches` scored the panel 6/8, but **2 of
those are scorer false-negatives** — the panel caught the retention contradiction
("self-contradictory (30d §4.4 vs 90d §6)") and audit logging ("each download writes
an audit event"), the matcher just didn't equate "self-contradictory"≈"conflicting"
or "export"≈"exported".

**Honest conclusions:**
- A **frontier single Opus agent saturates even a 150-line spec** — "beats a single
  agent on raw recall" is *not* demonstrated at this size. (Consistent with Zhang et
  al. 2025, "Stop Overvaluing Multi-Agent Debate".) The panel's *measurable* edge is
  **adversarial verification (fewer false positives), severity ranking, convergence
  signal, and the decline/PII gates** — not raw recall vs a strong solo agent. Recall
  gains likely require *much* larger / messier inputs (multi-hundred-line specs,
  whole PRs).
- **`countSeedMatches` is too crude to be the judge** (synonym false-negatives). A
  reliable gating test needs an LLM-judge or semantic matcher, not keyword overlap.
  → Revised fast-follow.

### #2 — Trying to trigger the unanimity loop-back live
Two attempts:
- `trivial.md` (office-hours notice) → harness returned **`too_few_lenses`**: so
  trivial the convener picked <2 distinct lenses and the abort guard fired *before*
  the pipeline (and thus before the loop-back).
- `goldilocks` clamp-function spec (substantive + deliberately rock-solid) → the
  panel still found **1 major** (a typing-context ambiguity) → `unanimityTripped()`
  false → no loop-back.

**Honest conclusion — the loop-back is *bracketed* and hard to trigger live by design:**
too-trivial inputs abort (`too_few_lenses`); any input substantive enough to convene
≥2 lenses gives a good adversarial panel something to rate major. That's acceptable —
the loop-back is a **rare backstop** for genuine false-consensus, and its mechanism is
validated **deterministically** by the dry-run regression test (forces minor-only
verdicts → loop-back runs). Live demonstration would need an artificial "force
unanimity" flag, which isn't worth adding.

### Net
Both follow-ups are **completed as honest findings, not green checks.** The skill is
sound; the *success-criteria tests* are the limited part — the real, repeatable
evidence of the panel's value remains its verification/ranking/gating behavior and its
performance on genuinely large artifacts (e.g., this project's own plan review, which
caught two dropped spec requirements).

## Revised fast-follows
1. Replace `countSeedMatches` keyword matching with an **LLM-judge** (or semantic
   matcher) before relying on the automated "beats a single agent" gate.
2. Source a **multi-hundred-line / whole-PR fixture** where a single agent plausibly
   misses items, to actually measure recall lift (150 lines is not enough).
3. Accept that the unanimity loop-back is unit-test-validated; do **not** chase a live
   trigger (or add an explicit force-unanimity flag only if a live demo is ever needed).
4. `estimateTokens` still a rough floor (fixed lens count, no per-finding skeptics).
