#!/bin/sh
# Codex PreToolUse guard: deny recursive system-grep that can descend into
# hidden .env/.envrc/secret files and leak their contents into context.
#
# Why: BSD/GNU `grep -r` includes dotfiles and ignores RIPGREP_CONFIG_PATH, so
# a ripgreprc (which strips secrets from `rg`) does NOT protect it.
# Safe-fail by design: this hook only DENIES; it never rewrites the command.
#
# Port of ~/.claude/hooks/grep-secret-guard.sh. Codex reads the whole tool_input
# (a freeform JS program string for the `exec` tool) instead of .command.

command -v jq >/dev/null 2>&1 || exit 0
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input | if type=="string" then . else tojson end' 2>/dev/null)
[ -n "$cmd" ] || exit 0

# git grep respects gitignore and has different (pathspec) semantics — let it pass.
printf '%s' "$cmd" | grep -Eq '(^|[;&|]|[[:space:]])git[[:space:]]+grep' && exit 0

# Already excluding env/secret files? Allow.
printf '%s' "$cmd" | grep -Eq -- "--exclude(-dir)?=[\"']?\\\\?\.?env" && exit 0

# Recursive grep via short-flag cluster (grep -rn / -Rn / -nr ...)?
short='grep[[:space:]]+([^|;&]*[[:space:]])?-[a-zA-Z]*[rR][a-zA-Z]*([[:space:]]|$)'
# ...or via long flag (--recursive / --dereference-recursive)?
long='grep[[:space:]]+([^|;&]*[[:space:]])?--(recursive|dereference-recursive)([[:space:]=]|$)'

if printf '%s' "$cmd" | grep -Eq "$short" || printf '%s' "$cmd" | grep -Eq "$long"; then
  reason='Blocked: recursive `grep -r` uses system grep, which descends into hidden .env/.envrc and can leak secrets into context. Use `rg` instead (auto-excludes .env*/secrets/*.pem/*.key), or, if you must use grep, add: --exclude=.env* --exclude=.envrc --exclude=*.pem --exclude=*.key'
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' \
    "$(printf '%s' "$reason" | jq -Rs .)"
fi
exit 0
