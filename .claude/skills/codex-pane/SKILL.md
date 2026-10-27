---
name: codex-pane
description: >
  Open a WezTerm split pane next to the current Claude pane and start a Codex
  session in it. Use when Rui says "/codex-pane", "open codex in a pane",
  "split a pane and start codex", "codex side by side", or wants a live Codex
  session beside this one. Not for headless Codex calls (`codex exec`) — those
  run inline via Bash.
---

# Codex in a WezTerm split pane

## Preconditions

- `$WEZTERM_PANE` set → Claude runs inside WezTerm. If empty, stop and tell Rui (no WezTerm, no split).
- `codex` is a **zsh function** (tab-title watcher wrapping `command codex`) → must run through interactive zsh (`zsh -ic`), not exec'd directly.

## Launch

```bash
wezterm cli split-pane --pane-id "$WEZTERM_PANE" --right --percent 50 \
  --cwd "$PWD" -- zsh -ic 'codex <ARGS>; exec zsh'
```

- Prints the new pane id → keep it for follow-up.
- `; exec zsh` → pane survives Codex exit, drops to a shell.
- Direction: `--right` default; `--bottom` / `--left` / `--top` if Rui asks. `--percent` if he names a size.
- `<ARGS>`: empty by default. Rui gives a prompt → pass it quoted (`codex "<prompt>"`); watch nested quotes inside the `zsh -ic '…'` string. Other flags (`-m`, `-C <dir>`) pass through.
- Cwd: current working dir unless Rui names another (e.g. a `.worktrees/<name>` path).

## Verify

Poll the pane once or twice (a few seconds apart, via Monitor or a short until-loop, no foreground sleep):

```bash
wezterm cli get-text --pane-id <ID> | grep -v '^\s*$' | tail -15
```

- `Updating Codex via npm install -g @openai/codex...` → normal self-update on launch; report it, don't wait it out.
- Pane missing from `wezterm cli list` → launch failed; show the error.

## Report

One line each: pane id, what's running, state seen (booting / updating / prompt ready). Close command: `wezterm cli kill-pane --pane-id <ID>`.

## Talking to the pane afterwards

- Send input: `wezterm cli send-text --pane-id <ID> --no-paste '<text>'` then `printf '\r' | wezterm cli send-text --pane-id <ID> --no-paste`.
- Only send text into Rui's Codex pane when he asks.
