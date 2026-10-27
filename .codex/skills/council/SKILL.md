---
name: council
description: Convene Codex and Claude models in AoE to cross-critique existing plans, grill the user, discuss disagreements, and converge on an audited solution. Also supports independent proposals from a brief, with GPT Sol or Claude Opus moderation.
---

# Council

Run a bounded discussion across model families. Use the bundled Python runner: it creates visible AoE participant and moderator sessions, exchanges complete written arguments through private turn files, and saves a decision. The invoking conversation remains the user's point of contact; the chosen moderator is a separate model session.

Accept natural invocations such as `$council moderator sol - find the strongest solution --codex-plan <src> --claude-plan <src>` or `/council moderator opus ...`. Translate these into the runner arguments below. This invokes the skill, not a shell command. Grilling is enabled by default; honor an explicit `--no-grill`.

## Prepare

- Extract the question, constraints, decision criteria, relevant evidence, and explicit non-goals from the conversation. Preserve the user's actual choices. Ask only for missing information that prevents a useful discussion.
- Write a self-contained brief outside the project (for example, a temporary file). Child models do not inherit this conversation. For code questions, include the repository path, exact commit, dirty-state caveat, and relevant source excerpts. For factual questions, include verified sources. Do not include credentials or unrelated private material.
- When plans already exist, resolve both sources and use `--codex-plan` and `--claude-plan`. The runner accepts local UTF-8 files; fetch linked Docs, Notion pages, URLs, or prior-session artifacts using their appropriate tools and save faithful local snapshots with source attribution. Preserve original wording, assumptions, and rationale; do not replace the plans with your summary. Both plans are required together. The runner copies and hashes originals without editing the sources.
- Existing-plan mode requires one Codex and one Claude participant. Each receives both originals and independently critiques them before seeing the peer's critique. Fresh counselors represent inherited plans; they are not continuations of the original author sessions and must not invent remembered rationale.
- The council reasons over this packet. Child calls have tools disabled; they cannot independently inspect code, browse, or run experiments. Gather evidence in the invoking session first. Treat missing evidence as an unresolved question; gather it and convene a follow-up when necessary.
- Default participants: `codex:gpt-6-astra` and `claude:claude-opus-5-5` (aliases `astra` and `opus`). Default moderator: `sol` in Codex, `opus` in Claude, unless the user chooses otherwise. `sol` resolves to `codex:gpt-6.1-sol`; `opus` to `claude:claude-opus-5-5`. Exact `provider:model` values are supported. Do not silently substitute a failing/unavailable model. Print the chosen roster and each role's effort before starting.
- Effort defaults to **medium for every counselor and the moderator**. `--effort low|medium|high` changes the shared default; append `@effort` to an individual member or moderator to override it, e.g. `--member astra@medium --member opus@high --moderator sol@medium`. `med` and `hi` normalize to `medium` and `high`. Explicit per-role settings take precedence over the shared default and persist across interviews/resumes. Translate natural requests such as “Astra on med, Opus on hi” accordingly. Never raise another role's effort merely because one role uses high.

## Run

Resolve `scripts/council.py` relative to this SKILL.md. The personal installation is shared by `~/.codex/skills/council` and `~/.claude/skills/council`.

```bash
python3 ~/.codex/skills/council/scripts/council.py start \
  --moderator sol --question "Find the strongest solution" \
  --codex-plan /absolute/path/to/codex-plan.md \
  --claude-plan /absolute/path/to/claude-plan.md

python3 ~/.codex/skills/council/scripts/council.py start \
  --brief /absolute/path/to/brief.md --moderator opus \
  --member astra@medium --member opus@high --rounds 2
```

Supply `--brief` alongside plans when the conversation adds goals, constraints, or evidence; put the requested objective in that brief too. Without `--brief`, paired plans use `--question` as the brief. Without plans, a brief is required and the council generates independent proposals.

`start` returns the run directory immediately. The coordinator runs in the background and launches three AoE sessions under a unique `council/<run-id>` group. AoE owns the session lifecycle; file mailboxes carry prompts/results, so terminal text or AoE's idle indicator is never used as a completion signal. Calls start fresh each turn with the full authorized transcript, preventing hidden conversation state from contaminating independent proposals.

```bash
python3 ~/.codex/skills/council/scripts/council.py status /absolute/run/directory
python3 ~/.codex/skills/council/scripts/council.py stop /absolute/run/directory
```

