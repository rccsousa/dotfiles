#!/bin/zsh
# PostToolUse(Write|Edit): a *.plan.yaml write pokes the live hub; service down → static rebuild in the background.
f=$(jq -r '.tool_input.file_path // empty')
[[ "$f" == *.plan.yaml || "$f" == *.plan.yml ]] || exit 0
curl -sf -m 2 -X POST http://127.0.0.1:4747/rebuild >/dev/null 2>&1 && exit 0
(~/.bun/bin/bun ~/.claude/skills/orchestrator-plan/scripts/build-hub.ts >/dev/null 2>&1 &)
exit 0
