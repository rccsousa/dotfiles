// Inline answer boxes for open questions. Served by serve-hub.ts at /answer-kit.js; injected into plan pages and loaded by the hub.
// Targets: elements with data-q (and data-plan, else the script's data-plan). Plan pages without data-q: matched by the id in an .eyebrow/.k label;
// anything unmatched gets a fallback panel in #open. Answers POST to /answer and land in <slug>.answers.yaml.
(() => {
  const DEFAULT_PLAN = document.currentScript?.dataset.plan ?? null;
  let data = null;
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const time = (iso) =>
    new Date(iso).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });

  const css = `
.hub-ans{margin-top:10px;padding-top:10px;border-top:1px dashed var(--rule,#ccc);display:grid;gap:8px;font:13px/1.45 var(--body,system-ui,sans-serif)}
.hub-ans textarea{width:100%;min-height:64px;resize:vertical;font:13px/1.45 var(--body,system-ui,sans-serif);padding:8px 10px;border:1px solid var(--rule,#ccc);border-radius:6px;background:var(--bg,#fff);color:var(--ink,#111)}
.hub-ans textarea:focus-visible{outline:2px solid var(--accent,#0D6A4E);outline-offset:1px}
.hub-ans .row{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
.hub-ans label{font:12px var(--mono,ui-monospace,monospace);color:var(--muted,#666);display:inline-flex;gap:6px;align-items:center;cursor:pointer}
.hub-ans button{font:600 12px/1 var(--mono,ui-monospace,monospace);padding:8px 12px;border-radius:6px;border:1px solid var(--accent,#0D6A4E);background:var(--accent,#0D6A4E);color:var(--bg,#fff);cursor:pointer}
.hub-ans button.ghost{background:transparent;color:var(--accent,#0D6A4E)}
.hub-ans button:disabled{opacity:.6;cursor:progress}
.hub-ans .done{font:600 11px/1.3 var(--mono,ui-monospace,monospace);color:var(--accent,#0D6A4E);text-transform:uppercase;letter-spacing:.06em}
.hub-ans .done.discuss{color:var(--warn,#9A6200)}
.hub-ans blockquote{margin:0;padding:6px 10px;border-left:3px solid var(--accent,#0D6A4E);background:var(--accent-soft,#eef6f2);white-space:pre-wrap;border-radius:0 6px 6px 0}
.hub-ans .err{color:var(--warn,#9A6200);font:12px var(--mono,ui-monospace,monospace)}
.hub-ans .hint{font:11px var(--mono,ui-monospace,monospace);color:var(--muted,#666)}
.hub-ans-panel{margin-top:16px;display:grid;gap:12px}
.hub-ans-panel>article{border:1px solid var(--rule,#ccc);border-radius:10px;padding:12px 14px;background:var(--surface,#fff)}
.hub-answer-note{display:none!important}`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  async function load() {
    data = await (await fetch("/data.json", { cache: "no-store" })).json();
  }
  const question = (plan, id) =>
    data?.questions.find(
      (q) => q.key === plan && String(q.id) === String(id),
    ) ?? null;

  function render(box) {
    const q = question(box.dataset.plan, box.dataset.q);
    if (!q) {
      box.innerHTML = `<span class="done">resolved in the plan</span>`;
      return;
    }
    const a = q.answer;
    if (a && box.dataset.editing !== "1") {
      box.innerHTML = `<span class="done ${a.discuss ? "discuss" : ""}">${a.discuss ? "Marked for discussion" : "Answered"} · ${esc(time(a.at))} · waiting for the orchestrator to apply</span>
        ${a.answer ? `<blockquote>${esc(a.answer)}</blockquote>` : ""}
        <div class="row"><button class="ghost" data-act="edit">Change answer</button></div>`;
      return;
    }
    box.innerHTML = `<textarea aria-label="Your answer to ${esc(q.id)}" placeholder="Your answer…">${esc(a?.answer ?? "")}</textarea>
      <div class="row"><button data-act="save">Save answer</button>
      <label><input type="checkbox" data-discuss ${a?.discuss ? "checked" : ""}> needs discussion instead</label>
      <span class="hint">⌘↵ saves · goes to ${esc(q.plan)}.answers.yaml</span></div><span class="err" hidden></span>`;
  }

  async function save(box) {
    const btn = box.querySelector('[data-act="save"]');
    const err = box.querySelector(".err");
    const answer = box.querySelector("textarea").value.trim();
    const discuss = box.querySelector("[data-discuss]").checked;
    if (!answer && !discuss) {
      err.hidden = false;
      err.textContent = "Write an answer or tick “needs discussion”.";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const r = await fetch("/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: box.dataset.plan,
          q: box.dataset.q,
          answer,
          discuss,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const entry = await r.json();
      const q = question(box.dataset.plan, box.dataset.q);
      if (q) q.answer = entry;
      box.dataset.editing = "0";
      render(box);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Save answer";
      err.hidden = false;
      err.textContent = `Not saved: ${e.message}`;
    }
  }

  function mount(host, plan, id) {
    if (host.querySelector(":scope > .hub-ans")) return;
    const box = document.createElement("div");
    box.className = "hub-ans";
    box.dataset.plan = plan;
    box.dataset.q = id;
    host.appendChild(box);
    render(box);
  }

  // A card on a hand-written page: the smallest block whose label names the id.
  function findCard(id, scope) {
    const re = new RegExp(
      `(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`,
    );
    const label = [...scope.querySelectorAll(".eyebrow, .k, h3")].find((el) =>
      re.test(el.textContent),
    );
    return label?.parentElement?.closest("article, .callout, .card, li, div") ?? null;
  }

  async function attach(root = document) {
    if (!data) await load();
    const seen = new Set();
    for (const el of root.querySelectorAll("[data-q]")) {
      if (el.classList.contains("hub-ans")) continue;
      const plan = el.dataset.plan ?? DEFAULT_PLAN;
      if (!plan) continue;
      seen.add(`${plan}#${el.dataset.q}`);
      if (question(plan, el.dataset.q)) mount(el, plan, el.dataset.q);
    }
    if (!DEFAULT_PLAN || root !== document) return;
    const scope = document.getElementById("open") ?? document.body;
    const rest = data.questions.filter(
      (q) => q.key === DEFAULT_PLAN && !seen.has(`${q.key}#${q.id}`),
    );
    const orphans = [];
    for (const q of rest) {
      const card = findCard(String(q.id), scope);
      card ? mount(card, q.key, String(q.id)) : orphans.push(q);
    }
    if (orphans.length && !document.querySelector(".hub-ans-panel")) {
      const panel = document.createElement("div");
      panel.className = "hub-ans-panel";
      panel.innerHTML = orphans
        .map(
          (q) =>
            `<article data-q="${esc(q.id)}" data-plan="${esc(q.key)}"><strong>${esc(q.id)} · ${esc(q.owner)}</strong>${q.title ? ` — ${esc(q.title)}` : ""}<p style="margin:4px 0 0">${esc(q.ask)}</p></article>`,
        )
        .join("");
      scope.appendChild(panel);
      panel
        .querySelectorAll("article")
        .forEach((a) => mount(a, a.dataset.plan, a.dataset.q));
    }
  }

  async function refresh() {
    await load();
    document.querySelectorAll(".hub-ans").forEach((box) => {
      const dirty =
        box.contains(document.activeElement) ||
        (box.querySelector("textarea")?.value ?? "") !==
          (question(box.dataset.plan, box.dataset.q)?.answer?.answer ?? "");
      if (!dirty) render(box);
    });
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest(".hub-ans button");
    if (!b) return;
    const box = b.closest(".hub-ans");
    if (b.dataset.act === "save") save(box);
    if (b.dataset.act === "edit") {
      box.dataset.editing = "1";
      render(box);
      box.querySelector("textarea")?.focus();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Enter" &&
      (e.metaKey || e.ctrlKey) &&
      e.target.closest?.(".hub-ans textarea")
    )
      save(e.target.closest(".hub-ans"));
  });

  window.PlanHubAnswers = {
    attach,
    refresh,
    setData: (d) => {
      data = d;
    },
  };
  if (DEFAULT_PLAN) {
    attach().catch(() => {});
    new EventSource("/events").onmessage = () => refresh().catch(() => {});
  }
})();
