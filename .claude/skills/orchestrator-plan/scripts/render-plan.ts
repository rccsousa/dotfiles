#!/usr/bin/env bun
// Regenerates the yaml-derived blocks of an orchestrator-plan HTML page in place.
// Usage: bun render-plan.ts <plan.yaml> <page.html>
// Blocks live between <!-- gen:NAME --> and <!-- /gen:NAME -->; everything outside them is hand-written and untouched.

type Slice = {
  id: string;
  title: string;
  ticket?: string;
  track?: string;
  wave: number;
  needs: string[];
  effort?: string;
  loc?: [number, number] | null;
  loc_actual?: number | null;
  loc_note?: string;
  ship?: "pr" | "mega";
  state: string;
  note?: string;
  pr?: number | null;
  stack?: number | null;
  base_pr?: number | null;
  head?: string | null;
  branch?: string;
  worktree?: string;
  handoff?: string;
  critical?: boolean;
  test_db?: string;
  pr_live?: {
    state?: string;
    draft?: boolean;
    merge?: string;
    review?: string | null;
    checks?: string;
  };
};
type Decision = {
  id: string;
  group: string;
  status: string;
  rule: string;
  basis?: string;
  superseded_by?: string;
};
type Open = {
  id: string;
  owner: string;
  status?: string;
  blocks?: string[];
  title?: string;
  ask: string;
  note?: string;
  resolved_by?: string;
};
type ProviderGap = {
  id: string;
  provider: string;
  status: string;
  blocks?: string[];
  need: string;
  have: string;
  options?: string;
  decision?: string | null;
};
type External = { ref: string; state: string; what?: string };
type Story = {
  n: number;
  slice: string;
  ticket?: string;
  state: string;
  sha?: string | null;
  subject: string;
  role?: string;
  verified?: string | null;
};
type Plan = {
  meta: Record<string, any>;
  slices: Slice[];
  decisions?: Decision[];
  open?: Open[];
  external?: External[];
  provider_gaps?: ProviderGap[];
  jit?: { jit: string; what: string; where: string }[];
  spike?: any;
  story?: Story[];
};

const [yamlPath, htmlPath] = process.argv.slice(2);
if (!yamlPath || !htmlPath) {
  console.error("usage: bun render-plan.ts <plan.yaml> <page.html>");
  process.exit(2);
}

const plan = Bun.YAML.parse(await Bun.file(yamlPath).text()) as Plan;

const GROUP_LABEL: Record<string, string> = {
  money: "Money",
  arch: "Flow & architecture",
  scope: "Scope & publication",
  proc: "Process",
};
const STATE_LABEL: Record<string, string> = {
  merged: "merged",
  "pr-open": "open PR",
  committed: "committed",
  running: "in progress",
  review: "in review",
  todo: "not started",
  frozen: "frozen",
};
const NODE_CLASS: Record<string, string> = {
  merged: "n-merged",
  "pr-open": "n-open",
  committed: "n-done",
  running: "n-run",
  review: "n-run",
  todo: "n-todo",
  frozen: "n-frozen",
};
const PILL_CLASS: Record<string, string> = {
  merged: "p-merged",
  "pr-open": "p-open",
  committed: "p-done",
  running: "p-run",
  review: "p-run",
  todo: "p-todo",
  frozen: "p-frozen",
};
const EFFORT_ORDER = ["max", "xhigh", "high", "medium", "low"];
validate(plan);

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
// snake_case identifiers and file-ish tokens read as code
const rich = (v: unknown) =>
  esc(v).replace(
    /(^|[\s(])([a-z][a-z0-9]*(?:_[a-z0-9]+)+|[\w.-]+\/[\w./-]+|[\w-]+\.(?:md|ts|json|mdx))(?=[\s),;.:]|$)/g,
    "$1<code>$2</code>",
  );
const pill = (state: string, text?: string) =>
  `<span class="pill ${PILL_CLASS[state] ?? "p-todo"}">${esc(text ?? STATE_LABEL[state] ?? state)}</span>`;
const kLoc = (n: number) => `${+(n / 1000).toFixed(2)}`;
const stamp = (v: unknown) => String(v ?? "").replace("T", " ");

const slices = plan.slices;
const byId = new Map(slices.map((s) => [s.id, s]));
const extByRef = new Map((plan.external ?? []).map((e) => [e.ref, e]));
const story = plan.story ?? [];
const openQs = (plan.open ?? []).filter((q) => (q.status ?? "open") === "open");

const blocks: Record<string, () => string> = {
  meta: renderMeta,
  status: renderStatus,
  dag: renderDag,
  ship: renderShip,
  prs: renderPrs,
  decisions: renderDecisions,
  open: renderOpen,
  story: renderStory,
  effort: renderEffort,
  footer: renderFooter,
};

