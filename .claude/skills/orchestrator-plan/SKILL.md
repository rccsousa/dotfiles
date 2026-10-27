---
name: orchestrator-plan
description: "Opt-in three-layer implementation planning: YAML state, agent instructions, and an HTML view. Use only when Rui explicitly requests orchestrator-plan, accepts an offer to use it, or asks to maintain an existing orchestrator-plan artifact. Ordinary planning, durable plans, multi-PR scope, and diagrams do not trigger this skill."
disable-model-invocation: true
---

# orchestrator-plan

Use this workflow only after Rui explicitly chooses it, or when maintaining an existing orchestrator-plan artifact. Before starting a new three-layer plan without that choice, ask whether he wants `/orchestrator-plan`; a short outline or diagram may suffice. Do not generate its artifacts while awaiting an answer.

**Plans using this workflow produce all three layers**, scaled to size. Other plans have no three-layer requirement. Plans already in implementation keep their old format unless Rui asks to convert them.

**Scaling:** a single-PR plan is a `plan.yaml` with one slice, a short instructions file, and an HTML page that keeps only the sections with content (usually header, mechanism diagram, table, decisions, ELI5). Multi-PR plans use every section.
## Implementation mode: always ask

Once the plan is written and before any implementation, **ask Rui** (AskUserQuestion) which mode to use, with a recommendation:

| Mode | Shape | Flow |
|---|---|---|
| `pr-chain` | one PR per slice, stacked (`gh stack link`) or standalone | each slice → (optional `/pre-pr-gate`) → `/drive-to-mergeable` |
| `epic-story` | spike first, then one mega PR of linear story commits | `/epic-story` → (optional `/pre-pr-gate`) → `/drive-to-mergeable` |

Record the answer as `meta.mode` in `plan.yaml` and show it in the HTML header. Never pick silently; if Rui doesn't answer, hold.
Visual reference: `reference/example.html`. Start from its structure, tokens, CSS and JS; replace the content.

## Three layers, each with one job

| Layer | File (under `.claude/handoffs/`) | Reader | Holds |
|---|---|---|---|
| **State** | `<slug>.plan.yaml` | agents, scripts | Everything that changes: slices, states, PRs, SHAs, decisions, open questions. **Single source of truth.** No prose. |
| **Instructions** | `<slug>-ORCHESTRATOR.md` + `<slug>-<id>-<name>.md` per slice | agents | Stable rules only: contract, non-negotiables, dispatch, report format. Imperative lines that cite yaml IDs. |
| **Human view** | `<slug>-ORCHESTRATOR.html` (self-contained, opens locally) | Rui, team | Rendered from the yaml, plus diagrams, ELI5, rationale. Never holds state the yaml lacks. |

Rationale, history and "why" belong in the human view (and decision `basis`), never in the instructions.

## Layer 1: `plan.yaml`

```yaml
meta: {slug: order-import, title: "...", parent: PROJ-100, repo: app, base: origin/main,
       human_view: .claude/handoffs/order-import-ORCHESTRATOR.html, published: null, updated: 2026-01-14T15:30,
       mode: null}   # pr-chain | epic-story, set by Rui
slices:
  - id: "05"                      # stable; never renumber
    title: "feat(imports): confirm import and freeze staged rows"
    ticket: PROJ-105
    track: A                      # optional grouping
    wave: 3
    needs: ["02", "03"]           # slice ids or external refs ("#201")
    effort: max                   # low|medium|high|xhigh|max
    loc: [2000, 3000]
    state: running                # todo|running|review|committed|pr-open|merged|frozen
    pr: null                      # number once open
    branch: rs/PROJ-105/...
    worktree: .worktrees/...
    handoff: <slug>-05-confirm-import.md
    critical: true                # on the critical path
decisions:
  - {id: D5, group: scope, status: active, rule: "Max import file size = 10 MB code constant", basis: "Rui 2026-01-13"}
open:
  - {id: Q-A, owner: product, status: open, blocks: ["04"], title: "Partial imports", ask: "can a merchant commit only the valid rows?"}
  # resolved: status: resolved, resolved_by: "D10 (Rui via hub 2026-01-15)"; never delete a question
external:
  - {ref: "#201", state: merged}
provider_gaps:
  - {id: G1, provider: acme-shipping, status: open, blocks: ["06"], need: "rate quote by parcel weight", have: "flat rates only (docs 2026-01-10)", options: "ask provider | change contract | workaround", decision: null}
  # status: open|asked-provider|resolved|workaround-approved; resolved/approved need decision: "<what> (Rui <date>)"
spike: null        # filled by /epic-story phase 2
story: []          # commit storyboard, owned by /epic-story
```

