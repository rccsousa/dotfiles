---
name: pre-pr-gate
description: Use when the user says "pre-pr gate", "run adversarial-reviewer on this branch/worktree", "same flow for the next PR", or "open a crit session". Gates a finished branch before its draft PR opens — adversarial review, fix crit/hi/med, local crit review, draft PR.
---

# Pre-PR gate

Gate a finished branch before the draft PR opens: adversarial review → fix CRITICAL/HIGH/MEDIUM → verify → commit → local `crit` review → draft PR.

## Project overlay

Before step 1, read `<repo>/.claude/pre-pr-gate.md` if it exists. It carries the
project's verify commands, ticket-prefix convention, issue-tracking file layout,
and project-specific traps. Overlay wins over anything generic here. If it is
missing, derive the equivalents from the repo (`package.json` scripts, CI
workflow, `CLAUDE.md`) and state the assumptions you made.

## Models

Every agent in this gate runs Opus 5.5 (`model: "opus"`), never Fable/Sonnet/Haiku, whatever the session model is. Effort: reviewer + verification = high (workflow `agent()` → `{model: "opus", effort: "high"}`); fix worker (step 4) = medium.

## Inputs

- Branch, or worktree path (often `.worktrees/<name>`). Run everything from there; never `cd` back to the main checkout.
- Ticket scope: the ticket's section in the project's issue/PRD file, plus any `reference_*` memory for the subsystem involved.

## Steps

0. **Provider gaps.** If the plan has `provider_gaps` with any entry not `resolved`/`workaround-approved` that touches this branch, stop: no gate, no PR. Report it to Rui.
1. **Inspect stacking first.** `git log --oneline <base>..HEAD`, `git merge-base <base> HEAD`. If the branch stacks on a previous PR branch that has since been rewritten, the review range is only this PR's commits. Fix with `git rebase --onto <current-parent-head> <old-parent-head>` (dry run: `git merge-tree --write-tree`). Rename the branch to the project's convention if it is not already. Both are ref mutations: propose, apply on approval.
2. **Dispatch `adversarial-reviewer`** on the isolated range (`git diff <parent>..HEAD`). Brief: files in scope, the ticket/PRD section verbatim or summarised, sibling implementations to compare against, what is explicitly out of scope so the reviewer does not flag its absence. Ask for CRITICAL/HIGH/MEDIUM only, `file:line`, failure scenario, minimal fix, commands run with counts, plain diff summary, verdict. No git writes.
3. **Report** findings + your recommendation per finding (apply / widen / defer-to-backlog). Add the non-code items from step 1. Wait for the user's go.
4. **Apply** via a `general-purpose` agent (edit + verify + report, no git writes). Then in the main thread run the project's verify chain — type-check, targeted specs, formatter, full suite, dead-code check (overlay names the exact commands). A dead-code checker failing on unused new files/exports is a CI blocker: wire the module where its siblings are wired, or un-export.
5. **Deferred findings** go into the project's issue file under the ticket that picks them up. Mark carried items done when a slice closes them.
6. **Stage, propose the commit message, wait for explicit "commit approved".** Conventional commit, project ticket suffix, normal prose (not caveman).
7. **Crit session**: `crit stop` any stale daemon, then `crit --range <parent>..HEAD --base-branch <parent>` (committed range only). Arm a Monitor polling `crit comments --json | jq length`. Reply with `crit comment --reply-to <id> "..."`. Give the user a review map: files ordered by risk, line anchors for the load-bearing sections, what to skip, which specs are unverified.
8. **Draft PR on approval**: push, `gh pr create --draft --base <parent-branch>` using the repo's PR template plus a What/Why/How body. No internal ticket aliases anywhere in PR text. If the PR stacks on another open PR, link them: `gh stack link <bottom-pr> <top-pr>` (bottom to top; grow an existing stack with `gh stack link <stack-number> <new-pr>`). Then `crit stop`, stop the Monitor.
9. If the change needs infra (new env var/secret), draft a handoff file at repo root for the infra agent and `pbcopy` it on request.

## Traps

- `grep -r` is blocked by a hook; use `rg`.
- Specs gated behind env vars (`describe.skipIf`) are **unverified**, never "passed" — say so explicitly.
- Shared git stash across worktrees: never bare `git stash`.
- Generated/pinned API schemas usually need specific env vars to regenerate reproducibly — overlay names them.
- Captured third-party responses used as fixtures: redact the parsed body, never persist the raw response string, scan for identity values before committing.
- Fixtures and contract specs follow the layout the existing provider/module tests use, so the existing CI job picks them up. No per-feature CI jobs, no root-level test configs.