let html = await Bun.file(htmlPath).text();
const done: string[] = [];
const missing: string[] = [];
for (const [name, fn] of Object.entries(blocks)) {
  const re = new RegExp(
    `(<!-- gen:${name} -->)[\\s\\S]*?(<!-- /gen:${name} -->)`,
  );
  if (!re.test(html)) {
    missing.push(name);
    continue;
  }
  const body = fn();
  html = html.replace(re, (_m, open, close) => `${open}\n${body}\n${close}`);
  done.push(name);
}
await Bun.write(htmlPath, html);
console.log(
  `rendered ${done.length} blocks into ${htmlPath}: ${done.join(", ")}`,
);
if (missing.length) console.warn(`no markers for: ${missing.join(", ")}`);

// ---------- blocks ----------

function renderMeta() {
  const m = plan.meta;
  return [
    `<span>state: ${esc(yamlPath.split("/").slice(-1)[0])}</span>`,
    `<span>updated ${esc(stamp(m.updated))}</span>`,
    m.pr_checked
      ? `<span>PR states checked live ${esc(stamp(m.pr_checked))}</span>`
      : "",
    `<span>mode: ${esc(m.mode ?? "not set, ask Rui")}</span>`,
    m.published
      ? `<span>published: <a href="${esc(m.published)}">${esc(m.published)}</a></span>`
      : "",
  ]
    .filter(Boolean)
    .join("\n    ");
}

function renderStatus() {
  const cards: string[] = [];
  const prs = slices.filter((s) => s.pr && s.state === "pr-open");
  if (prs.length) {
    const stacks = groupStacks();
    const parts: string[] = [];
    for (const s of prs.filter((s) => !s.stack))
      parts.push(`#${s.pr} ${esc(s.id)}`);
    for (const [id, chain] of stacks)
      parts.push(
        `stack #${id}: ${chain.map((s) => `#${s.pr} ${esc(s.id)}`).join(" → ")}`,
      );
    const merges = uniq(prs.map((s) => s.pr_live?.merge ?? "unknown"));
    const checks = uniq(prs.map((s) => s.pr_live?.checks ?? "unknown"));
    const reviews = uniq(prs.map((s) => s.pr_live?.review ?? "none"));
    const warn = merges.some((m) => m !== "CLEAN") ? "p-run" : "p-done";
    cards.push(
      stat(
        "Open PRs · awaiting review",
        String(prs.length),
        `${parts.join(" · ")}.<br>Merge state ${merges.map((m) => `<span class="pill ${warn}">${esc(m)}</span>`).join(" ")} · CI ${esc(checks.join("/"))} · reviews: ${esc(reviews.join("/"))}.`,
      ),
    );
  }
  const mega = plan.meta.mega;
  if (mega && story.length) {
    const committed = story.filter((c) => c.state === "committed");
    const running = story.filter(
      (c) => c.state === "running" || c.state === "review",
    );
    const next = story.filter((c) => c.state === "todo").map((c) => c.slice);
    const bits: string[] = [];
    if (committed.length)
      bits.push(
        `${committed.map((c) => `${esc(c.slice)} (<code>${esc(c.sha)}</code>)`).join(", ")} committed.`,
      );
    for (const c of running) {
      const note = byId.get(c.slice)?.note;
      bits.push(`${esc(c.slice)} in progress${note ? `: ${esc(note)}` : ""}.`);
    }
    if (next.length) bits.push(`Next: ${next.map(esc).join(", ")}.`);
    cards.push(
      stat(
        `Mega PR · ${mega.pr ? `#${mega.pr}` : mega.pushed ? "pushed" : "local only"}`,
        `${committed.length} / ${story.length}`,
        bits.join(" "),
      ),
    );
  }
  if (openQs.length) {
    const owners = uniq(openQs.map((q) => q.owner));
    cards.push(
      stat(
        "Waiting on",
        owners.map(cap).join(" + "),
        owners
          .map(
            (o) =>
              `${cap(o)}: ${openQs
                .filter((q) => q.owner === o)
                .map((q) => esc(q.id))
                .join(", ")}`,
          )
          .join(". ") + ".",
      ),
    );
  }
  const frozen = (plan.external ?? []).filter((e) => e.state === "frozen");
  cards.push(
    stat(
      "Mode",
      esc(plan.meta.mode ?? "unset"),
      `${esc(plan.meta.mode_note ?? "")}${frozen.length ? ` Frozen outside the plan: ${frozen.map((e) => esc(e.ref)).join(", ")}.` : ""}`,
    ),
  );
  return `<div class="board">\n${cards.join("\n")}\n  </div>`;
}

