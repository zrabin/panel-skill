# panel

A reusable agent **skill** for Claude Code, Codex, and Cursor that runs a
diversity-enforced, adversarial, multi-lens **expert panel** over a document (Review mode) or
an open question (Council mode), then synthesizes ranked, edit-ready feedback.

It is the productized, research-backed version of the informal habit *"spin up a few subagents
to review this from relevant POVs, find the critical errors and opportunities, don't
over-complicate it, and synthesize the feedback."* The skill keeps that flexibility but adds
the three things the research says actually drive quality — **genuine perspective diversity**,
**adversarial verification**, and **disciplined synthesis** — plus guards so it declines tasks
it's wrong for and screens for PII.

---

## TL;DR

- **Two modes, auto-detected.** Point it at an artifact → **Review** (ranked findings with
  concrete edits). Ask it an open question → **Council** (a recommendation with confidence and
  an explicit minority report).
- **Diversity is enforced, not assumed.** A convener picks the *minimum* set of genuinely
  distinct critique lenses (from a small library of stances + ad-hoc niche lenses), capped at
  ~5, and lists them before running.
- **Findings are adversarially verified** (a skeptic tries to *refute* each one and re-rates
  its severity) before they reach you — fewer false positives.
- **Cheap by default.** A `light` run is ~6–8 subagents; `thorough` (per-lens skeptics +
  completeness critic + unanimity loop-back) is opt-in for high-stakes work.
- **It knows what it's *not* for.** It declines blank-page generation, taste/visual decisions,
  unscoped questions, and web fact-finding, and redirects you to the right tool.

---

## Why this exists

