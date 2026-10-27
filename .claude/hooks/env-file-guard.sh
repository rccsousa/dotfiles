#!/bin/sh
# PreToolUse guard: .env* and .envrc are unreadable and unwritable, with exactly
# one carve-out — .env.example, which holds placeholder keys rather than secrets.
#
# Why a hook and not settings.json deny rules:
#   1. Deny rules are evaluated before allow and specificity does not break the
#      tie, so a deny cannot carry an exception. "Deny .env* EXCEPT
#      .env.example" is inexpressible as a permission rule.
#   2. Read()/Edit() rules are per-tool and do not constrain Bash, so
#      `cat .envrc` walks straight past them. This hook also matches Bash.
#
# Layering: the known-dangerous names (.env, .env.local, .env.production, ...)
# are ALSO denied statically in settings.json. Those never need an exception, so
# they stay on the stronger layer and survive this hook being disabled. This
# hook covers the unpredicted names (.env.qa, .env.secrets, ...) and the carve-out.
#
# Fail-CLOSED: unparseable input denies rather than falling through.

deny() {
  if command -v jq >/dev/null 2>&1; then
    reason=$(printf '%s' "$1" | jq -Rs .)
  else
    reason='"Blocked by env-file-guard.sh: env files may hold live credentials."'
  fi
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$reason"
  exit 0
}

input=$(cat)

# Degraded path: without jq the payload cannot be parsed field-wise. Deny on any
# mention of an env file rather than silently allowing the call through.
if ! command -v jq >/dev/null 2>&1; then
  printf '%s' "$input" | grep -q '\.env' &&
    deny 'Blocked: jq unavailable, so this guard cannot inspect the call and fails closed.'
  exit 0
fi

tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)

case "$tool" in
  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
    [ -n "$cmd" ] || exit 0
    # Remove the permitted token, then deny if any env reference survives. The
    # trailing guard keeps .env.example.bak (a real file, not the placeholder)
    # from being stripped and slipping through.
    stripped=$(printf '%s' "$cmd" | sed -E 's/\.env\.example($|[^.[:alnum:]_-])/\1/g')
    printf '%s' "$stripped" | grep -q '\.env' &&
      deny 'Blocked: .env*/.envrc may hold live credentials, and Read/Edit deny rules do not cover Bash. Only .env.example is permitted. If you need a value from one, ask the user for it.'
    ;;
  Read|Edit|Write|NotebookEdit)
    path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
    [ -n "$path" ] || exit 0
    base=${path##*/}
    case "$base" in
      .env.example) exit 0 ;;
      .env*|*.envrc)
        deny 'Blocked: .env*/.envrc may hold live credentials. Only .env.example (placeholders) is permitted.'
        ;;
    esac
    ;;
esac
exit 0