function stat(eyebrow: string, big: string, body: string) {
  return `    <div class="stat"><span class="eyebrow">${eyebrow}</span><span class="big">${big}</span><p>${body}</p></div>`;
}

function renderDag() {
  const W = 1000,
    NW = 84,
    NH = 34,
    ROW = 58,
    TOP = 40,
    GAP = 34;
  const ext = uniq(slices.flatMap((s) => s.needs.filter((n) => !byId.has(n))));
  const waves = slices.map((s) => s.wave);
  const w0 = ext.length ? Math.min(0, ...waves) : Math.min(...waves);
  const w1 = Math.max(...waves);
  const colW = (W - 2 * 18 - NW) / Math.max(1, w1 - w0);
  const colX = (w: number) => 18 + (w - w0) * colW;

  const direct = new Map(slices.map((s) => [s.id, reduceNeeds(s)]));
  const trackOf = (id: string): string =>
    byId.get(id)?.track ??
    byId.get(slices.find((s) => direct.get(s.id)!.includes(id))?.id ?? "")
      ?.track ??
    "A";
  const tracks = uniq(slices.map((s) => s.track ?? "A")).sort(
    (a, b) =>
      slices.filter((s) => (s.track ?? "A") === a).length -
        slices.filter((s) => (s.track ?? "A") === b).length ||
      a.localeCompare(b),
  );

  const row = new Map<string, number>();
  const occupied = new Set<string>();
  const place = (
    id: string,
    track: string,
    wave: number,
    desired: number | null,
  ) => {
    let r = 0;
    if (desired === null) {
      while (occupied.has(`${track}:${r}:${wave}`)) r++;
    } else {
      const base = Math.round(desired);
      for (let d = 0; ; d++) {
        if (base - d >= 0 && !occupied.has(`${track}:${base - d}:${wave}`)) {
          r = base - d;
          break;
        }
        if (!occupied.has(`${track}:${base + d}:${wave}`)) {
          r = base + d;
          break;
        }
      }
    }
    row.set(id, r);
    occupied.add(`${track}:${r}:${wave}`);
  };
  const desiredOf = (ids: string[], track: string) => {
    const rs = ids
      .filter((n) => row.has(n) && trackOf(n) === track)
      .map((n) => row.get(n)!);
    return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  };
  for (const track of tracks) {
    for (let w = w0; w <= w1; w++) {
      const col = slices
        .filter((s) => (s.track ?? "A") === track && s.wave === w)
        .map((s) => ({ s, d: desiredOf(direct.get(s.id)!, track) }))
        .sort(
          (a, b) =>
            Number(!!b.s.critical) - Number(!!a.s.critical) ||
            Number(a.d === null) - Number(b.d === null) ||
            a.s.id.localeCompare(b.s.id),
        );
      for (const { s, d } of col) place(s.id, track, w, d);
    }
    for (const e of ext.filter((e) => trackOf(e) === track)) {
      const deps = slices
        .filter((s) => direct.get(s.id)!.includes(e))
        .map((s) => s.id);
      place(e, track, w0, desiredOf(deps, track));
    }
  }

  const trackTop = new Map<string, number>();
  let y = TOP;
  for (const t of tracks) {
    trackTop.set(t, y);
    const rows =
      Math.max(
        0,
        ...[...row].filter(([id]) => trackOf(id) === t).map(([, r]) => r),
      ) + 1;
    y += rows * ROW + GAP;
  }
  const H = y - GAP + 26;
  const pos = (id: string) => {
    const s = byId.get(id);
    const w = s ? s.wave : w0;
    return {
      x: colX(w),
      y: trackTop.get(trackOf(id))! + row.get(id)! * ROW,
      w,
      t: trackOf(id),
      r: row.get(id)!,
    };
  };
  const cellFree = (t: string, r: number, from: number, to: number) => {
    for (let w = from; w <= to; w++)
      if (occupied.has(`${t}:${r}:${w}`)) return false;
    return true;
  };

  const out: string[] = [];
  out.push(`<figure>\n    <div class="scroll">`);
  out.push(
    `    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(dagAria(direct))}">`,
  );
  out.push(
    `      <defs><marker id="da" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="mk"/></marker><marker id="da-acc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="mk-acc"/></marker></defs>`,
  );
  const heads: string[] = [];
  for (let w = w0; w <= w1; w++)
    heads.push(
      `<text x="${r1(colX(w) + NW / 2)}" y="14">W${w}${w === w0 && ext.length && !slices.some((s) => s.wave === w) ? " · ext" : ""}</text>`,
    );
  out.push(`      <g class="t-lab" text-anchor="middle">${heads.join("")}</g>`);
  for (const t of tracks) {
    const ty = trackTop.get(t)!;
    if (t !== tracks[0])
      out.push(
        `      <line x1="0" y1="${ty - GAP / 2 - 4}" x2="${W}" y2="${ty - GAP / 2 - 4}" stroke="currentColor" stroke-opacity=".12"/>`,
      );
    out.push(
      `      <text x="${W - 4}" y="${ty - 6}" text-anchor="end" class="t-lab">TRACK ${esc(t)} · ${esc(plan.meta.tracks?.[t] ?? "")}</text>`,
    );
  }
  // edges
  for (const s of slices) {
    for (const n of direct.get(s.id)!) {
      const a = pos(n),
        b = pos(s.id);
      const x1 = r1(a.x + NW),
        y1 = r1(a.y + NH / 2),
        x2 = r1(b.x - 2),
        y2 = r1(b.y + NH / 2);
      const crit = !!(byId.get(n)?.critical && s.critical);
      const cls = crit ? "e-crit" : byId.has(n) ? "e" : "e e-dash";
      const mk = crit ? "da-acc" : "da";
      let d: string;
      if (y1 === y2) d = `M${x1} ${y1}H${x2}`;
      else if (b.w - a.w <= 1)
        d = `M${x1} ${y1}C${r1(x1 + 22)} ${y1} ${r1(x2 - 22)} ${y2} ${x2} ${y2}`;
      else if (
        cellFree(b.t, b.r, a.w + 1, b.w - 1) ||
        !cellFree(a.t, a.r, a.w + 1, b.w - 1)
      ) {
        const xb = r1(x1 + (colW - NW) - 2);
        d = `M${x1} ${y1}C${r1(x1 + 22)} ${y1} ${r1(xb - 22)} ${y2} ${xb} ${y2}H${x2}`;
      } else {
        const xa = r1(x2 - (colW - NW) + 2);
        d = `M${x1} ${y1}H${xa}C${r1(xa + 22)} ${y1} ${r1(x2 - 22)} ${y2} ${x2} ${y2}`;
      }
      out.push(
        `      <path d="${d}" class="${cls}" marker-end="url(#${mk})"/>`,
      );
    }
  }
  // nodes
  for (const id of [...row.keys()]) {
    const p = pos(id);
    const s = byId.get(id);
    const state = s ? s.state : (extByRef.get(id)?.state ?? "merged");
    const sub = s
      ? s.pr
        ? `#${s.pr}`
        : s.state === "todo"
          ? (s.ticket ?? "").replace(/^[A-Z][A-Z0-9]*-/, "")
          : (STATE_LABEL[s.state] ?? s.state)
      : state;
    const x = r1(p.x),
      yy = r1(p.y),
      cx = r1(p.x + NW / 2);
    out.push(
      `      <rect x="${x}" y="${yy}" width="${NW}" height="${NH}" rx="7" class="${NODE_CLASS[state] ?? "n-todo"}"/><text x="${cx}" y="${yy + 15}" text-anchor="middle" class="t-id${state === "frozen" ? " t-struck" : ""}">${esc(id)}</text><text x="${cx}" y="${yy + 28}" text-anchor="middle" class="t-sub">${esc(sub)}</text>`,
    );
    const gates = openQs.filter((q) =>
      (q.blocks ?? []).some((b) => b.split(":")[0] === id),
    );
    if (gates.length) {
      const what = gates
        .map(
          (q) =>
            `${(q.blocks ?? []).find((b) => b.split(":")[0] === id)!.split(":")[1] ?? "start"} ⟵ ${q.id}`,
        )
        .join(", ");
      out.push(
        `      <text x="${cx}" y="${yy + NH + 12}" text-anchor="middle" class="t-sub t-warn">${esc(what)}</text>`,
      );
    }
  }
  out.push(`    </svg>\n    </div>`);
  const present = uniq(
    [...row.keys()].map(
      (id) => byId.get(id)?.state ?? extByRef.get(id)?.state ?? "merged",
    ),
  );
  out.push(legend(present, true));
  out.push(
    `    <figcaption>Columns are waves; arrows point from a prerequisite to what needs it, transitive edges left out. Accent edges join two critical-path slices. Amber labels are merges or starts gated by an open question. Dashed edges come from PRs outside the plan.</figcaption>\n  </figure>`,
  );
  return out.join("\n");
}