The original instinct was that an ad-hoc "panel of experts" prompt would be *more impactful
if the experts were more specific*. The research says that's the wrong lever (see
[The research](#the-research-behind-it)). What actually matters for critique/evaluation tasks
is the **diversity** of the perspectives and the **adversarial verification + synthesis**
around them — not how precisely you name the personas. This skill encodes those levers so you
get them every time, on any topic, without hand-crafting prompts.

It is also the domain-agnostic generalization of two domain-specific review harnesses
and reuses their proven orchestration pattern.

---

## What it does

### Modes

| Mode | When | Output |
| --- | --- | --- |
| **Review** | You give it a concrete artifact (spec, plan, PRD, design doc, essay, code) | Ranked findings — **blockers → majors → minors** — each anchored to a section with a concrete suggested edit, plus themes and a diversity note |
| **Council** | You give it an open-ended question with no artifact | A **recommendation with a confidence level**, the key tradeoffs, and an explicit **dissent / minority report** (disagreement is surfaced, never averaged away) |

Mode is auto-detected (a file/document → Review; a bare question → Council) and announced
before any tokens are spent. You can force it with a `review:` / `council:` prefix.

### The pipeline

```
Convene → Independent → Pressure-test → Synthesize
```

1. **Convene.** A convener selects the *minimum* set of genuinely distinct lenses for the
   target, drawing from the library and inventing 1–2 ad-hoc niche lenses only when the topic
   needs expertise the library lacks. A diversity guardrail dedupes/caps the set (~3–5) and
   the chosen lenses are listed before the run. *(Diversity is the proven lever; the cap is a
   cost/diminishing-returns guard.)*
2. **Independent.** Each lens reviews the target **blind and in parallel** — no cross-talk, so
   they don't anchor on each other.
3. **Pressure-test (batched).** Findings are **adversarially verified**: a skeptic tries to
   *refute* each one and **re-rates its severity** (or drops it). Verification is **batched**
   (one verifier rates many findings in a single call), never one agent per finding.
4. **Synthesize.** A synthesizer merges duplicates, ranks by real severity, and produces the
   edit-ready report.

### Depth: light (default) vs thorough

| | **light** (default) | **thorough** (opt-in) |
| --- | --- | --- |
| Pipeline | convene → lenses → **1 global** batched verifier → synthesize | + **per-lens** batched skeptics, a **completeness critic** ("what did everyone miss?"), and the **unanimity loop-back** |
| Subagents | ~6–8 | ~10–14 |
| Use for | most reviews | genuinely high-stakes specs/plans |

Add `thorough` (e.g. `/panel thorough review: spec.md`, or just "run a thorough panel") only
when the stakes justify several× the tokens.

The **unanimity loop-back** (thorough only) treats suspicious consensus as a risk, not a pass:
if no blocker/major survives, it spawns one *structurally distinct* unused lens (e.g. Risk if
Risk didn't run) to surface what everyone missed — once, bounded. (In practice it rarely fires,
because a good adversarial panel resists unanimity on any substantive input.)

### The lens library

Lenses are **modes of critique, not subject-matter experts** — that's what keeps the library
small while coverage stays total (domain specialization happens at runtime). Eight lightweight
stances ship by default:

`skeptic` · `enduser` · `rigor` · `feasibility` · `simplicity` · `risk` · `completeness` ·
`strategic`

Each is just a sharp name + a one-line mandate + a couple of signature questions — deliberately
lightweight, because the research shows a precise *name* suffices and verbose persona backstories
add nothing. Niche, domain-specific expertise (e.g. "domain-specific compliance", "Core Web Vitals") is
spun up **ad-hoc per run** and never persisted.

### The guards

- **Decline / redirect.** If you ask for blank-page generation, a taste/visual/aesthetic
  decision, an unscoped question, a web/factual lookup, or a tight iterative loop, the panel
  **declines and points you to the right tool** (brainstorming, frontend-design, deep-research,
  an iterative build skill). The panel is a *critic and decider, not a generator* — it needs
  something concrete to react to.
- **PII pre-flight.** If the target looks like it contains PII (SSN, emails, addresses,
  "applicant"/DOB), it asks you to confirm before fanning the content out to subagents — a
  calibrated, non-blocking check (relevant to any SOC2/FedRAMP-track product's posture).
- **Cost confirm.** Above a token threshold it asks before proceeding.

---

## When NOT to use it

| Task | Use instead |
| --- | --- |
| Blank-page generation / ideation | `superpowers:brainstorming`, `frontend-design` |
| Taste / visual / aesthetic decisions | `frontend-design`, Figma skills, the brainstorming visual companion |
| Unscoped / underspecified question | `brainstorming` first to scope, then optionally panel |
| Web fact-finding ("what's true out there?") | `deep-research` |
| Tight create → react → revise loop | an iterative build skill, then panel the result |

In a design project the panel sits **downstream**: generate options first, then panel them to
decide.

---

## Prerequisites

- **Claude Code:** requires the `Workflow` tool. The `/panel` command runs inside
  the Workflow sandbox.
- **Codex:** install as a native Codex skill. Optional multi-agent support lets
  Codex run the independent lens pass in parallel; without it, the adapter uses
  the serial fallback in [`references/codex.md`](references/codex.md).
- **Cursor:** install as a Cursor Project Rule in `.cursor/rules/panel.mdc`.
  Cursor uses the serial adapter in [`references/cursor.md`](references/cursor.md)
  unless the active environment provides an explicit parallel-agent mechanism.
- **Node ≥18** — only needed to run the test suite (`node --test`) and regenerate the harness (`node build-panel.js`). The skill itself has no Node runtime dependency at run time.
- **Optional Claude Code auto-trigger hook** additionally requires: `jq` (or
  `python3` as a fallback for JSON encoding), `shasum`, and `stat` (BSD/macOS or
  GNU/Linux). On a system missing these the hook will fail silently once enabled
  — see [`hooks/README.md`](hooks/README.md).

---

## Installation

### Claude Code

```bash
git clone https://github.com/zrabin/panel-skill.git ~/Documents/github/panel
cd ~/Documents/github/panel
ln -sfn "$PWD" ~/.claude/skills/panel
ln -sfn "$PWD/commands/panel.md" ~/.claude/commands/panel.md
```

### Codex

```bash
git clone https://github.com/zrabin/panel-skill.git ~/Documents/github/panel
cd ~/Documents/github/panel
mkdir -p ~/.agents/skills
ln -sfn "$PWD" ~/.agents/skills/panel
```

Restart Codex after installing so it discovers the new skill.

For parallel lens reviews, enable Codex multi-agent support in
`~/.codex/config.toml`:

```toml
[features]
multi_agent = true
```

Without multi-agent support, Codex still runs the skill through the serial
fallback documented in [`references/codex.md`](references/codex.md).

### Cursor

Cursor project rules are installed per project. From the Cursor project root:

```bash
PANEL_SKILL_ROOT="${PANEL_SKILL_ROOT:-$HOME/Documents/github/panel}"
mkdir -p .cursor/rules
ln -sfn "$PANEL_SKILL_ROOT/.cursor/rules/panel.mdc" .cursor/rules/panel.mdc
```

Use Cursor Project Rules instead of the legacy `.cursorrules` file. The rule
points Cursor to the adapter workflow in
[`references/cursor.md`](references/cursor.md). Restart Cursor or reload the
window if the rule does not appear in the Agent sidebar.

### Development

Requires Node ≥18 (for `node:test` / `node:vm`, used only by the test suite).
The Claude Code harness has no install-time build step, but if you edit `lib.js`
or `panel.template.js`, regenerate it:

```bash
node build-panel.js && node --test
```

`panel-preflight.js` is the shared adapter helper for non-Workflow platforms. It
wraps the same mode, redirect, PII, and cost gates used by the Claude harness.

### Optional: auto-trigger on new specs/plans

A PostToolUse hook (`hooks/on-doc-write.sh`) can suggest a panel review whenever a new
`spec.md`/`plan.md` is written under `docs/superpowers/{specs,plans}/`. It ships **OFF** (not
registered in `settings.json`); see [`hooks/README.md`](hooks/README.md) to enable. It's
path-scoped, debounced, JSON-safe, and PII-prescreened, and it *suggests* a run rather than
silently spending tokens.

---

## Usage

Claude Code has three ways to invoke — all resolve mode and target the same way:

1. **Command:** `/panel review: path/to/spec.md` · `/panel council: <question>` ·
   `/panel thorough review: path/to/plan.md`
2. **Natural language:** "let's have the panel review this", "convene a panel on X",
   "get expert eyes on this", "run a thorough panel" — works mid-conversation, including as an
   answer to a question.
3. **Auto-trigger hook** (opt-in, see above).

Codex uses natural-language skill triggering after installation:

- "Run the panel review on `docs/spec.md`"
- "Convene a panel on whether we should adopt event sourcing given these constraints..."
- "Run a thorough panel on this plan"

The Codex adapter follows [`references/codex.md`](references/codex.md) instead
of the Claude Code `/panel` command.

Cursor uses the project rule after `.cursor/rules/panel.mdc` is installed:

- "Run the panel review on this PRD"
- "Panel this implementation plan"
- "Convene a thorough panel on whether this migration is worth doing"

The Cursor adapter follows [`references/cursor.md`](references/cursor.md) and
runs serially by default.

---

## Cost

The dominant historical cost was a *per-finding* skeptic fan-out (the first real run spun up
~25 subagents and ~millions of tokens). Verification is now **batched**, and **light is the
default**:

| Run | Subagents | Tokens (≈, on a small artifact) |
| --- | --- | --- |
| `light` (default) | ~6–8 | ~200K |
| `thorough` | ~10–14 | several× light |

Note: each lens pass re-reads the target across Claude Code, Codex, and Cursor,
so token cost scales with artifact size × lens count.

---

## Error handling

The Claude Code harness returns structured error objects you may see surfaced by
the `/panel` command. Codex and Cursor apply the same gates and report
equivalent conditions in chat.

| Return key | Meaning | What to do |
| --- | --- | --- |
| `no_mode` | The input couldn't be classified as an artifact (Review) or a question (Council). | Re-invoke with a `review:` or `council:` prefix, or provide clearer input. |
| `convene_failed` | The lens-selection stage crashed or returned malformed output. | Retry; if it recurs, check that the `Workflow` tool is available and the harness is not stale (run `node build-panel.js`). |
| `too_few_lenses` | After deduplication/guardrail, fewer than 2 distinct lenses remained — the panel would report thin consensus, so it aborted. | The input may be too trivial or too narrow. Try a more substantive artifact, or invoke `council:` mode on a scoped question. |
| `degraded` | Fewer lenses returned results than were convened (one or more subagents crashed or timed out). | The report runs with survivors and states how many lenses ran. Retry if the loss is significant. |
| `synthesis_failed` | The final synthesizer subagent crashed; the raw verified findings are returned instead. | The raw output is still usable. Retry for a formatted report. |

---

## The research behind it

Every claim below was **independently verified against the primary sources** (arXiv
abstracts/PDFs) during development. No fabricated citations were found; where a specific
statistic could *not* be confirmed from accessible text, it is flagged and **not relied upon**.
The position is also genuinely **contested** — see the rebuttal at the end.

### The lever is diversity + verification, *not* persona specificity

- **Persona labels alone don't reliably improve accuracy.** Zheng et al., *"When 'A Helpful
  Assistant' Is Not Really Helpful: Personas in System Prompts Do Not Improve Performances of
  LLMs"* (Findings of EMNLP 2024, [arXiv:2311.10054](https://arxiv.org/abs/2311.10054)): across
  162 roles / 2,410 questions / 4 model families, adding a persona did not improve performance,
  and *automatically* picking the best persona was "no better than random selection."
  → **Lens definitions stay lightweight; we don't bet on persona labeling.**

- **A sharp persona *name* suffices; verbose backstories add nothing; dynamic selection beats a
  fixed set — and this is emergent at frontier scale.** Wang et al., Solo Performance Prompting,
  *"Unleashing the Emergent Cognitive Synergy in LLMs"* (NAACL 2024,
  [arXiv:2307.05300](https://arxiv.org/abs/2307.05300)): dynamic fine-grained personas beat a
  fixed set; adding detailed profiles did **not** beat bare names; the effect appears only in
  GPT-4-class models, not weaker ones.
  → **Dynamic lens selection + minimal definitions, on a capable model.** *(Caveat: SPP
  validates dynamic* selection*, not the* ad-hoc generation *of brand-new niche lenses mid-run
  — that part is an architecture choice adopted from prior domain-specific harnesses, not a
  research finding.)*

- **Diversity of perspective is the active ingredient for critique tasks.** Chan et al.,
  *ChatEval* (ICLR 2024, [arXiv:2308.07201](https://arxiv.org/abs/2308.07201)): multi-agent
  evaluation with *identical* roles ≈ a single agent; with *diverse* roles, accuracy and
  agreement rise (53.8% → 60.0% on FairEval). Accuracy peaks at **3–4 roles and declines at 5**.
  Separately, Yang et al., *"Understanding Agent Scaling … via Diversity"* (2026,
  [arXiv:2602.03794](https://arxiv.org/abs/2602.03794)): "2 diverse agents can match or exceed
  16 homogeneous ones."
  → **Enforce genuine diversity; cap the panel at ~5.**

- **Naive multi-agent debate often *doesn't* beat a strong single agent; heterogeneity is the
  antidote; more debate rounds can hurt.** Zhang et al., *"Stop Overvaluing Multi-Agent Debate
  — We Must Rethink Evaluation and Embrace Model Heterogeneity"* (2025,
  [arXiv:2502.08788](https://arxiv.org/abs/2502.08788)); Liang et al., *"Encouraging Divergent
  Thinking … Multi-Agent Debate"* ([arXiv:2305.19118](https://arxiv.org/abs/2305.19118), which
  also finds *moderate*, not maximal, disagreement is best); Du et al., *"Improving Factuality
  and Reasoning … through Multiagent Debate"*
  ([arXiv:2305.14325](https://arxiv.org/abs/2305.14325)).
  → **No multi-round debate. Rigor comes from adversarial *verification*, not re-litigation.**

- **Unanimity is a correlated-bias risk.** The Vanderbilt study *"Evaluating Persona Prompting
  for Question Answering Tasks"* (Olea et al., incl. Schmidt & White) found personas help
  open-ended tasks but not closed ones, and warns that naive multi-agent setups can let one
  agent's error be accepted by the others.
  → **The unanimity loop-back treats consensus as suspect.** *(Caveat: the specific
  "hallucination-contagion" anecdote is in that paper's results section and was not
  independently verified; treat it as plausible, not established. The loop-back itself is an
  untested design hypothesis.)*

### Two related findings, used with care

- **Wharton, *"Playing Pretend: Expert Personas Don't Improve Factual Accuracy"*** (Prompting
  Science Report 4, 2025, [arXiv:2512.05858](https://arxiv.org/abs/2512.05858)) — corroborates
  Zheng on current frontier models.
- **PRISM, *"Expert Personas Improve LLM Alignment but Damage Accuracy …"*** (2026,
  [arXiv:2603.18507](https://arxiv.org/abs/2603.18507)) — the directional thesis (personas help
  alignment/generative tasks, hurt knowledge recall) is supported by the abstract, but the
  specific figures sometimes quoted from it could **not** be verified and are not relied upon.

### The contested view (read this too)

This is not settled science. A direct rebuttal — *"The Arrival of AGI? When Expert Personas
Exceed Expert Benchmarks"* (2026, [arXiv:2603.20225](https://arxiv.org/abs/2603.20225)) —
argues expert personas *do* help once methodological limitations are fixed. The design hedges
against this by resting on **diversity + verification** (well-supported) rather than on persona
labeling (disputed).

---

## Honest limitations

These came out of actually validating the skill, and they matter:

- **The "beats a single agent" claim is inconclusive at ≤150-line artifacts.** A frontier single
  agent saturates small and medium documents — on short inputs it finds essentially everything
  the panel does. The panel's *measurable* edge is **adversarial verification (fewer false
  positives), calibrated severity ranking, gating (decline + PII), and the unanimity loop-back**
  — not raw recall against a strong solo reviewer. Recall gains likely only show on *large,
  messy* artifacts (full specs, whole PRs). For a 30-line snippet, a plain review is fine; reach
  for the panel when one reviewer's attention would get stretched thin.
- **The unanimity loop-back is hard to trigger live** (too-trivial inputs abort for too-few
  lenses; substantive inputs give a good panel something to flag). It's a rare backstop,
  validated by a deterministic unit test rather than a live demo.
- **The golden-fixture "beats a single agent" benchmark is not yet a reliable gate** — the
  keyword scorer is too crude (synonym misses) and the fixtures are too small to discriminate.
  A future LLM-judge + whole-PR fixture would fix this.

---

## Architecture

The harness can't `require()` local files (it runs in Claude Code's `Workflow` sandbox), so the
runnable harness is **generated**, not hand-edited:

```
lib.js              ── pure, unit-tested logic + the lens library (single source of truth)
panel.template.js   ── the harness orchestration, with a `// __LIB__` injection marker
build-panel.js      ── inlines lib.js into the template → panel.js
panel.js            ── GENERATED Workflow harness (committed, always reproducible)
commands/panel.md   ── the /panel command (arg parsing, gates, hardened invocation)
SKILL.md            ── skill entry + intent triggers + routing table
hooks/on-doc-write.sh ── opt-in auto-trigger hook
test/               ── lib.test.js, build.test.js (idempotency), dry-run.test.js (vm-mocked
                       pipeline), golden.test.js
references/golden/  ── validation fixtures + seeded-flaw key + RESULTS.md
docs/superpowers/   ── the design spec, implementation plan, and de-risk notes
```

Edit `lib.js` or `panel.template.js`, then run `node build-panel.js && node --test`. A build
test fails if `panel.js` is stale. The harness uses `export const meta` **and** a top-level
`return` (valid only inside the `Workflow` runtime), so it is validated by a `vm`-based dry-run
test rather than `node --check`.

The `/panel` command embeds resolved args into a hardened scratch copy of the harness (`mktemp`
`0700` dir, `chmod 600`, deleted after the run, since it may contain PII), because the
`Workflow` tool does not reliably thread an `args` parameter through a `scriptPath` invocation.

---

## Development

```bash
node --test            # run the full suite (27 tests)
node build-panel.js    # regenerate panel.js after editing lib.js / panel.template.js
```

See [`docs/superpowers/specs/`](docs/superpowers/specs/) for the full design rationale and
[`references/golden/RESULTS.md`](references/golden/RESULTS.md) for the validation record.
