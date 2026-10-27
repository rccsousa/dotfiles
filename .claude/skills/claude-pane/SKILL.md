---
name: claude-pane
description: >
  Open a WezTerm split pane next to the current pane and start an interactive
  Claude Code session in it, with a chosen model and effort. Use when Rui says
  "/claude-pane", "open claude in a pane", "claude side by side", or for model
  arena runs (same brief to several Claude/Codex configs in parallel panes).
  Codex counterpart: /codex-pane. Not for headless calls (`claude -p`).
---

# Claude in a WezTerm split pane

## Preconditions

- `$WEZTERM_PANE` set → running inside WezTerm. Empty → stop, tell Rui.
- `claude` is a plain binary (`~/.local/bin/claude`); still launch via `zsh -ic` so direnv/profile env loads.
- Model rules: global CLAUDE.md + `feedback_model_selection` memory. Fable/Haiku never.

## Launch

```bash
wezterm cli split-pane --pane-id "$WEZTERM_PANE" --right --percent 50 \
  --cwd "<DIR>" -- zsh -ic 'claude --model <MODEL> --effort <EFFORT> <ARGS>; exec zsh'
```

- `<MODEL>`: `claude-opus-5-5` default; `claude-sonnet-5-5` when Rui asks.
- `<EFFORT>`: `low|medium|high|xhigh|max`. Omit → inherits saved default.
- `<ARGS>`: optional prompt as last arg, quoted (`"<prompt>"`); watch nested quotes inside `zsh -ic '…'`. For long briefs, write to a file and pass `"$(cat <file>)"` or a short prompt "read <file> and do it".
- `<DIR>`: cwd unless Rui names one. Writing work → one `.worktrees/<name>` per pane, never two panes in one tree.
- Direction/size: `--right` default; `--bottom`/`--left`/`--top`, `--percent` on request.
- Prints new pane id → keep it.

## Arena mode (several configs, same brief)

1. Brief → one file in scratchpad (identical text for every contestant).
2. Per contestant: own worktree off the same base SHA (`git worktree add .worktrees/<label> -b <task-branch>-<label> <SHA>`, neutral label e.g. `impl-a`, then `bun install`).
3. Split panes: first split from `$WEZTERM_PANE`, then split further from the new pane ids (`--bottom`) to tile.
4. Claude contestants → this skill's launch line. Codex contestants → `/codex-pane` launch with `-m <model> -c model_reasoning_effort=<level>` and `-C <worktree>`.
5. Contestants must not commit/push; put that in the brief.
6. Blind contestants: the brief is a normal task. Never mention arena, comparison, other models, timing or scoring in the brief, worktree/branch names visible to them (use neutral labels like `impl-a`), or pane input.
7. Orchestrator monitors silently: record start time per pane; poll with `wezterm cli get-text` (read-only, never send nudges) and record finish time when the pane goes idle with its final report.
8. Quality: per contestant, run a separate, independent `/angular-review` of its worktree diff against the base SHA. Reviewers see only an anonymised label, never model/effort; no reviewer sees another contestant's work.
9. Deliver a results table to Rui (label→model revealed only here):

| Label | Model | Effort | Wall clock | Tests / type-check | Crit | High | Med | Low | Scope / invented behaviour | Verdict |

   Plus a one-line ranking and recommendation for the model rule.

## Verify

Poll once or twice, a few seconds apart (Monitor/until-loop, no foreground sleep):

```bash
wezterm cli get-text --pane-id <ID> | grep -v '^\s*$' | tail -15
```

- Trust/permissions prompt on a fresh worktree → report it; Rui answers in the pane.
- Pane missing from `wezterm cli list` → launch failed; show the error.

## Report

One line each: pane id, model+effort, cwd, state (booting / prompt ready / working). Close: `wezterm cli kill-pane --pane-id <ID>`.

## Talking to the pane afterwards

- `wezterm cli send-text --pane-id <ID> --no-paste '<text>'` then `printf '\r' | wezterm cli send-text --pane-id <ID> --no-paste`.
- Only send text into a pane when Rui asks (arena brief kickoff counts).
