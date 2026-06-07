#!/usr/bin/env bash
# PostToolUse hook: on a new Superpowers spec/plan write, inject a "run panel"
# instruction. Path-filtered, debounced per file+mtime, JSON-safe, PII-prescreened.
set -euo pipefail
input="$(cat)"

get() { printf '%s' "$input" | (jq -r "$1 // empty" 2>/dev/null || true); }
path="$(get '.tool_input.file_path')"
if [ -z "$path" ]; then
  path="$(printf '%s' "$input" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
fi

case "$path" in
  *"/docs/superpowers/specs/"*.md|*"/docs/superpowers/plans/"*.md) ;;
  *) exit 0 ;;
esac
[ -f "$path" ] || exit 0

# Debounce marker in a private cache dir (not world-readable /tmp), so the
# "<file> edited at <mtime>" signal isn't leaked to other users on shared hosts.
cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/panel"
mkdir -p "$cache_dir" 2>/dev/null || true
chmod 700 "$cache_dir" 2>/dev/null || true
mtime="$(stat -f %m "$path" 2>/dev/null || stat -c %Y "$path" 2>/dev/null || echo 0)"
marker="$cache_dir/autotrigger-$(printf '%s' "$path-$mtime" | shasum | cut -d' ' -f1)"
[ -f "$marker" ] && exit 0
( umask 077; : > "$marker" )

# PII pre-screen: if the file looks like it has PII, ask rather than auto-run.
pii_note=""
if grep -Eiq '([0-9]{3}-[0-9]{2}-[0-9]{4})|(applicant)|(date of birth)|([[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,})' "$path"; then
  pii_note=" The file may contain PII — confirm with the user before fanning it out (pass piiAck only after they agree)."
fi

msg="A new Superpowers document was written at $path. The panel skill's auto-trigger (this hook is OFF by default and only runs because it has been explicitly enabled) suggests running the expert panel on it: invoke /panel review: $path . Announce the auto-run and respect the cost/PII guards.$pii_note If the user just asked you to panel this same file, do not double-run."

# JSON-safe: encode the message with jq (fallback: python) so quotes/paths can't break it.
if command -v jq >/dev/null 2>&1; then
  esc="$(printf '%s' "$msg" | jq -Rs .)"
else
  esc="$(printf '%s' "$msg" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')"
fi
printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":$esc}}"
exit 0