function dagAria(direct: Map<string, string[]>) {
  const crit = slices
    .filter((s) => s.critical)
    .sort((a, b) => a.wave - b.wave)
    .map((s) => s.id);
  return `Dependency graph by wave for ${slices.length} slices. Critical path: ${crit.join(", ")}. ${slices.map((s) => `${s.id} needs ${direct.get(s.id)!.join(" and ") || "nothing"}`).join("; ")}.`;
}

function legend(states: string[], critical: boolean) {
  const sw: Record<string, string> = {
    merged: "background:var(--done-soft);border-color:var(--done)",
    "pr-open": "background:var(--info-soft);border-color:var(--info)",
    committed: "background:var(--accent-soft);border-color:var(--accent)",
    running:
      "background:var(--warn-soft);border-color:var(--warn);border-style:dashed",
    review:
      "background:var(--warn-soft);border-color:var(--warn);border-style:dashed",
    todo: "background:var(--surface);border-color:var(--rule)",
    frozen:
      "background:var(--surface);border-color:var(--rule);border-style:dotted",
  };
  const items = Object.keys(sw)
    .filter((k) => states.includes(k))
    .map(
      (k) =>
        `<span><i class="sw" style="${sw[k]}"></i>${esc(STATE_LABEL[k])}</span>`,
    );
  if (critical)
    items.push(
      `<span><i class="sw" style="background:var(--accent);border-color:var(--accent);height:3px"></i>critical path</span>`,
    );
  return `    <div class="legend">${items.join("")}</div>`;
}

