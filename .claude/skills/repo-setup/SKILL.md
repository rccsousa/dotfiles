---
name: repo-setup
description: One-time per-repo config for Claude — detect, confirm, and record the repo's issue tracker, env loading, install/test/lint commands, branch/PR conventions, review bots, deploy branches and dev ports, so agents stop guessing. Use when starting work in a repo with no recorded config, when a rule says "per-repo setting; unknown → ask once" (e.g. the issue tracker), or when Rui says "/repo-setup", "set up this repo", "configure claude for this repo".
---

# repo-setup

Why: agents guessed per-repo facts and got them wrong (the .env.local assumption instead of direnv, `gh issue create` in a Linear repo, missing node_modules leading to unrun tests, loops that didn't know which review bots post). Record them once.

## Where the answers live

A `project_repo_config.md` in the repo's project memory dir (`~/.claude/projects/<slug>/memory/`) plus one index line in its `MEMORY.md`. This is private to Rui and never committed. Write to the repo's CLAUDE.md only if Rui asks, since that file is shared with the team.

Already exists → show it, re-detect, and propose a diff only for the fields that changed.

## Flow

1. **Detect (read-only, no questions yet).** Evidence per field:
   | # | Field | Look at |
   |---|---|---|
   | 1 | Issue tracker | project memory/CLAUDE.md mentions (Linear IDs in branches/commits: `git log --oneline -50`), `gh repo view --json hasIssuesEnabled`, `.github/ISSUE_TEMPLATE` |
   | 2 | Env loading | `direnv status` → "Loaded RC path" (don't name env files in Bash; a secrets hook blocks any command that does), dotenv imports in code |
   | 3 | Package manager + install | lockfile (`bun.lock`, `pnpm-lock.yaml`, `package-lock.json`, `uv.lock`, …) |
   | 4 | Test / typecheck / lint (+ which gate PRs) | `package.json` scripts, CI workflows `.github/workflows/*.yml` |
   | 5 | Branch naming, PR base, commit style | CLAUDE.md/CONTRIBUTING, `git branch -r`, recent PR titles `gh pr list --state merged -L 20` |
   | 6 | Review bots | reviewer logins on recent PRs (`gh api repos/<o>/<r>/pulls/<n>/reviews`), `.coderabbit.yaml` |
   | 7 | Deploy branches → envs | CI deploy workflows, CLAUDE.md |
   | 8 | Dev stack: start command + ports | `dev` scripts, docker-compose, CORS config |
2. **Confirm.** One table: field / detected value / evidence / confidence. Ask Rui in a single round, using AskUserQuestion, only about fields that are low-confidence or missing. Always confirm #1 (tracker) explicitly, because it gates filing issues.
3. **Write** the memory file after Rui approves the table: one line per field, plus **Why** ("detected + confirmed <date>") and **How to apply** ("consult before filing issues, loading env, running verification, or starting dev").
4. **Cross-link** existing repo memories that hold the same fact (e.g. a tracker rule); don't duplicate them.

## Rules

- Never read env-file contents; detect the loader via `direnv status`.
- Only `gh` read calls. No installs, no dev-stack starts during setup.
- A field Rui declines stays `unknown`. Agents then ask at the point of use and save the answer here.
