---
name: epic-story
description: Try a plan before committing to it, then ship the epic as a linear story of commits. Phase 1 spikes the whole plan on a throwaway branch to find what the plan got wrong; phase 2 folds that back into the plan; phase 3 rebuilds the work from base as one commit per story step, each building, passing its tests and reviewable on its own (by Rui or an agent), then verifies every commit and ships one mega PR or several. Use when a plan's `meta.mode` is `epic-story` (Rui picks the mode after /orchestrator-plan), or when Rui says "spike the plan", "try the plan first", "story commits", "mega PR", "crystallize the commits", "make the history reviewable".
---

# epic-story

Rui's way of working since 2026-09-25. Pairs with `/orchestrator-plan` (the plan and its `plan.yaml`) and `/pre-pr-gate` (the per-PR gate).

**Every stop for Rui below is also an `open` entry** (owner `rui`, `blocks` naming the phase or step) so he can answer it from the plan hub. Fold answers per `/orchestrator-plan` "Questions for Rui and the answers inbox" before resuming.

**Why:** a plan written before any code is a guess. A spike tests the guess cheaply. The spike's history is noise, so the real branch is rebuilt as a story that a reviewer (human or agent) reads one commit at a time, top to bottom, without holding the whole epic in their head.

## Phase 1: Spike (try the plan)

1. Worktree + branch from a fresh base: `git fetch origin && git worktree add .worktrees/<slug>-spike -b spike/<slug> origin/main`. The orchestrator may create it; it's throwaway.
2. Implement the plan end to end, fast. Goal is **finding what's wrong with the plan**, not polish:
   - wrong slice order, missing seams, a slice that's really two, two that are really one;
   - decisions that don't survive contact with the code; unknowns that turned out to block;
   - effort and LOC estimates that were off.
3. Tests: enough to prove each path works (happy path + the invariant the plan says matters). No coverage chase.
4. WIP commits are fine on `spike/*`, made by the orchestrator (agents still make no git writes). **Never push a spike branch and never open a PR from it.**
5. Time-box it: ~20–30% of the epic's estimated effort. If the spike blows past that, stop and report; the plan is probably wrong in a way that needs Rui. Record it as `open` `Q-SPIKE` (blocks `phase-2`).

## Phase 2: Crystallize the plan

1. Write a **spike report**: what matched the plan, what didn't (with file:symbol evidence), new or changed decisions, revised slice list, revised estimates.
2. Update `plan.yaml` (slices, `needs`, decisions, estimates) and regenerate the HTML human view (`/orchestrator-plan`). Add a `spike` block: branch, head SHA, findings.
3. Write the **storyboard** in `plan.yaml` (below). This is the commit order the real branch will have.
4. **Stop for Rui's approval** of the revised plan and storyboard: `open` `Q-STORY` (blocks `phase-3`), its ask naming what changed since the plan. Nothing in phase 3 starts before it resolves. Ask in the same pass, as its own `open` entry, whether story commits may be made locally without per-commit approval (phase 3 step 4).

### Storyboard (`plan.yaml`)

```yaml
story:
  - n: 1
    slice: "01"                 # plan slice it belongs to (a slice may span commits)
    subject: "feat(imports): parse CSV rows with per-row errors [PROJ-102]"
    role: "Parser turns a file into rows; nothing uses it yet."
    establishes: "parseOrderCsv streams rows, optional columns default to null (Q-B)"
    verify: "bunx tsc --noEmit && bunx vitest run src/imports/parser"
    state: todo                 # todo|building|review|committed
    sha: null
```

### Story rules

- **Order tells the story:** contracts/types → pure logic → persistence/migrations → executors/side effects → wiring → flags/enablement → docs/runbooks. A reader never meets a symbol before the commit that introduces it.
- **One step per commit.** Refactors are their own commits, placed before the behaviour that needs them. Tests ship in the same commit as the behaviour they cover.
- **Every commit stands alone:** type-checks, its `verify` passes, lint/format clean. The dead-code check passes at every commit: wire new code in the same commit, or keep it unexported until the wiring commit.
- **No commit fixes an earlier one.** Review fixes become `fixup! <subject>` and get autosquashed into the commit they fix.
- **Reviewable in one sitting.** If a commit needs the reader to hold more than one idea, split it.
- **Messages:** conventional subject with ticket suffix, plus a 1–3 line body: the commit's role in the story (from `role`), and what the next commit builds on. Plain prose, no planning labels (D-n, Q-x) and no customer names. This overrides `/create-commit`'s one-liner rule for story commits only.

## Phase 3: Build the story

1. Fresh worktree + branch from base (never from the spike): `rs/<ticket>/<slug>`.
2. For each story step, in order:
   1. **Implement** (agent, no git writes). It may port code from the spike (`git show spike/<slug>:<path>`), but must fit the step's scope: nothing from later steps.
   2. **Adversarial review of this step only** (`git diff` of the uncommitted step), with the storyboard and prior commit subjects as context. Crit/hi/med, file:line, failure scenario, fix. Also check the story rules: forward references, scope bleed, dead code.
   3. **Fix**, then run the step's `verify`.
   4. **Commit** with the storyboard subject and body. The orchestrator commits locally once the gate passes **only if Rui authorized that for this epic**; otherwise propose and wait for "commit approved". Update `state` and `sha` in `plan.yaml`.
3. If a step reveals the storyboard is wrong, stop, amend the storyboard, and tell Rui before continuing: `open` `Q-STORY-<n>` (blocks `story:<n>`). Don't silently reorder.

## Phase 4: Verify every commit, then ship

1. Run `scripts/verify-each-commit.sh <base> "<verify cmd>"` from the branch's worktree. It checks each commit in a detached temp worktree and prints a pass/fail table. Also run the project's full verify chain (integration suite, dead-code check, OAS pin) once on the tip.
2. Every commit must pass. Fix a failing commit with a `fixup!` commit, squash it non-interactively with `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <base>`, then re-run the script.
3. Ship, offering `/pre-pr-gate` as an optional HITL step. One mega PR (default for an epic) or split at story boundaries; either way the commits stay as built.
4. PR body (concise, What/Why/How) ends with **"Review commit by commit"** and the story list: `n. subject — role`.
5. After merge approval: the repo squash-merges, so the story lives in the PR. Leave `spike/<slug>` and its worktree for Rui to delete.

## Reviewing a story (humans and agents)

- Review in order, one commit at a time: `git show <sha>`, with the storyboard entry as the brief. The reviewer judges the commit against its `role` and `establishes`, not against the whole epic.
- Findings anchor to a commit SHA and file:line. The fix goes into that commit via `fixup!`, never into a new commit at the tip.
- For agent review, dispatch one reviewer per commit (or per few small commits), in parallel; each gets the storyboard plus that commit's diff only. Cross-commit issues (a later commit breaking an earlier invariant) get one final whole-range pass.

## Traps

- A spike tempts reuse wholesale. Copying the spike's final state into one commit defeats the point; port per step.
- Migrations: one per commit that needs it, numbered in story order. Renumber if the storyboard changes.
- Generated artifacts (OAS pin, lockfile) change in the commit whose source change causes them, not in a catch-all at the end.
- `bun install` is needed in the temp worktree when `bun.lock` changes between commits; the script handles it.