function groupStacks() {
  const stacks = new Map<number, Slice[]>();
  for (const s of slices.filter((s) => s.pr && s.stack)) {
    const list = stacks.get(s.stack!) ?? [];
    list.push(s);
    stacks.set(s.stack!, list);
  }
  for (const [id, list] of stacks) {
    const chain: Slice[] = [];
    let cur = list.find(
      (s) => !s.base_pr || !list.some((o) => o.pr === s.base_pr),
    );
    while (cur) {
      chain.push(cur);
      cur = list.find((s) => s.base_pr === chain[chain.length - 1].pr);
    }
    stacks.set(id, chain);
  }
  return stacks;
}

function renderShip() {
  const W = 1000,
    BW = 110,
    BH = 40,
    MAIN = 186;
  const out: string[] = [];
  const stacks = groupStacks();
  const standalone = slices.filter((s) => s.pr && !s.stack);
  const mega = plan.meta.mega;
  const box = new Map<number, { x: number; y: number }>();
  const sub = (s: Slice) => `${s.pr_live?.merge ?? s.state}`;
  const subCls = (s: Slice) =>
    s.pr_live?.merge && s.pr_live.merge !== "CLEAN" ? "t-sub t-warn" : "t-sub";
  const body: string[] = [];
  body.push(
    `<line x1="10" y1="${MAIN}" x2="${W - 10}" y2="${MAIN}" stroke="currentColor" stroke-width="3" stroke-opacity=".5"/><text x="10" y="${MAIN - 8}" class="t-lab">${esc(plan.meta.base ?? "origin/main")}</text>`,
  );
  let x = 30;
  for (const [id, chain] of stacks) {
    body.push(
      `<text x="${x}" y="76" class="t-lab">stack #${id} · base →</text>`,
    );
    chain.forEach((s, i) => {
      const bx = x + i * (BW + 26),
        by = 92;
      box.set(s.pr!, { x: bx, y: by });
      body.push(
        `<rect x="${bx}" y="${by}" width="${BW}" height="${BH}" rx="7" class="${NODE_CLASS[s.state]}"/><text x="${bx + BW / 2}" y="${by + 17}" text-anchor="middle" class="t-id">#${s.pr} · ${esc(s.id)}</text><text x="${bx + BW / 2}" y="${by + 32}" text-anchor="middle" class="${subCls(s)}">${esc(sub(s))}</text>`,
      );
      if (i === 0)
        body.push(
          `<line x1="${bx + BW / 2}" y1="${by + BH}" x2="${bx + BW / 2}" y2="${MAIN - 4}" class="e" marker-end="url(#sa)"/>`,
        );
      else
        body.push(
          `<line x1="${bx}" y1="${by + BH / 2}" x2="${bx - 24}" y2="${by + BH / 2}" class="e" marker-end="url(#sa)"/>`,
        );
    });
    x += chain.length * (BW + 26) + 10;
  }
  if (mega && story.length) {
    const mx = Math.max(x, 440),
      mw = W - 10 - mx,
      my = 40,
      mh = 118;
    body.push(
      `<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" rx="10" class="n-zone"/>`,
    );
    body.push(
      `<text x="${mx + 14}" y="${my + 22}" class="t-id">Mega PR${mega.pr ? ` #${mega.pr}` : ""}</text><text x="${mx + 90}" y="${my + 22}" class="t-sub">${esc(mega.branch)} · ${mega.pushed ? "pushed" : "local only"}</text>`,
    );
    const base = box.get(mega.base_pr);
    if (base)
      body.push(
        `<line x1="${mx}" y1="${base.y + BH / 2}" x2="${base.x + BW + 2}" y2="${base.y + BH / 2}" class="e" marker-end="url(#sa)"/><text x="${mx - 4}" y="${base.y + BH / 2 - 6}" text-anchor="end" class="t-sub">on ${esc(mega.base_sha ?? "")}</text>`,
      );
    const gap = 8,
      cw = Math.min(58, (mw - 28 - gap * (story.length - 1)) / story.length);
    story.forEach((c, i) => {
      const cx = mx + 14 + i * (cw + gap),
        cy = my + 40;
      body.push(
        `<rect x="${r1(cx)}" y="${cy}" width="${r1(cw)}" height="46" rx="6" class="${NODE_CLASS[c.state] ?? "n-todo"}"/><text x="${r1(cx + cw / 2)}" y="${cy + 20}" text-anchor="middle" class="t-id">${esc(c.slice)}</text><text x="${r1(cx + cw / 2)}" y="${cy + 35}" text-anchor="middle" class="t-sub">${esc(c.sha ? c.sha.slice(0, 4) : c.state === "todo" ? "" : c.state)}</text>`,
      );
    });
    body.push(
      `<text x="${mx + 14}" y="${my + mh - 12}" class="t-sub">${story.length} story commits, one ticket each · fixup! + autosquash · squash-merged to main</text>`,
    );
  }
  if (standalone.length) {
    body.push(
      `<text x="10" y="${MAIN + 38}" class="t-lab">standalone →</text>`,
    );
    standalone.forEach((s, i) => {
      const bx = 150 + i * (BW + 30),
        by = MAIN + 18;
      body.push(
        `<rect x="${bx}" y="${by}" width="${BW}" height="${BH}" rx="7" class="${NODE_CLASS[s.state]}"/><text x="${bx + BW / 2}" y="${by + 17}" text-anchor="middle" class="t-id">#${s.pr} · ${esc(s.id)}</text><text x="${bx + BW / 2}" y="${by + 32}" text-anchor="middle" class="${subCls(s)}">${esc(sub(s))}</text><line x1="${bx + BW / 2}" y1="${by}" x2="${bx + BW / 2}" y2="${MAIN + 4}" class="e" marker-end="url(#sa)"/>`,
      );
    });
  }
  const H = MAIN + (standalone.length ? 70 : 20);
  const aria = `Base ${plan.meta.base ?? "origin/main"}. ${[...stacks].map(([id, c]) => `Stack #${id}: ${c.map((s) => `#${s.pr} (${s.id})`).join(" then ")}.`).join(" ")} Standalone: ${standalone.map((s) => `#${s.pr} (${s.id})`).join(", ") || "none"}. ${mega && story.length ? `Mega PR on #${mega.base_pr} with ${story.length} story commits: ${story.map((c) => `${c.slice} ${c.state}`).join(", ")}.` : ""}`;
  out.push(
    `<figure>\n    <div class="scroll">\n    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">`,
  );
  out.push(
    `      <defs><marker id="sa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="mk"/></marker></defs>`,
  );
  out.push(body.map((b) => `      ${b}`).join("\n"));
  out.push(`    </svg>\n    </div>`);
  out.push(
    legend(
      uniq([
        ...slices.filter((s) => s.pr).map((s) => s.state),
        ...story.map((c) => c.state),
      ]),
      false,
    ),
  );
  out.push(
    `    <figcaption>Live labels are GitHub merge states (amber when not CLEAN). Mega-PR boxes show the story commit's short SHA once committed. ${esc(plan.meta.mode_note ?? "")}</figcaption>\n  </figure>`,
  );
  return out.join("\n");
}

