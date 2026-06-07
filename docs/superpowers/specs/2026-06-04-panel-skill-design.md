# Panel — Expert Panel Review Skill (Design)

**Date:** 2026-06-04
**Owner:** the author
**Status:** Design — v2, revised after a dogfood panel review of v1. Pending final
human review before plan.
**Topic:** A reusable Claude Code skill that runs a diversity-enforced, adversarial,
multi-lens "expert panel" over any document or open question, then synthesizes.

> **Revision note (v2):** v1 was reviewed by running this very pipeline on it (Review
> mode, 5 lenses → skeptic verification → completeness critic → synthesis with unanimity
> loop-back). Changes below address the real findings: removed an internal contradiction
> ("always-full rigor" + a `deep` flag), aligned the unanimity loop-back with cited
> research, demoted unverified cost claims, simplified the diversity guardrail and lens
> format, made success criteria testable, and added failure-handling + cost-cap
> requirements. The dogfood run is itself the first success-criteria datapoint.

---

## 1. Problem & Motivation

The author frequently runs an ad-hoc version of this pattern: "spin up a few subagents to
review this from relevant POVs, identify critical errors and opportunities, don't
over-complicate it, synthesize the feedback." It works on *any* topic because Claude
picks the relevant experts per context. But it has no structure: no guard against the
subagents agreeing with each other for the wrong reasons, no step that tries to refute
weak findings, and no disciplined synthesis. The hypothesis going in was "it needs more
*specificity* to be impactful."

Research (see §2) reframed that hypothesis. Specificity of persona is **not** the lever.
**Diversity of perspective** and **adversarial verification + disciplined synthesis** are
the levers. This skill packages those levers around an existing flexible approach.

Two domain-specific review harnesses already existed — running parallel lenses →
adversarial skeptic verification → completeness critic → ranked synthesis. This skill is
the **domain-agnostic generalization** of that proven architecture.

## 2. Research Grounding (what drives the design)

Verified across academic and practitioner sources during the brainstorm, then
independently re-checked against the primary texts:

- **Persona *labels* alone don't improve accuracy** on objective tasks (Zheng et al.
  EMNLP 2024; Wharton "Playing Pretend" 2025; PRISM 2026). Verbose persona backstories
  add nothing beyond a sharp *name* (SPP, NAACL 2024). → Lens definitions stay
  lightweight; no elaborate personas.
- **Diversity of perspective is the active ingredient** for critique tasks. ChatEval
  (ICLR 2024): multi-agent with *identical* roles ≈ single agent; with *diverse* roles,
  accuracy and agreement rise (53.8% → 60.0% on FairEval). Separately, Yang et al. 2026
  (arXiv 2602.03794) find "2 diverse agents can match or exceed 16 homogeneous ones" —
  i.e. genuine diversity lets the panel be *small*. → Enforce genuine diversity; default
  to the minimum set that covers the real dimensions; the cap (below) is a cost guard, not
  a target.
- **Dynamic, model-chosen *selection* beats fixed generic sets** on capable models (SPP),
  and this is *emergent at the Opus/GPT-4 tier*. → Keep dynamic selection; a library is a
  palette, not a constraint. **Caveat:** SPP validates *choosing* lenses dynamically; it
  does **not** validate *inventing ephemeral domain lenses* mid-run. Ephemeral-lens
  generation (§6) is an architecture choice adopted from a domain-specific review harness, not a research
  finding.
- **~3–4 lenses is the sweet spot; quality declines past ~5** (ChatEval, §4.3, verbatim).
  → Hard cap at ~5 as a diminishing-returns + cost guard.