Monitor status every 15–30 seconds and give concise progress updates during longer runs. Read `decision.md` once status is `complete`; read `state.json` and the named turn logs on failure. Do not report success from process launch alone. If interrupted, recover using the run path. `stop` requests cancellation and stops only this run's AoE sessions, verified by title and directory. Never run `aoe killall`.

Runs live in `~/.local/state/model-council/runs/` by default. `--root` overrides that location; `--profile` selects an existing AoE profile. `--turn-timeout` defaults to 600 seconds, `--deadline` to 3600 seconds of active time, and `--words` to 700 words per reply. `--rounds` allows 1–3 discussion rounds (default 2). `--grill-rounds 1` asks before discussion; the default `2` also asks after the proposed solution. For two participants, no grilling uses `6 + 3 × rounds` calls; one interview adds 3, and two add 7. Pauses consume no model calls or active-time budget. A timeout, failed model, empty answer, or permission error fails the run; never invent the missing contribution or auto-retry with a different model.

## Grill and discuss with the user

When status is `waiting_user`, the coordinator has saved an interview checkpoint, stopped its workers, and exited. `status` includes the question ID, full questions, and their file path. The run can wait across conversation turns or restarts; it does not expire or continue because the user is silent.

- Present the moderator's batch of at most three questions through the invoking chat, preserving counselor attribution and why answers matter. Expand labels such as `member-1` into the corresponding model name from the run roster. Use the host's async question tool if available, otherwise ask directly. Keep the run path and question ID in conversation context. Do not ask the user to operate AoE or relay messages manually.
- Grilling means probing constraints, contradictions, concrete failure scenarios, and tradeoffs respectfully. The counselors should challenge both plans and assumptions held by the user. Avoid leading questions that merely seek endorsement.
- Preserve the user's actual reply, including questions back to counselors, objections, partial answers, and explicit deferrals. Do not synthesize answers from earlier assumptions, mistake a default choice for a submitted answer, or interpret silence as consent. An unanswered question stays unknown. If the user explicitly asks to proceed with assumptions, record that direction verbatim.
- Write the reply to a local text file, then submit it with the exact pending question ID:

```bash
python3 ~/.codex/skills/council/scripts/council.py answer /absolute/run/directory \
  --question-id grill-1 --answers /absolute/path/to/user-reply.md
```

This resumes the same run and AoE sessions. Completed model replies are reused without repeating calls. All subsequent participants and the moderator receive the user's reply. The second interview, `grill-2`, probes the draft and follows up on earlier answers; afterward the moderator revises and counselors audit it. If the user needs discussion beyond the configured interviews, preserve unresolved questions and continue in an explicitly requested follow-up council with the current decision and transcript as context.

If the user is away, leave the run pending and return the questions plus its run path. `waiting_user` is not failure or completion. Do not poll continuously while awaiting the user. A reply to a cancelled run, wrong question ID, or already answered checkpoint is rejected.

## Deliberation contract

1. **Diverge or cross-critique:** use supplied plans as immutable original proposals and start with independent critiques. Without plans, generate proposals from the same brief. Find the strongest solution; explain what would change each position.
2. **Grill:** counselors propose pointed questions; the moderator consolidates at most three. Pause for the user. Treat the answers as shared input, not a vote or implementation approval.
3. **Frame and discuss:** the moderator isolates disagreements. Participants answer user/moderator questions and challenge peer claims in parallel; the moderator synthesizes after each round. Exchange complete arguments, not only paraphrases.
4. **Follow up:** by default, interview the user again about the proposed solution, then revise using their answers.
5. **Audit and converge:** both counselors audit the proposal, then the moderator delivers one integrated solution, rationale, remaining dissent, evidence gaps, and next action. For original plans, track what was kept, changed, and dropped, and why. Agreement is not proof; unresolved disagreements and audits remain visible.

No participant should spawn more agents, read other runs, edit a project, send external messages, or implement the decision. Council invocation authorizes these model calls and their local AoE sessions; implementation remains governed by the user's task scope and repository instructions. Run artifacts are durable; sessions are stopped after success or failure and retained in AoE for inspection. Remove only the run's recorded session IDs when cleanup is requested.

## Deliver

Return the recommendation, material dissent/uncertainty, and a link to `decision.md`. Mention model failures or incomplete audits explicitly. The user's requested deliverable takes precedence over a generic decision format.
