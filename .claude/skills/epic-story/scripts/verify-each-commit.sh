#!/usr/bin/env bash
# Usage: verify-each-commit.sh <base-ref> "<verify command>"
# Checks out every commit in <base>..HEAD (oldest first) in a detached temp worktree
# and runs the verify command there. Prints a pass/fail table; exits 1 if any fail.
set -uo pipefail

base="${1:?base ref required, e.g. origin/main}"
cmd="${2:?verify command required}"
repo="$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/verify-each-commit.XXXXXX")"
wt="$tmp/wt"
logs="${TMPDIR:-/tmp}/verify-each-commit-logs/$(basename "$repo")"; rm -rf "$logs"; mkdir -p "$logs"

commits=$(git rev-list --reverse "$base"..HEAD)
[ -z "$commits" ] && { echo "no commits in $base..HEAD"; exit 1; }

git -C "$repo" worktree add --detach "$wt" "$(echo "$commits" | head -1)" >/dev/null 2>&1 || { echo "worktree add failed"; exit 1; }
cleanup() { git -C "$repo" worktree remove --force "$wt" >/dev/null 2>&1; rm -rf "$tmp"; }
trap cleanup EXIT

fail=0; n=0; lock=""
printf '%-3s %-9s %-6s %s\n' "#" "sha" "result" "subject"
for sha in $commits; do
  n=$((n+1))
  git -C "$wt" checkout --quiet --detach "$sha"
  newlock=$(git -C "$wt" rev-parse "HEAD:bun.lock" 2>/dev/null || echo none)
  if [ "$newlock" != "$lock" ] && [ -f "$wt/package.json" ]; then
    (cd "$wt" && bun install --frozen-lockfile >/dev/null 2>&1) || true
    lock="$newlock"
  fi
  if (cd "$wt" && bash -c "$cmd" >"$tmp/log-$n.txt" 2>&1); then r=pass; else r=FAIL; fail=1; cp "$tmp/log-$n.txt" "$logs/commit-$n.log"; fi
  printf '%-3s %-9s %-6s %s\n' "$n" "${sha:0:8}" "$r" "$(git log -1 --format=%s "$sha")"
done

[ $fail -eq 1 ] && echo "failing logs: $logs/commit-<n>.log"
exit $fail