- **Naive multi-agent debate often fails to beat a single strong agent**, and more debate
  rounds *increase* correlated-bias convergence (Zhang et al. 2025, "Stop Overvaluing
  Multi-Agent Debate…"; Liang et al. MAD). → No multi-round debate, ever. Rigor comes from
  adversarial *verification*, not from re-litigating.
- **Unanimity = correlated-bias failure mode.** Adversarial verification is mandatory, and
  unanimity triggers an active counter-probe (§5 Stage 4). The counter-probe is an
  **untested design hypothesis**, flagged as such; validating it is in §10/§11.

*Citation note:* all sources above were independently verified against the primary texts
(arXiv abstracts/PDFs) on 2026-06-04 — no fabricated papers. A few secondary statistics
(specific PRISM and Kong figures) and the Vanderbilt "one agent's hallucination is
accepted by the others" anecdote could **not** be confirmed from accessible text and are
**not** relied upon here. The "labels don't help" position is **contested** — see the
rebuttal "When Expert Personas Exceed Expert Benchmarks" (arXiv 2603.20225). This is why
the design rests on *diversity + verification* (well-supported) rather than on persona
labeling (disputed).

No existing packaged skill (Anthropic, Superpowers, or the third-party
`agent-review-panel` / `council-skill` / `agent-council`) is adopted wholesale; this skill
reuses a proven harness pattern and the research-backed structure.

## 3. Goals & Non-Goals

**Goals**
- One skill, two modes, that works on *any* topic or artifact.
- Encode the proven levers: diversity enforcement, adversarial pressure-testing,
  disciplined synthesis, active unanimity handling.
- Reuse the proven implementation substrate (Workflow harness + command).
- Cross-project, zero domain coupling.

**Non-Goals**
- Not a domain catalog of experts (the over-engineering trap research warns against).
- **Not *initially* a replacement for domain-specific review harnesses.** They share this
  architecture but embed domain lenses, regulatory grounding, and live integrations. Panel
  and those skills coexist; they *may* eventually converge on a shared "panel core +
  domain-lens layer," but that consolidation is out of scope here.
- **Not a research tool.** `deep-research` answers "what is *true* out there?" (web-grounded,
  large fan-out, external queries). Panel's Council mode answers "what should *we* do?"
  (offline, private, judgment over known information). See §4 for the boundary.
- No multi-round debate machinery.

### When NOT to use Panel (and what to use instead)

The panel is a **critic and a decider, not a generator.** It takes something that already
has shape and prunes / refutes / ranks it. It is only productive when **there is something
to react to** — a concrete artifact (Review), or a question constrained enough that lenses
can take *grounded, falsifiable* positions (Council). It is the wrong tool when the task is
generative, taste-based, unscoped, factual, or tightly iterative. Route those elsewhere —
and note that the auto-trigger (§8) and the command should *decline or redirect* rather
than run a low-value panel:

| If the task is… | Why the panel fails | Use instead |
| --- | --- | --- |
| **Blank-page generation / ideation** (e.g. "what aesthetic for this site?") | Critics have nothing to critique; produces incoherent divergence or critiques of an imagined target. Research backs panels for *evaluation*, not open ideation. | `superpowers:brainstorming` (+ visual companion) to scope; `frontend-design` to generate directions |
| **Taste / visual / aesthetic decisions** | No ground truth for the skeptic stage to bite on; better *shown* than *argued in prose* | `frontend-design`, Figma skills, `designing-new-screens`, the visual companion |
| **Underspecified / unscoped** (no product, audience, goal, constraints) | Garbage in — lenses can't take grounded positions | `brainstorming` first to scope, *then* optionally bring the panel back |
| **Factual / empirical** ("what's true out there?") | Offline deliberation can't establish external fact | `deep-research` |
| **Tight create → react → revise loop** | The panel is one-shot critique, not an iterative generator | an iterative build/design skill, then panel the *result* |
| **Low-stakes / answer already known** | Multi-subagent overhead isn't worth it | just ask Claude directly |

**The productive seam:** in a creative/design project the panel sits *downstream* of the
generator, not upstream. Generate and scope first (brainstorming + frontend-design), then
use **Council** to choose among 2–3 concrete options ("given product X, audience Y, goal Z,
which direction, and what are each one's risks?") or **Review** to critique the built
artifact. Generator creates; panel stress-tests and decides. Sequential collaborators, not
alternatives.

## 4. Modes

A single `/panel` command. **Mode is auto-detected by default, with an explicit override
prefix** — auto-detect for zero friction, override to eliminate the rare silent
misclassification:

- **Review mode** — input resolves to a concrete artifact (a file path, or pasted
  content): spec.md, plan.md, PRD, design doc, essay, code. The panel critiques the
  artifact. Forced via `/panel review: <path-or-content>`.
- **Council mode** — input is an open-ended question with no artifact ("what methodology
  designs a website for virality?"). The panel deliberates and recommends. Forced via
  `/panel council: <question>`.

Auto-detection: a file path or pasted document body → Review; a bare question → Council.
The detected mode is **announced before the panel spends tokens**, and if the input is
genuinely ambiguous (a question *about* an attached fragment, an incomplete doc), the
skill **asks** rather than guessing. The override prefix always wins.

**Why Council exists alongside `deep-research`:** Council is for offline, confidential, or
judgment-based deliberation where web-grounding is impossible, undesirable, or beside the
point — internal strategy, "which approach should we take," methodology questions. It
trades `deep-research`'s external verification for **speed, privacy, and lower cost**, and
it produces a *recommendation with dissent* rather than a *cited fact report*. Rule of
thumb: facts about the world → `deep-research`; a decision over what you already know →
Council.

## 5. The Pipeline

**Principle (v3 — revised after first real use): light by default, thorough on request;
verification is always BATCHED.** First live use spun up ~25 subagents and cost ~millions
of tokens, because Stage 3 ran *one skeptic agent per finding*. Combined with the
validation finding that a frontier single agent already saturates small/medium artifacts,
the v2 "always-rigorous, no tiers" stance did not justify a 10–30× token cost for routine
use. So:
- **Verification is batched**, never one-agent-per-finding: light = a single global verifier
  rates all findings in one call; thorough = one batched verifier per lens. This alone cut a
  routine run from ~25 agents to single digits.
- **Light is the default** (~6–8 subagents): convene → diverse lenses → one batched
  verification → synthesize. No completeness critic, no loop-back.
- **`thorough` is opt-in** (~10–14 subagents): adds per-lens batched skeptics, the
  completeness critic, and the unanimity loop-back. For genuinely high-stakes artifacts.
- Breadth (lens count) still scales with the topic's genuine diversity, capped at ~5.

This reintroduces the cost/value dial that v2 removed — the live token data overturned the
earlier "adversarial verification is cheap" assumption (the cost lens flagged exactly this
and was overruled; it was right).

One shared 4-stage skeleton; only Stage 3 differs by mode.

### Stage 1 — Convene (lens selection + diversity guardrail)
- Claude selects lenses for the context, drawing from the library (§6) and inventing
  1–2 ephemeral ad-hoc domain lenses when the topic needs niche expertise.
- **Diversity guardrail (lightweight, visible):** Claude selects the minimum set covering
  the genuinely distinct dimensions, then **lists the chosen lenses with a one-line "why
  these are distinct" before Stage 2 runs.** The hard cap (~5) plus this visible list *is*
  the guardrail — no pairwise-overlap-scoring machinery. On a capable model, dynamic
  selection already yields diverse panels; the visible list lets a redundant pick be caught
  (by the user, or by the announce-then-proceed step) cheaply. The cap also governs lenses
  spawned later in Stage 4 (see below) — total lenses across the whole run stay ≤ cap+1.

### Stage 2 — Independent pass (blind, parallel)
- Each lens reviews the artifact / question **independently and in parallel**, with no
  visibility into the others (prevents anchoring and premature convergence).
- Each lens produces findings (Review) or a position + recommendation (Council), with
  evidence and, for Review, the specific section/line it attaches to.

### Stage 3 — Pressure-test (mode-defined)
Honestly named: this stage is *not* the same operation in both modes.
- **Review:** each finding gets an independent **skeptic** that genuinely tries to
  *refute* it, and **re-rates its severity** (blocker / major / minor / drop). The skeptic
  does not merely keep-or-kill — the dogfood run showed a binary refute/keep rejects almost
  nothing; the *severity re-rating* is where signal separates from noise. Findings that
  can't be substantiated are dropped; the rest carry an adjusted severity.
- **Council:** each lens must produce a **falsifiable claim plus a disconfirming test**.
  Either (a) a lightweight sub-step actually *runs* each disconfirming test as a narrow
  check, or (b) if tests aren't executed, the stage is named "Position & Structured
  Disagreement" and does not claim to have verified anything. (Pick one in the plan; do not
  collect tests and leave them unrun while claiming verification.)
- Pressure-test work runs in **parallel**, not serial rounds.

### Stage 4 — Synthesize
- A **completeness critic** asks "what did every lens miss — a perspective not run, a
  claim unverified, a section unread?" It may spawn **one** additional library lens to fill
  a genuine gap (counts against the run's lens cap).
- **Unanimity loop-back (active control valve, bounded single pass):** if Stage 3 leaves no
  surviving disagreement, that is *not* a clean bill of health — it is the correlated-bias
  signal. The loop-back does **not** spawn a "be-disagreeable" persona (cited research warns
  that produces hollow critique). Instead it uses a **structurally distinct mandate**: run a
  high-value library stance that did *not* already run (no Risk lens ran? run Risk; no
  Simplicity lens? run that). Only if the relevant stances are exhausted does it fall back
  to the probe "what shared assumption did nobody question?" This fires **once**: if the new
  lens surfaces real disagreement, it is reported as minority dissent; if not, the report
  names the strongest shared unstated assumption and **stops** (no further looping).
- Produces the ranked output (§7).

## 6. Lens Library

**Lenses are modes of critique, not subject-matter experts.** This is what keeps the
library small and coverage total.

- **~6–8 domain-agnostic critique stances** (starting set, finalized in the plan):
  Skeptic / Devil's Advocate · End-User / Audience Advocate · Rigor / Correctness ·
  Feasibility / Operator · Simplicity / YAGNI · Risk / Failure-modes · Completeness /
  Gaps · Strategic / "So-what".
- **Lightweight entry format** (research-backed — a sharp name suffices, skip the
  backstory): **name + one-line mandate + "what it reliably catches" + 2–3 signature
  questions.** Nothing more.
- **Specialization happens at runtime, implicitly.** A capable model instantiates
  "Simplicity for marketing copy" or "Rigor as positioning coherence" directly from the
  lens definition + the artifact — no pre-built per-domain templates, no explicit
  base+domain+context composition layer to maintain. (v1 explored a layered context-injection
  pattern; the dogfood review showed it's over-engineering given runtime instantiation.
  Dropped.)
- **Niche expertise is ephemeral:** genuinely specialized lenses (domain-specific compliance,
  Core Web Vitals, GTM motion) are spun up ad-hoc per run and never persisted.
- **Library governance (informal, issue-driven):** a lens earns a slot only if it is (a)
  reusable across domains AND (b) catches things existing lenses systematically miss — a
  high bar almost nothing clears. Domain expertise is always ad-hoc. No pruning ceremony or
  usage-counter machinery for a ~8-lens library; when overlap is noticed, propose a merge.
  Revisit formal governance only if the library actually grows.

## 7. Output

**Review mode:** ranked findings — **blockers → majors → minors** (post-skeptic severity) —
each keyed to the specific section/line of the artifact, with a **concrete suggested edit**,
so the output feeds straight into a fix pass. Conflicting suggested edits to the same
location are de-duplicated and surfaced as a choice, not silently merged. Plus surfaced
themes and an explicit unanimity/diversity note.

**Council mode:** a recommendation with a **confidence level**, the key tradeoffs, and an
explicit **dissent / minority report** (genuine disagreements are surfaced, never smoothed
over). Plus the unanimity/diversity note.

**Failure handling:** if a lens subagent crashes, times out, or returns malformed output,
the run continues with the survivors and the report **states how many lenses ran vs. were
requested** (degraded runs are never reported as full). A run with fewer than 2 usable
lenses aborts with an explanation rather than reporting thin consensus.

## 8. Invocation

Three first-class invocation paths. All three resolve mode (Review/Council) per §4 and the
target (artifact or question) from input or conversation context, asking when ambiguous.

**1. Explicit command** — `/panel [review:|council:] <input>`. Working name "panel"; final
name TBD in plan.

**2. Natural language (skill auto-invoke)** — the skill triggers on intent, not just the
slash command. Phrasings like "let's have the panel review (this)," "convene a panel,"
"get expert eyes on this," "stress-test this with a panel," "panel this" invoke it against
whatever is under discussion. This makes mid-conversation invocation work, including **as
an answer to an AskUserQuestion**: when the user types (e.g. via "Other") "let's have the
panel review," that text returns to Claude as the answer when the modal closes, Claude
recognizes the intent, and runs the panel — no `/panel` typed. *Requirement:* the SKILL.md
`description` must carry strong, explicit triggers and example phrasings so this fires
reliably (a plan deliverable). When invoked this way, the skill resolves the target from
context and confirms if unclear.

**3. Auto-trigger hook — ON by default.** A `settings.json` hook fires a panel review when
Superpowers writes a new spec/plan (in `docs/superpowers/specs/` and
`docs/superpowers/plans/`). This reinstates the original "review every spec and plan
automatically" intent.
  - **Mechanism:** hooks run shell commands and **cannot themselves drive a Claude
    Workflow.** In an interactive session the hook **injects an instruction** ("a new spec
    was written at `<file>` — run the panel on it") that Claude then actuates immediately —
    effectively automatic from the user's side, no command typed. (A *fully headless*
    auto-runner — panels firing outside any interactive session — would need a separate
    shell-executable entry point, e.g. a `claude -p` call; deferred, not v1.)
  - **Guards (kept even though default is ON):** because a panel spawns multiple subagents,
    (a) every fire is **announced** in chat (never silent), (b) a **cost estimate + confirm
    prompt above a size threshold**, (c) hardcoded path scope, (d) a one-command **disable**
    that shows and logs the exact `settings.json` change (audit trail), (e) a lightweight
    **PII pre-flight** heuristic + confirm when an artifact looks like it contains applicant
    PII (calibrated, not a hard refuse).

## 9. Location, Packaging & Implementation Substrate

- **Location:** user-level standalone skill, cross-project. Its own directory/repo
  (working home: `~/Documents/github/panel/`), symlinked into `~/.claude/skills/`. No
  domain coupling — available across all projects.
- **Substrate:** mirror the proven domain-specific harness pattern —
  - a portable `.js` **harness** (reads no filesystem, no env) that defines the stages,
    the lens library, the guardrail, and the synthesis, invoked via the **Workflow** tool;
  - a **command** (`/panel`) that resolves paths/args and embeds resolved args into a
    one-off copy of the harness before calling Workflow. **Note:** the args-embedding step
    is a known workaround for unreliable Workflow `args` threading — flagged as fragility to
    remove if/when that platform issue is fixed.
  - **Substrate-fit check (do before the plan, not on faith):** confirm the proven harness
    pattern actually supports what Panel needs — chiefly *runtime ephemeral lens invention*
    and the *Stage-4 conditional spawn*. If the existing pattern only supports a fixed
    roster, the harness needs that extension designed explicitly.
- **Cost model (replaces v1's caching claim):** the v1 "cached shared prefix → cheap" claim
  is **unverified** — each lens is a separate Claude call, and cross-call prompt caching may
  not be exposed by the Workflow tool at all. Before the plan: (a) measure the **real token
  cost** of a representative run (N lenses × full-context tokens + skeptics + synthesis),
  (b) only then decide whether caching/batching is feasible and worth it, (c) do **not**
  promote caching to a dependency. Cost-related success claims (§11) are gated on this
  measurement. A per-run **cost estimate + a confirm prompt above a threshold** (e.g. large
  artifacts) is a requirement, doubly so because the auto-trigger can initiate runs.

## 10. Open Questions (for the plan)

1. Final starting roster of library stances (the ~6–8) and their exact one-line mandates.
2. Final skill/command name.
3. Auto-trigger hook mechanism (instruction-injection shape; PostToolUse-on-Write vs.
   Stop hook) and exact path scoping. Default ON; confirm the injected-instruction path
   actuates reliably in an interactive session, and how the natural-language trigger (path
   2) and the hook (path 3) coexist without double-firing on the same artifact.
4. Council Stage 3: execute disconfirming tests as a sub-step, or rename to "Position &
   Structured Disagreement" and drop the verification claim?
5. Real token cost of a representative run, and whether any caching/batching is feasible
   without breaking blind parallelism.
6. Substrate-fit: does the proven harness pattern support runtime ephemeral lenses + the
   Stage-4 conditional spawn, or must the pattern be extended?
7. Determinism for a *gate*: dynamic selection means run-to-run variance in which lenses
   run and what's flagged a blocker. Should the selected lens set + findings be
   logged/replayable so a review is auditable? Acceptable variance level?

## 11. Success Criteria (testable)

- **Beats a single strong agent (the core claim, measured):** on a small golden set of
  artifacts with known issues, the panel surfaces *more* of the seeded/known issues than a
  single Opus reviewer on the same artifact, at a token cost documented per §9. If it
  cannot be shown to beat a single agent, the skill's premise fails — this is the gating
  criterion.
- **Edit-ready output:** every Review finding has a section/line anchor and a concrete
  suggested edit; a sample of findings can be applied without further interpretation.
- **Unanimity loop-back demonstrably fires** when lenses agree (verifiable on a
  deliberately easy/agreeable artifact) and **stops after one pass.**
- **Visible heterogeneity:** the announced lens list shows no two near-duplicate lenses.
- **Cross-domain:** works unmodified on a coding artifact, a product spec, and a marketing
  question.
- **Graceful degradation:** a forced lens failure yields a survivors-only report that
  correctly states "ran N of M lenses."
- **Library stays ~8±** over time without bloating.
