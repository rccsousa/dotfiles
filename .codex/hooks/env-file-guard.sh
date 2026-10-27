#!/bin/sh
# Codex PreToolUse guard: .env* and .envrc are unreadable and unwritable, with
# exactly one carve-out — .env.example, which holds placeholder keys.
#
# Port of ~/.claude/hooks/env-file-guard.sh. Differences forced by Codex:
#   - Codex runs shell through the `exec` custom tool, whose tool_input is a
#     freeform JS program string (tools.exec_command({cmd:"..."}), fs.readFile,
#     ...). There is no structured .command field, so the whole tool_input is
#     text-scanned rather than parsed field-wise.
#   - Codex has no settings.json deny layer and runs with
#     sandbox_mode=danger-full-access + approval_policy=never, so this hook is
#     the only barrier. It must fail CLOSED.
#   - apply_patch bodies are scanned on their file-path header lines only, so
#     editing a .gitignore that merely mentions .env still works.

deny() {
  if command -v jq >/dev/null 2>&1; then
    reason=$(printf '%s' "$1" | jq -Rs .)
  else
    reason='"Blocked by env-file-guard.sh: env files may hold live credentials."'
  fi
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$reason"
  exit 0
}

REASON='Blocked: .env*/.envrc may hold live credentials. Only .env.example is permitted. If you need a value from one, ask the user for it.'

input=$(cat)

# Degraded path: without jq the payload cannot be parsed field-wise. Deny on any
# mention of an env file rather than silently allowing the call through.
if ! command -v jq >/dev/null 2>&1; then
  printf '%s' "$input" | grep -q '\.env' &&
    deny 'Blocked: jq unavailable, so this guard cannot inspect the call and fails closed.'
  exit 0
fi

tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)
payload=$(printf '%s' "$input" | jq -r '.tool_input | if type=="string" then . else tojson end' 2>/dev/null)
[ -n "$payload" ] || exit 0

# Strip the permitted token. The trailing guard keeps .env.example.bak (a real
# file, not the placeholder) from being stripped and slipping through.
strip_example() { sed -E 's/\.env\.example($|[^.[:alnum:]_-])/\1/g'; }

case "$tool" in
  apply_patch)
    # Only the patch's path headers name files; the body is content.
    paths=$(printf '%s' "$payload" | grep -Eo '\*\*\* (Add|Update|Delete) File: [^\\"]*|\*\*\* Move to: [^\\"]*')
    printf '%s' "$paths" | strip_example | grep -q '\.env' && deny "$REASON"
    ;;
  *)
    printf '%s' "$payload" | strip_example | grep -q '\.env' && deny "$REASON"
    ;;
esac
exit 0
