#!/usr/bin/env bun
// Live plan hub on http://127.0.0.1:4747 (PLAN_HUB_PORT). Run by launchd: ~/Library/LaunchAgents/local.plan-hub.plist.
// Rebuilds on handoff-dir changes and POST /rebuild (the Claude hook), rescans roots every 2 min, polls PR state every 5 min.
// Pushes updates to open pages over SSE; also keeps ~/.claude/plan-hub/index.html current as the offline copy.

import { type FSWatcher, mkdirSync, watch } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import {
  appendAnswer,
  applyPrLive,
  collect,
  DEFAULT_ROOTS,
  fetchPrLive,
  HOME,
  type HubData,
  type PrLive,
  render,
} from "./hub-lib";

const PORT = Number(process.env.PLAN_HUB_PORT ?? 4747);
const ROOTS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_ROOTS;
const STATIC_OUT = join(HOME, ".claude/plan-hub/index.html");
const PR_EVERY_MS = 5 * 60_000;
const RESCAN_EVERY_MS = 2 * 60_000;

let data: HubData;
let prLive = new Map<string, PrLive>();
let prChecked: string | null = null;
let prError: string | null = null;
const clients = new Set<ReadableStreamDefaultController>();
const watchers = new Map<string, FSWatcher>();

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

function broadcast() {
  const msg = new TextEncoder().encode(`data: ${data.built}\n\n`);
  for (const c of clients) {
    try {
      c.enqueue(msg);
    } catch {
      clients.delete(c);
    }
  }
}

async function rebuild(reason: string) {
  const next = await collect(ROOTS);
  if (prChecked) applyPrLive(next, prLive, prChecked);
  next.prError = prError;
  data = next;
  syncWatchers();
  mkdirSync(dirname(STATIC_OUT), { recursive: true });
  await Bun.write(STATIC_OUT, await render(data, { served: false }));
  broadcast();
  log(
    `rebuilt (${reason}): ${data.plans.length} plans, ${data.cards.length} slices`,
  );
}

async function refreshPrs() {
  try {
    prLive = await fetchPrLive(data);
    prChecked = new Date().toISOString();
    prError = null;
  } catch (e) {
    prError = (e as Error).message;
    log("pr refresh failed:", prError);
  }
  await rebuild("pr");
}

let timer: Timer | null = null;
const debounced = (reason: string) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(
    () => rebuild(reason).catch((e) => log("rebuild failed:", e)),
    300,
  );
};

function syncWatchers() {
  const want = new Set(data.handoffDirs);
  for (const [d, w] of watchers)
    if (!want.has(d)) w.close(), watchers.delete(d);
  for (const d of want) {
    if (watchers.has(d)) continue;
    try {
      watchers.set(
        d,
        watch(
          d,
          (_ev, f) =>
            f &&
            /\.(ya?ml|json|html|md)$/.test(String(f)) &&
            debounced(`fs ${f}`),
        ),
      );
    } catch (e) {
      log("watch failed", d, (e as Error).message);
    }
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// Browsers refuse file:// links from an http page, so plan pages and handoff docs are served here, confined to handoff dirs.
async function serveFile(p: string | null) {
  if (!p) return new Response("missing p", { status: 400 });
  const abs = resolve(p);
  if (!data.handoffDirs.some((d) => abs.startsWith(d + "/")))
    return new Response("outside handoff dirs", { status: 403 });
  const type = TYPES[extname(abs)];
  if (!type) return new Response("unsupported type", { status: 415 });
  const plan = data.plans.find((pl) => pl.humanView === abs);
  if (!plan) return new Response(Bun.file(abs), { headers: { "content-type": type } });
  // plan pages get inline answer boxes on their open questions
  const kit = `<script src="/answer-kit.js" data-plan="${plan.key.replace(/"/g, "")}"></script>`;
  const html = await Bun.file(abs).text();
  const out = html.includes("</body>") ? html.replace(/<\/body>(?![\s\S]*<\/body>)/, `${kit}</body>`) : html + kit;
  return new Response(out, { headers: { "content-type": type } });
}

const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

// Same-origin JSON only: a cross-site page cannot send application/json without a preflight, which this server never grants.
async function postAnswer(req: Request) {
  if (!ORIGINS.has(req.headers.get("origin") ?? "")) return new Response("forbidden origin", { status: 403 });
  if (!req.headers.get("content-type")?.startsWith("application/json")) return new Response("json only", { status: 415 });
  const body = (await req.json().catch(() => null)) as { plan?: string; q?: string; answer?: string; discuss?: boolean } | null;
  const plan = data.plans.find((p) => p.key === body?.plan);
  const q = data.questions.find((x) => x.key === body?.plan && String(x.id) === body?.q);
  const answer = String(body?.answer ?? "").trim();
  if (!plan || !q) return new Response("unknown plan or question (resolved already?)", { status: 404 });
  if (!answer && !body?.discuss) return new Response("empty answer", { status: 400 });
  if (answer.length > 10_000) return new Response("answer too long", { status: 413 });
  const entry = { q: String(q.id), answer, discuss: !!body?.discuss, at: new Date().toISOString(), by: "rui via hub" };
  await appendAnswer(plan.answersPath, plan.slug, entry);
  log(`answer ${plan.key} ${entry.q}${entry.discuss ? " (discuss)" : ""}`);
  await rebuild("answer");
  return Response.json(entry);
}

await rebuild("start");
refreshPrs();
setInterval(refreshPrs, PR_EVERY_MS);
setInterval(
  () => rebuild("rescan").catch((e) => log("rescan failed:", e)),
  RESCAN_EVERY_MS,
);

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    switch (`${req.method} ${url.pathname}`) {
      case "GET /":
        return new Response(await render(data, { served: true }), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      case "GET /data.json":
        return Response.json(data);
      case "GET /f":
        return serveFile(url.searchParams.get("p"));
      case "GET /health":
        return Response.json({
          ok: true,
          built: data.built,
          prChecked,
          prError,
          clients: clients.size,
        });
      case "POST /answer":
        return postAnswer(req);
      case "GET /answer-kit.js":
        return new Response(Bun.file(join(import.meta.dir, "answer-kit.js")), {
          headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" },
        });
      case "POST /rebuild":
        debounced("hook");
        return new Response(null, { status: 202 });
      case "POST /refresh-pr":
        await refreshPrs();
        return Response.json({ prChecked, prError });
      case "GET /events": {
        let ctl: ReadableStreamDefaultController;
        let ping: Timer;
        const stream = new ReadableStream({
          start(c) {
            ctl = c;
            clients.add(c);
            c.enqueue(new TextEncoder().encode(": hi\n\n"));
            ping = setInterval(() => {
              try {
                c.enqueue(new TextEncoder().encode(": ping\n\n"));
              } catch {
                clearInterval(ping);
              }
            }, 20_000);
          },
          cancel() {
            clients.delete(ctl);
            clearInterval(ping);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
          },
        });
      }
    }
    return new Response("not found", { status: 404 });
  },
});
log(`plan hub on http://127.0.0.1:${PORT}`);