Rules:
- Decisions are **rules**, one line, testable. Reverted ones stay with `status: reverted` and a `superseded_by`.
- The orchestrator updates the yaml at every state change, **before** reporting. Agents read their slice entry; they never write the yaml.
- `provider_gaps` (see global CLAUDE.md "Provider capability gaps"): every provider operation a slice needs is checked against primary docs while planning; an empty list means checked, not skipped. A slice listed in an open gap's `blocks` does not start. Surface each open gap as an `open` question for Rui.
- PR states and SHAs are verified live (`gh pr view <n> --json state,mergeStateStatus,reviewDecision`, `git log`) when written. Never invent status, LOC or effort; unknown → `null`.

## Layer 2: instructions

- `ORCHESTRATOR.md` stays under ~150 lines: start-here checklist, the contract (domain invariants), non-negotiables, dispatch pipeline + workflow script, report format, hands-off paths. Reference slices and decisions by ID ("per D13"); never restate state.
- Each slice handoff reads on its own: first line `Slice: <id> — see plan.yaml`; then Contract, What exists, Scope, Invariants, Traps, Out of scope, Done when. No history, no dates, no names.
- House style: terse. Tables and bullets over paragraphs.

## Layer 3: human view

Generated from the yaml: status board, dependency DAG, shipping shape, PR/allocation table, decisions, open questions. Hand-written: mechanism diagrams, ELI5, rationale. A `render-plan` script (yaml → those HTML blocks) gets built with the first new plan and saved into this skill's `scripts/`. Until then, render by hand from the yaml.

**The local HTML file is the deliverable.** Regenerate it when: the plan is created, a wave starts or ends, a decision changes, or a PR changes state. Then `open <file>` so Rui sees it. Record its path in `meta.human_view`.

- Full standalone document: `<!doctype html>`, `<html lang>`, `<head>` with charset + viewport meta, `<title>`, and a reset (`body{margin:0}`, `[hidden]{display:none!important}`). All CSS and JS inline. Diagrams as inline SVG (no mermaid; it only renders on claude.ai). The one external request is Google Fonts, with real fallback stacks so it works offline.
- Light and dark via `prefers-color-scheme` tokens; keep the `[data-theme]` blocks so the same file also works if published.
- **Publishing is optional.** Only when Rui asks to share it: publish the same file as a private claude.ai artifact, put the URL in `meta.published`, and republish to the same URL afterwards.
- `/artifact-design` and `/artifact-diagramming` design rules apply either way.

### Sections, in order
1. Header: eyebrow (parent ticket, repo), plain-English lede, meta line (source files, `updated`, "PR states checked live <date>").
2. Sticky nav + global `ELI5: show all` toggle.
3. Status board: 3–4 stat cards.
4. Mechanism diagram(s): the domain flow the work changes.
5. Dependency DAG: columns = waves, prerequisite → dependent, transitive edges omitted, `critical` in accent, fill = state, legend.
6. Shipping shape: base, stacks, standalone PRs, mega-PR commits, live PR labels.
7. PR / allocation table: slice, what, ticket, effort, est. +LOC, needs, state pill.
8. Decisions: cards with basis, filter chips by `group`, reverted struck through.
9. Open questions: one card each, owner in the eyebrow, `data-q="<id>"` on the card (`render-plan.ts` does it). The hub injects answer boxes into those cards; hand-written pages without `data-q` are matched by the id in the card's `.eyebrow`.
10. Commit story (when `story` is non-empty): numbered list of commits, subject + role + state pill + SHA; spike findings above it.
11. Dispatch pipeline diagram with the no-git-writes boundary; effort map; report contents.
12. Guardrails.
13. Footer: sources and as-of.

