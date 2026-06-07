# Hook: panel auto-trigger

`on-doc-write.sh` is a PostToolUse hook that, when a new spec/plan is written under
`docs/superpowers/{specs,plans}/*.md`, injects an instruction suggesting a `/panel review:`
run on that file (path-filtered, debounced per file+mtime, JSON-safe, PII-prescreened).

## Dependencies

The hook requires the following tools at runtime:

- **`jq`** — used to JSON-encode the injected message safely. If absent, the hook falls
  back to **`python3`** (`json.dumps`). If neither is available, the hook will fail silently
  once enabled (it exits non-zero with no output, so no panel is triggered but no error is
  surfaced either).
- **`shasum`** — used to generate a per-file debounce marker. Standard on macOS; available
  as `sha1sum` on most Linux distros (the hook tries `shasum` first, which covers both via
  most package managers).
- **`stat`** — used to read the file's modification time for the debounce key. The hook
  tries BSD/macOS form (`stat -f %m`) then GNU/Linux form (`stat -c %Y`) automatically.

On a box missing any of these the hook will fail silently once enabled — no panel fires, but
no error is surfaced. Verify with `which jq shasum stat` before enabling.

## Status: installed but NOT registered (auto-trigger OFF)

This install intentionally did **not** add the hook to `~/.claude/settings.json`, so panels do
**not** auto-fire. `/panel` and natural-language invocation still work.

## To ENABLE auto-trigger

Use the `update-config` skill (it emits the currently-correct settings schema), or add a
`PostToolUse` hook entry to `~/.claude/settings.json` pointing at
`~/.claude/skills/panel/hooks/on-doc-write.sh` with a matcher for the `Write` tool. Confirm
the exact JSON shape with `update-config` or `claude-code-guide` — the matcher format is
version-dependent. After enabling, every new spec/plan write will spend tokens suggesting a
panel run.

## To DISABLE later

Remove that `PostToolUse` entry from `~/.claude/settings.json`.
