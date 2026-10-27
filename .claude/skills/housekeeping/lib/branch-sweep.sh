#!/usr/bin/env bash
# branch-sweep.sh — delete local branches except an explicit keeper list.
#
# Usage:  branch-sweep.sh <keeper1> [keeper2 ...]
#   `main` is ALWAYS kept implicitly; pass the other branches to preserve.
#   Everything else is deleted with `git branch -D` (catches unmerged too).
#
# Runs `git fetch --prune origin` first to drop stale remote-tracking refs.
# Branches checked out by a worktree are refused by git (built-in safety) —
# that's expected; they're reported as "refused (in use)", not an error.
#
# Deterministic: sweeps by the caller's keeper list. The skill owns the
# decision of WHAT to keep — this only executes it.
set -euo pipefail

git fetch --prune origin --quiet

# Keeper set: main + everything passed in.
declare -A keep=([main]=1)
for k in "$@"; do
  keep["$k"]=1
done

deleted=()
refused=()

while IFS= read -r b; do
  [ -z "$b" ] && continue          # empty line when cwd has no current branch
  [ -n "${keep[$b]:-}" ] && continue
  if git branch -D "$b" >/dev/null 2>&1; then
    deleted+=("$b")
  else
    refused+=("$b")                 # in use by a worktree, or already gone
  fi
done < <(git branch --format='%(refname:short)')

echo "SWEEP kept: main $*"
echo "SWEEP deleted (${#deleted[@]}): ${deleted[*]:-none}"
echo "SWEEP refused (${#refused[@]}): ${refused[*]:-none}"