function renderPrs() {
  const rows = slices.map((s) => {
    const needs = s.needs.length
      ? s.needs
          .map((n) =>
            extByRef.get(n)?.state === "merged" ? `${esc(n)} ✓` : esc(n),
          )
          .join(", ")
      : "—";
    const est = s.loc ? `${kLoc(s.loc[0])}–${kLoc(s.loc[1])}k` : "—";
    const act = s.loc_actual
      ? `+${s.loc_actual.toLocaleString("en-US")}${s.loc_note ? `<br><span class="muted">${esc(s.loc_note)}</span>` : ""}`
      : "—";
    const st = s.pr ? pill(s.state, `#${s.pr}`) : pill(s.state);
    return `      <tr><td class="id">${esc(s.id)}${s.critical ? ' <span class="crit" title="critical path">●</span>' : ""}</td><td>${rich(s.title)}</td><td class="num">${esc((s.ticket ?? "").replace(/^[A-Z][A-Z0-9]*-/, ""))}</td><td class="num">${esc(s.effort ?? "—")}</td><td class="num">${est}</td><td class="num">${act}</td><td>${needs}</td><td class="num">${s.ship === "mega" ? "mega" : "PR"}</td><td>${st}</td></tr>`;
  });
  const lo = slices.reduce((a, s) => a + (s.loc?.[0] ?? 0), 0),
    hi = slices.reduce((a, s) => a + (s.loc?.[1] ?? 0), 0);
  const out = [
    `<div class="tbl"><table>`,
    `    <thead><tr><th>Slice</th><th>What it does</th><th>Ticket</th><th>Effort</th><th>Est. +LOC</th><th>Actual +LOC</th><th>Needs</th><th>Ships</th><th>State</th></tr></thead>`,
    `    <tbody>`,
    ...rows,
    `    </tbody>`,
    `    <tfoot><tr><td></td><td>${slices.length} slices · estimated +${kLoc(lo)}k to +${kLoc(hi)}k lines</td><td colspan="7"><span class="crit">●</span> critical path</td></tr></tfoot>`,
    `  </table></div>`,
  ];
  if (plan.jit?.length) {
    out.push(
      `  <details class="plain"><summary>JIT plan coverage: where each PRD item lives now</summary><div class="tbl"><table>`,
    );
    out.push(
      `    <thead><tr><th>JIT</th><th>What</th><th>Where it lives</th></tr></thead><tbody>`,
    );
    for (const j of plan.jit)
      out.push(
        `      <tr><td class="num">${esc(j.jit)}</td><td>${rich(j.what)}</td><td>${rich(j.where)}</td></tr>`,
      );
    out.push(`    </tbody></table></div></details>`);
  }
  return out.join("\n");
}

