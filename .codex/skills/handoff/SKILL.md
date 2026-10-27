---
name: handoff
description: Create a concise, redacted task handoff for a fresh agent or session. Use when pausing work, moving work to another session or agent, preserving a decision packet, or preparing isolated planning, implementation, or review context.
---

# Handoff

Write a self-contained packet that lets a fresh agent continue without chat history.

## Include

- Goal and explicit non-goals.
- Current state, repository, worktree, branch, base, and relevant commit when applicable.
- Decisions already made and unresolved decisions that block work.
- Authoritative committed requirements and relevant paths.
- Files changed or expected ownership boundaries.
- Commands run with exact results.
- Risks, blockers, and the next concrete step.

For a review handoff, add the candidate base/head, changed paths, observable flow, load-bearing assumptions, and checks already run. Do not include prior reviewer findings in a blind-review packet.

## Constraints

- Keep it terse and factual. Do not reconstruct reasoning that no longer affects the work.
- Redact credentials, tokens, private URLs, customer data, and environment-file contents.
- Separate facts from assumptions. Label unresolved claims.
- Reference only artifacts the receiving agent can read. Embed necessary temporary context when it is not available there.
- Never claim a check passed unless its completed output was observed.

## Format

```markdown
# Handoff: <task>

## Goal
## Current state
## Decisions
## Relevant artifacts
## Verification
## Risks and blockers
## Next step
```
