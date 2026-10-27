#!/usr/bin/env bash
# plans-triage.sh — scan plans/*.md and report each plan's PR + reference state.
#
# Usage:  plans-triage.sh [plans-dir]      (default: plans)
#
# For every plan file it emits a machine line the skill reasons over:
#   PLAN <file> <pr:NNN|none> <state:MERGED|OPEN|CLOSED|-> <branch:gone|live|-> <claudemd:yes|no>
# plus a readable table. Search keyword = the plan's filename stem.
#
# Deterministic scan only: looks up PRs + greps CLAUDE.md. It does NOT delete
# anything — the skill decides disposition (merged+branch-gone → delete;
# referenced by CLAUDE.md or active untracked work → keep; open/closed → ask).
set -euo pipefail

dir="${1:-plans}"
if [ ! -d "$dir" ]; then
  echo "no $dir/ directory — nothing to triage" >&2
  exit 0
fi

claudemd="CLAUDE.md"

printf '%-40s %-8s %-8s %-8s %-8s\n' "PLAN" "PR" "STATE" "BRANCH" "IN-CLAUDE"
printf '%-40s %-8s %-8s %-8s %-8s\n' "----" "--" "-----" "------" "---------"

shopt -s nullglob
for plan in "$dir"/*.md; do
  base="$(basename "$plan")"
  stem="${base%.md}"

  pr_num="none"; state="-"; branch="-"; head=""
  # Newest matching PR by keyword; tolerate gh absence / no match.
  if command -v gh >/dev/null 2>&1; then
    row="$(gh pr list --state all --search "$stem" \
             --json number,state,headRefName --limit 1 \
             --jq '.[0] | "\(.number)\t\(.state)\t\(.headRefName)"' 2>/dev/null || true)"
    if [ -n "$row" ] && [ "$row" != "null" ]; then
      pr_num="$(printf '%s' "$row" | cut -f1)"
      state="$(printf '%s' "$row" | cut -f2)"
      head="$(printf '%s' "$row" | cut -f3)"
    fi
  fi

  # Branch existence (local or remote) — "gone" is a delete signal for merged PRs.
  if [ -n "$head" ]; then
    if git rev-parse --verify --quiet "refs/heads/$head" >/dev/null \
       || git rev-parse --verify --quiet "refs/remotes/origin/$head" >/dev/null; then
      branch="live"
    else
      branch="gone"
    fi
  fi

  in_claude="no"
  if [ -f "$claudemd" ] && grep -qF "$base" "$claudemd" 2>/dev/null; then
    in_claude="yes"
  fi

  printf '%-40s %-8s %-8s %-8s %-8s\n' "$base" "$pr_num" "$state" "$branch" "$in_claude"
  echo "PLAN $base pr:$pr_num state:$state branch:$branch claudemd:$in_claude"
done