function renderDecisions() {
  const ds = plan.decisions ?? [];
  const groups = uniq(ds.map((d) => d.group));
  const chips = [
    `<button type="button" data-f="all" aria-pressed="true">All ${ds.length}</button>`,
    ...groups.map(
      (g) =>
        `<button type="button" data-f="${esc(g)}" aria-pressed="false">${esc(GROUP_LABEL[g] ?? g)} · ${ds.filter((d) => d.group === g).length}</button>`,
    ),
  ];
  const arts = ds.map((d) => {
    const rev = d.status !== "active";
    const basis = `${d.basis ?? ""}${rev ? ` · ${d.status}${d.superseded_by ? `, superseded by ${d.superseded_by}` : ""}` : ""}`;
    return `    <article data-g="${esc(d.group)}"${rev ? ' class="rev"' : ""}><span class="k">${esc(d.id)}</span><span class="w">${rich(d.rule)}.</span><span class="b">${esc(basis)}</span></article>`;
  });
  return `<div class="chips" role="group" aria-label="Filter decisions">\n    ${chips.join("\n    ")}\n  </div>\n  <div class="dec" id="dec">\n${arts.join("\n")}\n  </div>`;
}

function renderOpen() {
  const gaps = (plan.provider_gaps ?? []).map((g) => {
    const settled = g.status === "resolved" || g.status === "workaround-approved";
    const blocks = !settled && g.blocks?.length
      ? `<p class="muted">Blocks slice ${g.blocks.map(esc).join(", ")} from starting</p>`
      : "";
    const decision = g.decision ? `<p class="muted">Decision: ${rich(g.decision)}</p>` : "";
    return `    <div class="callout"><span class="eyebrow">Provider gap · ${esc(cap(g.provider))} · ${esc(g.id)} · ${esc(g.status)}</span><h3>${rich(g.need)}</h3><p>Provider offers: ${rich(g.have)}</p>${g.options ? `<p class="muted">Options: ${rich(g.options)}</p>` : ""}${decision}${blocks}</div>`;
  });
  const cards = gaps.concat(openQs.map((q) => {
    const blocks = q.blocks?.length
      ? `<p class="muted">Blocks: ${q.blocks.map((b) => esc(b.replace(":", " "))).join(", ")}</p>`
      : "";
    const note = q.note ? `<p class="muted">Current status: ${rich(q.note)}</p>` : "";
    return `    <div class="callout" data-q="${esc(q.id)}"><span class="eyebrow">${esc(cap(q.owner))} · ${esc(q.id)}</span><h3>${esc(q.title ?? q.id)}</h3><p>${rich(q.ask)}</p>${note}${blocks}</div>`;
  }));
  const resolved = (plan.open ?? []).filter((q) => q.status === "resolved");
  const tail = resolved.length
    ? `\n  <p class="muted">Resolved: ${resolved.map((q) => `${esc(q.id)} → ${esc(q.resolved_by ?? "")}`).join(" · ")}</p>`
    : "";
  // answer-kit.js (served by the plan hub) adds answer boxes to [data-q] and hides this note
  const note = openQs.length
    ? `\n  <p class="muted hub-answer-note">Answer these inline: open this page from the plan hub, <a href="http://127.0.0.1:4747">127.0.0.1:4747</a>.</p>`
    : "";
  return `<div class="two">\n${cards.join("\n")}\n  </div>${tail}${note}`;
}

