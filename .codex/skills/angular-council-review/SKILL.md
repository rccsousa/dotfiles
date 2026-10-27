---
name: angular-council-review
description: Run a heavyweight blind multi-model review of a PR, branch, or commit range with independent proposals, cross-critique, moderation, and Crit/High/Medium/Low findings. Use only when the user explicitly asks for an angular council review, council review, cross-model review, or invokes $angular-council-review.
---

# Angular council review

Heavyweight exact-head review: target checkout → risk assessment → evidence pass → independent blind proposals → cross-critique → moderator audit → ranked findings + draft review. No user grill by default. Nothing is posted, committed, pushed, or filed.

This skill uses the runner at `../angular-review/scripts/angular_review.py` and the `council` skill. Read `../council/SKILL.md` before starting the council.

## Invocation

`/angular-council-review <PR#|branch|base..head|base...head> [flags]`

Supported runner flags: `--members`, `--moderator`, `--role`, `--base`, `--no-escalate`, and `--dry-run`. Pass `--grill` to the council only when the user explicitly requests questions; default is `--no-grill` with two discussion rounds.

## Prepare and evidence

Run from the target repository:

```bash
python3 ~/.codex/skills/angular-review/scripts/angular_review.py prepare <target> --host claude|codex [flags]
```

Claude may equivalently use `~/.claude/skills/angular-review/scripts/angular_review.py`; both installations point to the same source. Relay the printed roster, effort, escalation reason, exact SHAs, and run path before evidence work.

Gather targeted tests/typechecks and unchanged consumer excerpts. Each proposal reviewer must receive the same neutral evidence packet and must not receive host findings, previous reviews, GitHub comments, or another model's conclusions before its first pass. Host conclusions are used only to verify the council output afterward.

Build the brief with the runner. If source files are omitted, report the evidence gap before proceeding.

When the change adds an HTTP operation or changes where one is published, put the generated publication output (OpenAPI/API reference, SDK, MCP/tool list diff) in the excerpts, and append this instruction to `brief.md`, outside the contract, before starting the council:

- **Endpoint publication.** When the change adds an HTTP operation or changes where one is published (generated OpenAPI/API reference, SDKs, MCP/tool discovery), establish its intended audience from the PR body, linked requirements, or existing contracts, and check the generated publication output in the packet, not only decorators. Treat this as an explicit requirement: an operation is not published before its audience is established. Authentication, authorization, environment gates, and gateway routing do not establish audience, and neither does a precedent elsewhere in the codebase. If the audience is unstated, or contradicts where the operation is published, report a High finding framed as a blocking question, verified against the generated output.

## Finding contract

Every reviewer and moderator must apply this gate:

> Find only concrete defects introduced by this change. Rank them Critical, High, Medium, or Low. Every finding must identify an exact file/line, reachable inputs and state, wrong outcome, impact, concise fix, and verification status. Report a finding only when the scenario contradicts repository behavior, an explicit requirement, an ADR, or an authoritative external contract. An intentional documented policy choice is not a defect merely because another policy is possible; record it as a load-bearing assumption or evidence gap unless its supported execution produces a concrete unsafe or incorrect outcome. Verify external-product semantics from primary documentation. Separate fact from inference. Reject style advice, generic hardening, speculative possibilities, pre-existing defects, and unsupported product requirements. `REQUEST_CHANGES` requires at least one Critical or High finding.

Agreement is not proof. The moderator must independently verify the scenario against the packet, preserve dissent, and downgrade or drop claims that fail the gate.
An endpoint-publication finding is not a design choice: the moderator and the host's verification keep it unless the PR body, a linked requirement, or an existing contract establishes the audience and the published surface matches it.

## Council

Run the generated council command with `--no-grill` unless the user explicitly asks to be grilled. Monitor every 15–30 seconds. Do not substitute failed models silently. Follow the `council` skill for lifecycle and failure handling.

## Deliver

Write the run's review artifact with:

1. Roster, efforts, escalation reason, and run path.
2. Findings ranked Critical / High / Medium / Low with `file:line`, reachable scenario, impact, fix, verification, and dissent.
3. Load-bearing assumptions and evidence gaps.
4. Concise draft PR review: blocking Critical/High first; non-blocking Medium/Low separately.

In chat: verdict, counts per severity, one line per blocking finding, dissent that changes confidence, and artifact path. Never post without explicit approval after the user sees the draft.

## Rules

- Blind proposal phase: no first-pass anchoring or peer output.
- Cross-critique begins only after every independent proposal completes.
- No user grill unless explicitly requested.
- No GitHub posts, replies, commits, pushes, issues, or destructive Git operations.
- Preserve dirty user work. Review artifacts belong outside tracked project files.
