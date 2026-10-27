---
name: pending
description: Track and surface pending todo items across sessions and projects via a checkbox-tracked memory file. Project-aware — defaults to the current repo, `--all` spans everything. Triggers - "/pending", "what's pending", "what do I need to do", "cross X off", "mark X done", "add X to pending".
---

# pending

Single source of truth: `~/.claude/memory/pending_global.md` (one global file for every project). Each item carries a `**Project:**` tag. All operations are deterministic markdown edits — no LLM creativity in the storage layer.

## Project scope

- **Current project slug** = basename of the session cwd (e.g. cwd `~/projects/homewalk` → `homewalk`). Derive it once per invocation.
- **Default view is scoped to the current project.** `/pending` inside a repo lists only that repo's items. This is the filtered "project-pending" view — no separate skill needed.
- **`--all` / "all projects" / "global"** spans every project, grouped by project.
- `--project <slug>` filters to a named project other than the current one.

## File format

```markdown
---
name: pending-global
description: Global cross-project pending items, checkbox-tracked. Each item tagged with a project slug. Surface when user asks "what's pending".
metadata:
  type: reference
---

## Active

- [ ] <id> — <title>.
  **Project:** <slug>.
  **Why:** <reason>.
  **Surface:** <YYYY-MM-DD | anytime>.

## Archive

- [x] <id> — [<slug>] <title>. (done <YYYY-MM-DD>)
```

`<id>` = short kebab-case slug (e.g. `team-offsite`, `webhook-retry`). Derive from title if user doesn't supply. IDs are unique across the whole file (not per-project).

## Operations

### `list` (default — "what's pending")

1. Read `pending_global.md`. If missing → reply `No pending items.` and stop.
2. Compute the current project slug from cwd.
3. Filter **Active** items to `**Project:** == <current slug>` (unless `--all` / `--project <slug>`).
4. Of those, print items whose `Surface` is `anytime` or ≤ today. Hide future-dated unless user asks "show all pending".
5. Output: bulleted list, one line per item — `**<id>**: <title>` + a short `why` clause. Don't dump the full Why blob unless asked.
6. For `--all`: group under `### <slug>` headers, current project first.
7. If the current-project filter yields nothing but other projects have items, say so: `No pending for <slug>. N items in other projects — /pending --all to see.`

### `add <title>` ("add X to pending")

1. Derive `<id>` from title (kebab-case, ≤30 chars). If collision anywhere in Active, suffix `-2`.
2. Determine project: current slug, unless user names another (`add X to tether pending`).
3. Append under `## Active`:
   ```
   - [ ] <id> — <title>.
     **Project:** <slug>.
     **Why:** <reason if user gave one, else "(captured <today>)">.
     **Surface:** <anytime unless user specified a date>.
   ```
4. Reply `added: <id> [<slug>]`.

### `check <id>` / "cross X off" / "mark X done"

1. Locate the `- [ ] <id> ...` block in **Active**. Fuzzy phrase (`offsite`) → match on `<id>` substring then title text, preferring the current project on ties. Ambiguous → list candidates, ask which.
2. Move the item out of Active into **Archive** as a single condensed line, carrying the project tag inline:
   `- [x] <id> — [<slug>] <title>. (done <today>)`
3. Reply `crossed: <id>`.

Use `Edit` tool, not regex/sed. Read the file first, then two `Edit` calls (remove from Active, insert at top of Archive). Don't `Write` the whole file unless reformatting.

### `clear-archive`

Drop Archive entries dated >14 days ago. Keep ordering newest-first.

### `surface <id> <date>`

Update an existing Active item's `Surface:` line to the given date (or `anytime`).

### `move <id> <slug>`

Re-tag an item to a different project (update its `**Project:**` line).

## MEMORY.md index

This is a single global file, not a per-project memory. Ensure `~/.claude/memory/MEMORY.md` has one pointer line:

```
- [Global pending](pending_global.md) — cross-project pending; /pending filters to current repo
```

Do NOT add per-project MEMORY.md entries — the store is global now. If an old per-project `pending_active.md` or its `MEMORY.md` pointer still exists, it's an orphan from the pre-global model; migrate its items here and remove it.

## Conventions

- Dates are absolute (`2026-05-19`), never relative (`tomorrow`, `next week`). Convert at write time.
- One item = one logical action. Multi-step work belongs in a plan, not here.
- Project slug = cwd basename, consistently. Don't invent alternate slugs for the same repo.
- If the user asks for status of a known long-running thing (PR open, CI green) — check live state first, then update the item. Don't quote stale Archive lines as current truth.

## Out of scope

- Long-form project context → separate memory file with type=project.
- Recurring tasks → use `/schedule` or `/loop`.