function renderStory() {
  if (!story.length) return `<p class="muted">No story commits yet.</p>`;
  const out: string[] = [];
  if (plan.spike) {
    const f: string[] = Array.isArray(plan.spike.findings)
      ? plan.spike.findings
      : [];
    out.push(
      `<div class="callout ok"><span class="eyebrow">Spike findings</span><ul>${f.map((x) => `<li>${rich(x)}</li>`).join("")}</ul></div>`,
    );
  } else {
    out.push(
      `<div class="callout"><span class="eyebrow">Spike</span><p>No spike ran for this plan. ${esc(plan.meta.mode_note ?? "")}</p></div>`,
    );
  }
  out.push(`  <ol class="story">`);
  for (const c of story) {
    const s = byId.get(c.slice);
    const ticketSuffix =
      c.ticket && !c.subject.endsWith(`[${c.ticket}]`)
        ? ` [${c.ticket}]`
        : "";
    const verified = c.verified
      ? `<span class="v">Verified: ${rich(c.verified)}</span>`
      : s?.note && c.state !== "todo"
        ? `<span class="v">${esc(s.note)}</span>`
        : "";
    out.push(
      `    <li class="st-${esc(c.state)}"><span class="n">${c.n}</span><div><code class="subj">${esc(c.subject)}${esc(ticketSuffix)}</code><span class="role">${esc(c.slice)} · ${rich(c.role ?? "")}</span>${verified}</div><div class="side">${pill(c.state)}<code>${esc(c.sha ?? "")}</code></div></li>`,
    );
  }
  out.push(`  </ol>`);
  return out.join("\n");
}

function renderEffort() {
  const items = EFFORT_ORDER.map(
    (e) => [e, slices.filter((s) => s.effort === e).map((s) => s.id)] as const,
  ).filter(([, ids]) => ids.length);
  return `<div class="card"><h3>Effort map (implementer and fixer)</h3><ul>${items.map(([e, ids]) => `<li><code>${e}</code> ${ids.map(esc).join(" · ")}</li>`).join("")}<li>Reviewer: <code>xhigh</code>, or <code>max</code> on max slices</li></ul></div>`;
}

function renderFooter() {
  const m = plan.meta;
  return `Rendered from ${esc(yamlPath.split("/").slice(-1)[0])} (updated ${esc(stamp(m.updated))}) by render-plan.ts. Instructions: ${esc(m.instructions ?? "")}. Contract: ${esc(m.guide ?? "")}. PR states checked live ${esc(stamp(m.pr_checked ?? ""))}.`;
}

// ---------- helpers ----------

function reduceNeeds(s: Slice) {
  return s.needs.filter(
    (n) => !s.needs.some((m) => m !== n && ancestors(m).has(n)),
  );
}

function ancestors(id: string, seen = new Set<string>()): Set<string> {
  for (const n of byId.get(id)?.needs ?? []) {
    if (seen.has(n)) continue;
    seen.add(n);
    ancestors(n, seen);
  }
  return seen;
}

function uniq<T>(xs: T[]) {
  return [...new Set(xs)];
}
function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function r1(n: number) {
  return Math.round(n * 10) / 10;
}

function validate(p: Plan) {
  const errs: string[] = [];
  if (!p?.meta?.slug) errs.push("meta.slug missing");
  if (!Array.isArray(p?.slices) || !p.slices.length)
    errs.push("slices missing");
  const ids = new Set<string>();
  for (const s of p?.slices ?? []) {
    if (typeof s.id !== "string")
      errs.push(`slice id must be a quoted string: ${s.id}`);
    if (ids.has(s.id)) errs.push(`duplicate slice ${s.id}`);
    ids.add(s.id);
    for (const k of ["title", "wave", "needs", "state"] as const)
      if (s[k] === undefined) errs.push(`slice ${s.id}: ${k} missing`);
    if (!(s.state in NODE_CLASS))
      errs.push(`slice ${s.id}: unknown state ${s.state}`);
  }
  for (const s of p?.slices ?? [])
    for (const n of s.needs ?? [])
      if (!ids.has(n) && !n.startsWith("#"))
        errs.push(`slice ${s.id}: unknown need ${n}`);
  for (const g of p?.provider_gaps ?? [])
    for (const b of g.blocks ?? [])
      if (!ids.has(b)) errs.push(`provider gap ${g.id}: unknown slice ${b}`);
  for (const c of p?.story ?? [])
    if (!ids.has(c.slice)) errs.push(`story ${c.n}: unknown slice ${c.slice}`);
  if (errs.length) {
    console.error(errs.join("\n"));
    process.exit(1);
  }
}