Drop a section only when it has no content, and say so in the report.

### ELI5 notes
- `<details class="eli5">`, collapsed, right after the section it explains; global toggle, remembered in `localStorage` (try/catch).
- 4–7 per plan, critical parts only: money/state correctness, irreversible or customer-signed steps, cross-system settlement/matching, unusual process choices, publication exposure.
- Summary = the question a newcomer asks. Body = 2–3 short plain-analogy paragraphs, then a muted `Where this lives:` line. No facts absent from the main content.

### Visual rules
- One colour = one meaning. Domain accent never doubles as a warning. States: merged grey, pr-open blue, committed accent, running amber dashed, todo outline, frozen struck. Attention/blocked = amber. Legend wherever an encoding repeats.
- Inline SVG, `currentColor`, colours via tokens (both themes), labelled arrows, `role="img"` + `aria-label` + `<figcaption>`; SVG in an `overflow-x:auto` wrapper.
- No secrets on the page: it may get shared.

## Plan hub (cross-project)

Live at **http://127.0.0.1:4747** (launchd `local.plan-hub` → `scripts/serve-hub.ts`, log `~/.claude/plan-hub/serve.log`). Scans `~/work` and `~/projects` (incl. `.worktrees/`) for `.claude/handoffs/*.plan.yaml`: Kanban of every slice by `state`, plan cards, all unresolved `open` questions, live PR state from one `gh` GraphQL call per repo (every 5 min), with yaml-vs-GitHub drift flagged, never written back.
- Updates itself: fs watch on handoff dirs, a rescan every 2 min, and the `scripts/hub-hook.sh` PostToolUse hook on any `*.plan.yaml` write. Open pages refresh over SSE.
- Offline copy: `~/.claude/plan-hub/index.html`, also written by `bun scripts/build-hub.ts [--pr] [--open]`.
- Plans are read-only in the hub; the one thing it writes is the answers inbox (below). Layout in `scripts/hub-template.html`, data in `scripts/hub-lib.ts`.
- Restart: `launchctl kickstart -k gui/$(id -u)/local.plan-hub`.

## Questions for Rui and the answers inbox

Anything that needs Rui's call goes in `open` (owner `rui`), not only in chat: approvals, storyboard sign-off, product calls, "stop and ask" points from other skills. Rui answers them in the hub or on the plan page served by it.

- Answers land in `.claude/handoffs/<slug>.answers.yaml` next to the plan: append-only, latest per question wins, the hub is the only writer. Never edit or delete it.
- **Fold answers at session start, before every report and at each wave boundary:** `bun ~/.claude/skills/orchestrator-plan/scripts/pending-answers.ts <slug>.plan.yaml`. For each pending answer:
  - clear answer → record it (new or changed decision whose `basis` is `"Rui via hub <date>"`, or slice/scope change), set the question `status: resolved`, `resolved_by: <decision id or short outcome>`, unblock what it `blocks`;
  - `discuss: true`, or unclear, or it contradicts an active decision → keep it open and raise it with Rui in chat; don't guess;
  - then re-render the HTML; the hub picks up the change.
- Answers are Rui's instructions for that question only; they don't widen authorization beyond it (e.g. "yes" on a storyboard is not push approval).
- Report lists which answers were applied and which went back to Rui.

## Report after each update
File path (and URL if published), what changed since the last version, and anything in the yaml or instructions that looked stale or contradictory.
