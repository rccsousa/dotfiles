---
name: deep-dive
description: Understand a codebase you TRUST and produce an onboarding doc + architecture schematics — read-only, comprehension-not-critique posture, for repos built by devs you have high confidence in (not vibe-coded). Drives the full loop - read the existing docs, cluster the codebase by subsystem, fan out parallel mappers, synthesize into a layered onboarding guide with mermaid schematics (architecture, ERD, core-flow sequences), and verify the file:line anchors. Runs three modes, detected from whether an onboarding doc already exists - first-landing (whole-repo), focused (one subsystem you're about to touch), or refresh (re-sync a drifted doc) - so it serves ongoing work, not just day one. Use when onboarding onto a codebase, writing a "how it works" guide, building a mental model of an unfamiliar-but-well-built system, deep-diving a subsystem before you work in it, or updating a stale onboarding doc. Triggers - "/deep-dive", "/deep-dive <path>", "onboard me on this repo", "how does this codebase work", "how does the X subsystem work", "write an architecture / onboarding doc", "refresh the onboarding doc". Internal-codebase comprehension; for investigating an external question against primary sources use /research.
disable-model-invocation: true
---

# deep-dive

Put on the **new-senior-engineer** hat. You are joining a codebase built by devs you **trust** — pure engineers, not vibe-coders. The deliverable is a **mental model others can inherit**: an onboarding doc and schematics that explain how the system actually works. Not a critique, not a fix, not a findings list.

**Core principle:** the code is intentional until proven otherwise. Your job is to *explain* it, not to *judge* it. Read a surprising choice as a decision with a reason you haven't found yet — capture it as a note to understand, not a defect. Comprehension is the product; a wrong explanation costs more than an unexplained gap.

## Posture — set this first, hold it throughout

- **Read-only.** Inspect only — no edits to the studied code. The one artifact you *write* is the onboarding doc (default `docs/ONBOARDING.md`, or `--dest`).
- **Explain, don't critique.** When you spot a real sharp edge, record it in a **Gotchas / extension points** section as orientation for the next contributor — not as a severity-tagged finding. No 🔴/🟠/🟡 tiers here. This is the opposite of `deep-audit`.
- **High-trust, no adversarial gate.** Because the architects are trusted, there is **no VERIFY-to-refute and no red-team pass**. You still verify *facts* (does this function exist at this line, does this flow actually go through here) — but you are confirming your own understanding, not building a case against the author. See "Contrast" below.
- **Fidelity over flourish.** Every claim traces to a real `file:line`. A confident-but-wrong diagram is worse than a plain-but-right paragraph.

## Modes — scope the dive to the situation

Deep-dive is not only a day-one tool. **Detect the mode from one signal: does an onboarding doc already exist?** If `docs/ONBOARDING.md` (or `--dest`) is absent, you are first-landing. If it is present, you are on ongoing work — read it as your starting mental model and plan to *extend and verify* it, not regenerate it from a blank slate.

- **A — Whole-repo (first-landing).** No existing doc, no path argument. Run the full loop below and produce a new `ONBOARDING.md`. This is the default, and the rest of this skill describes it.
- **B — Focused dive (ongoing, the common case).** `/deep-dive <path-or-subsystem>`. You already hold the repo's mental model and are about to work in one area. Scope CLUSTER to that subsystem plus **one hop** of its direct collaborators (callers/callees, shared schemas); run 1–2 mappers, not 4–6. GROUND still reads the existing onboarding doc first — don't rebuild what you already know. Output is a single section; where it lands is decided at WRITE time.
- **C — Refresh (doc drifted).** `/deep-dive --refresh`, existing doc present. Diff-aware: find the doc's last-touched commit (`git log -1 --format=%cd <doc-path>`), then `git diff --stat <that-commit>..HEAD` to see which subsystems moved. Re-map only those, reconcile into the existing doc, and **preserve every part the diff didn't touch** — re-anchor what shifted, rewrite nothing that's still true.

All three hold the same posture (read-only, explain-don't-critique, no adversarial gate, verify anchors). Only the **scope** and the **write strategy** flex; the mode notes below are folded into the relevant loop steps.

## The loop

```
GROUND → CLUSTER → FAN-OUT mappers → SYNTHESIZE → SCHEMATIZE → WRITE doc → VERIFY anchors
```

### 1. GROUND — read what already exists first
- **Detect the mode before anything else.** Check whether the onboarding doc already exists at `docs/ONBOARDING.md` (or `--dest`). Absent → **Mode A** (first-landing). Present → **Mode B/C** (ongoing): read the doc as your prior mental model and plan to extend/verify it. A path/subsystem argument narrows to **Mode B**; `--refresh` selects **Mode C**. This choice sizes everything downstream (how many clusters, how many mappers, what you write).
- **Don't fan out blind.** Read the top-level orientation the repo already ships: `README`, `SPEC`/design docs, `AGENTS.md`/`CLAUDE.md`, `mix.exs`/`package.json`/`Cargo.toml`/`go.mod` (deps tell you the stack and the seams), the migration/schema dir, the router/entrypoint.
- **Distinguish doc types.** A framework style-guide (generic "how to write Phoenix/Rails/React") is NOT an onboarding doc — the *codebase-specific* "how THIS app works" is usually the real gap. Confirm the gap before writing, so you add value instead of duplicating.
- Get a file inventory (`git ls-files`) and a rough LOC-by-area sense so you can size the fan-out.

### 2. CLUSTER by subsystem
**Mode B** skips whole-repo clustering — scope to the named subsystem plus one hop of its direct collaborators, which is usually a single mapper's worth of work. **Mode C** clusters only the subsystems the diff touched. **Mode A** (below) splits the *whole* codebase along architectural seams, ~4–6 clusters. Typical Mode-A shape for a web app:
- **Domain / contexts** — the business logic + schemas + invariants (the heart; usually cluster #1).
- **Web / delivery** — routes, controllers, LiveViews/components/pages, auth, request lifecycle.
- **External-integration subsystem(s)** — one per meaningful boundary (email, payments, notifications, search…). Give each its own mapper if it's non-trivial.
- **Integrations / infra** — storage adapters, rate limiting, supervision tree, config/runtime, deployment.
- **Data model + tests + tooling** — full ERD from migrations, test strategy/fixtures, dev setup, mix/npm aliases.

Adapt the seams to the actual repo — a CLI, a library, or a data pipeline clusters differently.

### 3. FAN-OUT parallel mappers
- Dispatch one subagent per cluster (background, in a **single message** so they run concurrently). `general-purpose` on `opus` at medium effort is the right default — these are read-and-synthesize, not reasoning-heavy.
- Each mapper prompt MUST carry the posture: **"UNDERSTAND & EXPLAIN — read-only, do not edit. Produce an onboarding section, not a critique. Precise `file:line` anchors. No preamble, return ONLY the markdown section."**
- Give each mapper: its file list, and a fixed output contract:
  1. **Purpose & responsibilities** — what this subsystem owns; its public API surface grouped by concern.
  2. **Key modules / schemas** — with `file:line`, fields, associations, key functions.
  3. **Invariants & business rules** — guards, validations, constraints worth knowing.
  4. **Data flow** — how a request/event moves through it (the material for a sequence diagram).
  5. **Gotchas / extension points** — where you'd add a field/feature, and the traps.
- **Cap every mapper** (~450–500 words, bullets/tables only) to protect the orchestrator's context. One cluster = one tight section.
- For the data-model cluster, explicitly ask for the ERD in a form ready to become a mermaid `erDiagram` (entities + relationships listed explicitly) — this is the highest-value schematic.

### 4. SYNTHESIZE
Assemble the mapper sections into one coherent doc — don't just concatenate. Reconcile overlaps (the domain mapper and the web mapper will both mention the same flow — merge into one telling). Impose a reading order that takes a newcomer from *what is this* → *the one mental model that unlocks everything* → *flows* → *subsystem detail* → *how to run it* → *sharp edges*.

Recommended doc skeleton:
1. **What it is** (one paragraph — the product in plain language).
2. **Stack & key dependencies** (table).
3. **Repo map** (annotated tree).
4. **Architecture at a glance** (the flowchart + supervision/lifecycle note).
5. **Domain model** (the ERD + the *one core mental model* — the concept that, once understood, makes the rest obvious; find it and lead with it).
6. **Core flows** (2–4 sequence diagrams of the money-path operations).
7. **Subsystem deep-dives** (one section per cluster).
8. **Config, deploy & env vars that matter**.
9. **Local development & testing**.
10. **Migration timeline** (how the schema evolved — cheap history that explains "why is it like this").
11. **Gotchas & extension-point catalogue** (a table: "I want to… → touch… → watch out for…").
12. **Glossary** (the project's private vocabulary).

Not every repo needs all 12 — cut what doesn't apply, keep the order.

### 5. SCHEMATIZE — mermaid, and get the syntax right
Diagrams are the payload. Three earn their place: a **flowchart** (layers/components), an **erDiagram** (data model), and **sequenceDiagram**s (core flows). **These syntax rules bite every time — follow them or the diagram silently fails to render on GitHub:**
- **`erDiagram`: one attribute per line** inside each entity block. Multiple attributes on one line breaks the whole diagram. Format: `type name KEY "comment"` (e.g. `id job_id FK "nullable"`, `string slug UK`).
- **`flowchart`: use `<br/>` for line breaks in node labels, never `\n`** — `\n` renders as literal text.
- Quote labels containing `/`, `:`, `(`, parentheses, or punctuation: `JobPage["/j/:slug<br/>Controller"]`.
- Keep node IDs alphanumeric; put the pretty text in the label.
- Use `-.label.->` for side-effect/async edges (notifications, fire-and-forget) and solid `-->` for the request path, so the reader sees what's on the critical path.
- **Mentally parse each diagram before shipping.** If unsure, simplify — a plain bullet list beats a broken diagram.

### 6. WRITE the doc
- Default destination: **`docs/ONBOARDING.md`** in the studied repo (it's genuinely useful committed, renders mermaid on GitHub, and pairs with the repo's existing `README`/`SPEC`). Override with `--dest <path>` or `--dest scratchpad` (ephemeral — warn it won't survive).
- Cross-link, don't duplicate: point at `SPEC.md` for the *what/why*, `AGENTS.md`/`CLAUDE.md` for style rules; this doc is the *how it works*.
- Open with a one-line "what this pairs with" note so readers know where it sits.
- **Mode B — decide the output at write time.** If the subsystem already has a section in the existing doc, update *that section* in place (it's a living doc — keep the rest untouched). If there is no such section, the dive is likely just-in-time context for the work you're about to do: ask whether to fold a new section into `ONBOARDING.md` or keep it ephemeral in scratchpad. Write into the committed doc only on opt-in (or an explicit `--dest`).
- **Mode C — reconcile, don't regenerate.** Edit the existing doc in place: replace the sections whose subsystems moved, re-anchor drifted `file:line` references, and leave everything the diff didn't touch exactly as it was.

### 7. VERIFY anchors (fact-check, not refute)
Before declaring done, spot-check that the doc is *true*: sample a handful of `file:line` claims and the mermaid syntax. Cheap check: `git ls-files | grep <name>` for every path mentioned; open a couple of the cited lines to confirm the function/field is really there. If modules moved during the dive, re-anchor. This is confirming comprehension — not the adversarial VERIFY gate of `deep-audit`.

## Definition of done
- **Mode was detected up front** (existing doc? path arg? `--refresh`?) and the scope matched it — a focused dive didn't balloon into a whole-repo rebuild, and a refresh didn't rewrite sections the diff never touched.
- Existing repo docs were read first; the doc fills the *codebase-specific* gap rather than duplicating a framework style-guide.
- The doc leads with the **one core mental model** that unlocks the system, not just a feature list.
- Every subsystem has a section; every core flow that matters has a sequence diagram.
- All three schematic types present where applicable, and **every mermaid block is syntactically valid** (erDiagram one-attr-per-line, flowchart `<br/>` not `\n`).
- Sampled `file:line` anchors and paths verified against the tree.
- Nothing in the studied repo was modified except the onboarding doc itself.

## Contrast — deep-dive vs its neighbours
- **`deep-audit`** assumes you DON'T trust the code and the deliverable is *credible findings*: it adds a VERIFY-to-refute gate and an adversarial red-team pass, and reports severity-tiered defects. `deep-dive` assumes you DO trust the code and the deliverable is *understanding*: no refute gate, no red-team, no severity tiers — sharp edges become orientation notes, not findings.
- **`/init`** generates a `CLAUDE.md` of terse agent-facing rules. `deep-dive` produces a human-facing narrative + schematics onboarding doc. Complementary, different audience.
- **`code-review` / `land`** assume you own the code and will fix/merge it. `deep-dive` neither fixes nor judges — it explains.

## Pairs with
- `general-purpose` / `Explore` subagents — the per-cluster mappers (step 3).
- `context7-mcp` (confirm a library/framework contract when a subsystem leans on one).
- The repo's own `README` / `SPEC` / `AGENTS.md` — read in GROUND, cross-linked in WRITE.
- Contrast with `deep-audit` (distrust + findings) and `/init` (agent rules file).
