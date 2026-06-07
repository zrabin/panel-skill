# Contributing

## Running tests

```bash
node --test
```

Requires Node ≥18. The suite runs unit tests for `lib.js`, a build idempotency check,
a `vm`-based dry-run of the full harness pipeline, and the golden-fixture scoring helper.

## The generated harness

`panel.js` is **generated** — never hand-edit it. The source of truth is:

- `lib.js` — pure, unit-tested logic and the lens library (CommonJS)
- `panel.template.js` — harness orchestration with a `// __LIB__` injection marker

After editing either file, regenerate and re-run tests:

```bash
node build-panel.js && node --test
```

A build test (`test/build.test.js`) will fail if `panel.js` is stale, preventing
accidentally shipping a generated file that does not match its sources.

## Lens design principle

Lenses are lightweight critique **stances** — modes of critique, not subject-matter
experts. Keep them:

- **Genuinely distinct**: each lens should surface a different *class* of issue. If two
  lenses would raise the same findings on most inputs, they are not distinct enough.
- **Domain-agnostic**: the library stances must apply across any topic. Domain-specific
  expertise (e.g. "GDPR compliance", "Core Web Vitals") is spun up ad-hoc per run and
  never added to the library.
- **Minimal**: a new stance earns a library slot only if it (a) is reusable across
  domains AND (b) catches things existing lenses systematically miss. This bar is high.
  When overlap is noticed, propose a merge rather than a new entry.

The lens format is deliberately lightweight: `name` + one-line `mandate` + `catches` +
2–3 `questions`. Verbose persona backstories add nothing (see the research section of
the README).
