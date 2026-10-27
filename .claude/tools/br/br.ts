#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Session,
  activateTab,
  browserMode,
  browserTarget,
  browserUp,
  closeTab,
  listPages,
  newTab,
  type Target,
} from "./cdp.ts";
import * as P from "./page.ts";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = join(homedir(), ".claude", "chrome");
const PROFILE = join(ROOT, "profile");
const STATE = join(ROOT, "state.json");
// Chrome creates Default/Cookies on first run, so seeding needs its own marker.
const SEED_MARK = join(ROOT, ".seeded");
const REAL_PROFILE = join(
  homedir(),
  "Library",
  "Application Support",
  "Google",
  "Chrome",
);

type Viewport = { w: number; h: number; dpr: number; mobile: boolean };
type State = { tabId?: string; scriptId?: string; viewport?: Viewport };

const loadState = (): State =>
  existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const saveState = (s: State) => {
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(STATE, JSON.stringify(s));
};

const die = (msg: string): never => {
  console.error(`br: ${msg}`);
  process.exit(1);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** OAuth/SSO URLs run to kilobytes; full URLs stay available via `br eval location.href`. */
function shortUrl(url: string, max = 100): string {
  if (url.length <= max) return url;
  try {
    const u = new URL(url);
    const head = `${u.origin}${u.pathname}`;
    if (head.length >= max) return `${head.slice(0, max)}…`;
    const params = [...u.searchParams.keys()];
    return `${head}?${params.slice(0, 3).join(",")}…+${Math.max(0, params.length - 3)} params`;
  } catch {
    return `${url.slice(0, max)}…`;
  }
}

// ---------------------------------------------------------------- browser

/**
 * Headless by default: an agent driving a visible Chrome steals the cursor and
 * flickers windows across the user's desktop. The profile, cookies and logins are
 * identical either way — `--window` exists for signing in by hand.
 */
const wantHeadless = () => !flag("--window");

async function start(): Promise<void> {
  const headless = wantHeadless();
  const running = await browserMode();
  if (running) {
    // Adopt whatever is already up; only complain when a mode was asked for
    // explicitly, so a windowed login session keeps working for later commands.
    if ((flag("--window") || flag("--headless")) && (running === "headless") !== headless) {
      die(
        `chrome is already running ${running === "headless" ? "headless" : "with a window"}; ` +
          "run `br stop` first to switch modes",
      );
    }
    return;
  }
  mkdirSync(PROFILE, { recursive: true });
  // Bun.spawn detached+unref still dies with the parent here; nohup via sh reparents.
  const cmd = [
    CHROME,
    // Headless otherwise defaults to 800x600, which renders desktop layouts at
    // tablet width and quietly misleads any screenshot or media-query check.
    ...(headless ? ["--headless=new", "--disable-gpu", "--window-size=1440,900"] : []),
    "--remote-debugging-port=9222",
    `--user-data-dir=${PROFILE}`,
    // Pinned: a seeded Local State can otherwise point Chrome at Profile 1, silently
    // orphaning everything seed/inspection writes to Default.
    "--profile-directory=Default",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "about:blank",
  ]
    .map((s) => `'${s.replace(/'/g, `'\\''`)}'`)
    .join(" ");
  Bun.spawnSync(["/bin/sh", "-c", `nohup ${cmd} >/dev/null 2>&1 &`]);

  for (let i = 0; i < 40; i++) {
    if (await browserUp()) return;
    await sleep(250);
  }
  die("Chrome did not open debug port 9222 within 10s");
}

/** Browser.close, not SIGTERM — Chrome batches cookie writes and only flushes on graceful exit. */
async function stop(): Promise<void> {
  if (!(await browserUp())) {
    console.log("already stopped");
    return;
  }
  const s = await Session.attach(await browserTarget());
  await s.send("Browser.close").catch(() => {});
  s.close();
  for (let i = 0; i < 40; i++) {
    if (!(await browserUp())) {
      console.log("stopped");
      return;
    }
    await sleep(250);
  }
  Bun.spawnSync(["pkill", "-f", `user-data-dir=${PROFILE}`]);
  console.log("stopped (forced — cookies may not have flushed)");
}

/**
 * Copies auth-bearing state out of the real Chrome profile. Chrome 136+ refuses
 * --remote-debugging-port on the default data dir, so the debug profile is
 * seeded instead of attached to. Requires both Chromes closed (locked SQLite).
 */
function seed(): void {
  if (!existsSync(REAL_PROFILE)) die(`no Chrome profile at ${REAL_PROFILE}`);
  const which = arg("--profile") ?? "Default";
  const src = join(REAL_PROFILE, which);
  if (!existsSync(src)) die(`no profile "${which}" in ${REAL_PROFILE}`);

  mkdirSync(join(PROFILE, "Default"), { recursive: true });
  const items = [
    "Cookies",
    "Login Data",
    "Login Data For Account",
    "Web Data",
    "Preferences",
    "Local Storage",
    "Session Storage",
    "IndexedDB",
  ];
  const copied: string[] = [];
  for (const item of items) {
    const from = join(src, item);
    if (!existsSync(from)) continue;
    cpSync(from, join(PROFILE, "Default", item), { recursive: true, force: true });
    copied.push(item);
  }
  // Local State deliberately not copied: on macOS the crypto key lives in the
  // Keychain, and the file's last-used-profile pointer redirects Chrome off Default.
  writeFileSync(SEED_MARK, `${which}\n`);
  console.log(`seeded from "${which}": ${copied.join(", ")}`);
  console.log("run `br start` — logins should carry over");
}

// ------------------------------------------------------------------- tabs

async function currentTarget(): Promise<Target> {
  await start();
  const pages = await listPages();
  if (pages.length === 0) return newTab("about:blank");
  const { tabId } = loadState();
  return pages.find((p) => p.id === tabId) ?? pages[0];
}

const PRESETS: Record<string, Viewport> = {
  mobile: { w: 390, h: 844, dpr: 3, mobile: true },
  tablet: { w: 820, h: 1180, dpr: 2, mobile: true },
  desktop: { w: 1440, h: 900, dpr: 1, mobile: false },
};

/**
 * Emulation overrides live on the CDP session, and br opens one per command — so
 * the saved viewport is re-applied on every attach rather than set once.
 */
async function applyViewport(s: Session): Promise<void> {
  const vp = loadState().viewport;
  if (!vp) return;
  await s.send("Emulation.setDeviceMetricsOverride", {
    width: vp.w,
    height: vp.h,
    deviceScaleFactor: vp.dpr,
    mobile: vp.mobile,
  });
  await s
    .send("Emulation.setTouchEmulationEnabled", { enabled: vp.mobile, maxTouchPoints: 5 })
    .catch(() => {});
}

/**
 * Input.dispatchKeyEvent is silently dropped unless the renderer thinks the page is
 * focused. Focus emulation buys that without stealing the OS window, so driving the
 * browser does not yank the user out of whatever they are doing; Page.bringToFront
 * is only the fallback when emulation is unavailable.
 */
async function focusTab(s: Session): Promise<void> {
  try {
    await s.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  } catch {
    await s.send("Page.bringToFront").catch(() => {});
  }
}

type DialogSeen = { type: string; message: string; handled: string } | null;

/**
 * A native alert/confirm/prompt blocks the renderer thread: input dispatch never
 * returns and every later command dies on a CDP timeout. Handle it the moment it
 * opens, on the session that is driving the page.
 *
 * Dismiss is the default because these dialogs guard destructive actions — Cancel
 * is the reversible answer. `--accept` opts in. beforeunload is the exception:
 * the caller explicitly asked to navigate, so leaving the page is the intent.
 */
function armDialogs(s: Session): () => DialogSeen {
  let seen: DialogSeen = null;
  const text = arg("--text");
  s.on("Page.javascriptDialogOpening", (p) => {
    const accept = p.type === "beforeunload" ? true : flag("--accept");
    seen = { type: p.type, message: p.message ?? "", handled: accept ? "accepted" : "dismissed" };
    s.send("Page.handleJavaScriptDialog", {
      accept,
      ...(text !== undefined ? { promptText: text } : {}),
    }).catch(() => {});
  });
  return () => seen;
}

function reportDialog(seen: DialogSeen): void {
  if (!seen) return;
  console.log(`dialog (${seen.type}) ${seen.handled}: "${seen.message}"`);
  // An alert has only an OK button, so there is nothing to re-run differently.
  if (seen.handled === "dismissed" && seen.type !== "alert") {
    console.log("  re-run with --accept to confirm it");
  }
}

/** Turns the 30s "CDP timeout: Runtime.enable" into something actionable. */
async function orDialogHint<T>(p: Promise<T>, ms = 5000): Promise<T> {
  const marker = Symbol("timeout");
  const r = await Promise.race([p, sleep(ms).then(() => marker)]);
  if (r === marker) {
    die(
      "page is not responding — a JavaScript dialog is most likely open.\n" +
        "    run `br dialog dismiss` (or `br dialog accept`), then retry",
    );
  }
  return r as T;
}

async function attach(): Promise<{ s: Session; t: Target }> {
  const t = await currentTarget();
  const s = await Session.attach(t);
  await orDialogHint(s.send("Runtime.enable"));
  await s.send("Page.enable");
  await applyViewport(s);
  await s.eval(P.RECORDER);
  return { s, t };
}

/** Registers the recorder for future navigations, replacing any prior copy. */
async function armRecorder(s: Session): Promise<void> {
  const st = loadState();
  if (st.scriptId) {
    await s
      .send("Page.removeScriptToEvaluateOnNewDocument", { identifier: st.scriptId })
      .catch(() => {});
  }
  const { identifier } = await s.send("Page.addScriptToEvaluateOnNewDocument", {
    source: P.RECORDER,
  });
  saveState({ ...loadState(), scriptId: identifier });
}

// ------------------------------------------------------------- oopif

type Frame = {
  frameId: string;
  url: string;
  x: number;
  y: number;
  sessionId?: string;
  contextId?: number;
};

/**
 * Every frame page-context JS cannot reach, with its offset in the top-level
 * viewport so a coordinate click routes into it. Two disjoint kinds:
 * out-of-process frames are separate targets; cross-origin frames that still share
 * the process are only addressable as separate execution contexts. Same-origin
 * frames are absent here — page JS walks those directly.
 */
async function foreignFrames(s: Session): Promise<Frame[]> {
  const found = new Map<string, { sessionId?: string; contextId?: number; url: string }>();

  try {
    for (const f of await s.attachToFrames()) {
      found.set(f.frameId, { sessionId: f.sessionId, url: f.url });
    }
  } catch {}

  // Re-enabling Runtime replays executionContextCreated for every live context.
  try {
    const ctxs: any[] = [];
    s.on("Runtime.executionContextCreated", (p) => ctxs.push(p.context));
    await s.send("Runtime.disable");
    await s.send("Runtime.enable");
    await sleep(120);
    const topOrigin = await s.eval("location.origin");
    const { frameTree } = await s.send("Page.getFrameTree");
    const mainId = frameTree?.frame?.id;
    for (const c of ctxs) {
      const frameId = c.auxData?.frameId;
      // Same-origin contexts are already covered by the page-JS document walk.
      if (!frameId || frameId === mainId || c.origin === topOrigin) continue;
      if (found.has(frameId)) continue;
      found.set(frameId, { contextId: c.id, url: c.origin ?? "" });
    }
  } catch {}

  if (found.size === 0) return [];
  await s.send("DOM.enable").catch(() => {});
  await s.send("DOM.getDocument", { depth: 0 }).catch(() => {});

  const out: Frame[] = [];
  for (const [frameId, info] of found) {
    try {
      const { backendNodeId } = await s.send("DOM.getFrameOwner", { frameId });
      const { model } = await s.send("DOM.getBoxModel", { backendNodeId });
      // content quad: x1,y1 is the top-left of the frame's content box
      const [x, y] = model.content as number[];
      out.push({ frameId, url: info.url, x, y, sessionId: info.sessionId, contextId: info.contextId });
    } catch {}
  }
  return out;
}

async function frameEval(s: Session, f: Frame, expr: string): Promise<any> {
  return s.eval(expr, { sessionId: f.sessionId, contextId: f.contextId });
}

// -------------------------------------------------------------- commands

/** Local hosts default to http — https on localhost is almost always a typo, not intent. */
function resolveUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const host = url.split("/")[0].split(":")[0];
  const local =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^127\.\d+\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^10\.\d+\.\d+\.\d+$/.test(host);
  return `${local ? "http" : "https"}://${url}`;
}

/**
 * Runs a navigating command and settles when the page is done. History navigations
 * can restore without firing load, so frameStoppedLoading on the main frame counts
 * too — otherwise back/forward always burns the full timeout.
 */
async function withLoad(s: Session, go: () => Promise<unknown>): Promise<void> {
  const mainId = await s
    .send("Page.getFrameTree")
    .then((r) => r?.frameTree?.frame?.id)
    .catch(() => undefined);
  const done = new Promise<void>((res) => {
    s.on("Page.loadEventFired", () => res());
    s.on("Page.frameStoppedLoading", (p) => {
      if (!mainId || p.frameId === mainId) res();
    });
  });
  await go();
  await Promise.race([done, sleep(15_000)]);
}

async function report(s: Session): Promise<{ url: string; title: string }> {
  const info = await s.eval("({url: location.href, title: document.title})");
  console.log(`${shortUrl(info.url)}\n${info.title}`);
  return info;
}

async function cmdOpen(url: string): Promise<void> {
  if (!url) die("usage: br open <url> [--new]");
  const full = resolveUrl(url);
  await start();

  // --new opens blank and navigates through the same path, so the load wait and
  // the recorder arming apply to it too.
  const target = flag("--new") ? await newTab("about:blank") : await currentTarget();
  saveState({ ...loadState(), tabId: target.id });
  const s = await Session.attach(target);
  await s.send("Page.enable");
  await s.send("Runtime.enable");
  await armRecorder(s);
  const dialog = armDialogs(s);

  // location.replace on the --new path, so the placeholder about:blank does not
  // survive as a history entry a later `br back` would land on.
  await withLoad(s, () =>
    flag("--new")
      ? s.eval(`location.replace(${JSON.stringify(full)})`).catch(() => {})
      : s.send("Page.navigate", { url: full }),
  );
  await s.eval(P.RECORDER);
  const info = await s.eval("({url: location.href, title: document.title})");
  s.close();
  if (info.url.startsWith("chrome-error://")) die(`navigation failed: ${full}`);
  console.log(`${shortUrl(info.url)}\n${info.title}`);
  reportDialog(dialog());
}

/** delta -1 = back, +1 = forward. */
async function cmdHistory(delta: number): Promise<void> {
  const { s } = await attach();
  await armRecorder(s);
  const dialog = armDialogs(s);
  const h = await s.send("Page.getNavigationHistory");
  const entry = h.entries[h.currentIndex + delta];
  if (!entry) die(delta < 0 ? "no page to go back to" : "no page to go forward to");
  await withLoad(s, () => s.send("Page.navigateToHistoryEntry", { entryId: entry.id }));
  await s.eval(P.RECORDER);
  await report(s);
  reportDialog(dialog());
  s.close();
}

async function cmdReload(): Promise<void> {
  const { s } = await attach();
  await armRecorder(s);
  const dialog = armDialogs(s);
  await withLoad(s, () => s.send("Page.reload", { ignoreCache: flag("--hard") }));
  await s.eval(P.RECORDER);
  await report(s);
  reportDialog(dialog());
  s.close();
}

async function cmdViewport(spec: string): Promise<void> {
  if (!spec) {
    const vp = loadState().viewport;
    console.log(
      vp ? `${vp.w}x${vp.h} @${vp.dpr}x${vp.mobile ? " mobile" : ""}` : "no override (real window)",
    );
    return;
  }
  if (spec === "reset" || spec === "off") {
    // Clear only lands in a session that holds the override, so attach while the
    // saved viewport is still there (attach re-applies it) and drop state after.
    const { s } = await attach();
    await s.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    await s.send("Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => {});
    saveState({ ...loadState(), viewport: undefined });
    await sleep(150);
    const seen = await s.eval("innerWidth");
    s.close();
    console.log(`viewport reset (${seen}px)`);
    return;
  }

  let vp = PRESETS[spec];
  if (!vp) {
    const m = /^(\d+)x(\d+)$/.exec(spec);
    if (!m) return die(`usage: br viewport <${Object.keys(PRESETS).join("|")}|WxH|reset>`);
    vp = { w: Number(m[1]), h: Number(m[2]), dpr: 1, mobile: false };
  }
  saveState({ ...loadState(), viewport: vp });
  const { s } = await attach();
  // Media queries and resize handlers need a beat before a read or shot is honest.
  await sleep(150);
  const seen = await s.eval("({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})");
  s.close();
  console.log(`viewport ${seen.w}x${seen.h} @${seen.dpr}x${vp.mobile ? " mobile" : ""}`);
}

async function cmdHover(target: string): Promise<void> {
  if (!target) die("usage: br hover <ref|selector|text>");
  const { s } = await attach();
  await focusTab(s);
  const hit = await locateAnywhere(s, target);
  if (!hit.ok) die(`no element matching: ${target}  (try \`br act\`)`);
  if (hit.blocked) die(`"${hit.label}" is covered by ${hit.blocked} — hover would land there instead`);
  await s.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(hit.x),
    y: Math.round(hit.y),
    button: "none",
  });
  // CSS transitions and JS menu handlers need a beat before `br act` sees the result.
  await sleep(150);
  console.log(`hovering ${hit.kind} "${hit.label}"`);
  s.close();
}

/**
 * Answers a dialog that is already blocking the page. Deliberately avoids
 * Runtime/attach(): those hang while a dialog is up, which is the whole problem.
 */
async function cmdDialog(action: string): Promise<void> {
  const act = (action ?? "").toLowerCase();
  if (act !== "accept" && act !== "dismiss") die("usage: br dialog <accept|dismiss> [--text s]");
  await start();
  const s = await Session.attach(await currentTarget());
  // No Page.enable: that call itself blocks while a dialog is up. handleJavaScriptDialog
  // does not need the domain enabled.
  const text = arg("--text");
  try {
    await s.send("Page.handleJavaScriptDialog", {
      accept: act === "accept",
      ...(text !== undefined ? { promptText: text } : {}),
    });
    console.log(`dialog ${act}ed`);
  } catch (err) {
    console.log(
      String(err).includes("No dialog") ? "no dialog is open" : `could not answer dialog: ${err}`,
    );
  }
  s.close();
}

async function cmdSelect(target: string, choice: string): Promise<void> {
  if (!target || choice === undefined || choice === "") {
    die("usage: br select <ref|selector|text> <value|label>");
  }
  const { s } = await attach();
  let r = await s.eval(P.select(target, choice));
  if (!r.ok && r.error === "no element matching") {
    for (const f of await foreignFrames(s)) {
      const fr = await frameEval(s, f, P.select(target, choice)).catch(() => null);
      if (fr && (fr.ok || fr.error !== "no element matching")) {
        r = fr;
        break;
      }
    }
  }
  if (!r.ok) {
    const opts = r.options?.length ? `\n    options: ${r.options.join(", ")}` : "";
    s.close();
    die(`${r.error}: ${r.options ? choice : target}${opts}`);
  }
  console.log(`selected "${r.label}" (${r.value}) in ${r.name}`);
  s.close();
}

async function cmdTabs(): Promise<void> {
  await start();
  const pages = await listPages();
  const { tabId } = loadState();
  pages.forEach((p, i) => {
    const mark = p.id === tabId ? "*" : " ";
    console.log(`${mark}[${i}] ${p.title.slice(0, 60)}\n     ${shortUrl(p.url)}`);
  });
}

async function cmdTab(n: string): Promise<void> {
  const pages = await listPages();
  const t = pages[Number(n)];
  if (!t) die(`no tab ${n} (have ${pages.length})`);
  saveState({ ...loadState(), tabId: t.id });
  await activateTab(t.id);
  console.log(`${shortUrl(t.url)}\n${t.title}`);
}

async function cmdEval(expr: string): Promise<void> {
  if (!expr) die("usage: br eval '<js>'");
  const { s } = await attach();
  const v = await s.eval(expr);
  console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  s.close();
}

async function cmdAct(): Promise<void> {
  const { s } = await attach();
  const r = await s.eval(P.act(0));
  const elements = [...r.elements];
  let next = r.next;
  const unreachable: string[] = [];
  // Cross-origin frames continue the same ref sequence.
  for (const f of await foreignFrames(s)) {
    try {
      const fr = await frameEval(s, f, P.act(next));
      for (const e of fr.elements) elements.push({ ...e, frame: "iframe" });
      next = fr.next;
    } catch {
      unreachable.push(f.url || f.frameId);
    }
  }
  if (flag("--json")) {
    console.log(JSON.stringify({ ...r, elements }, null, 2));
  } else {
    console.log(`${shortUrl(r.url)}\n${r.title}\n`);
    for (const e of elements) {
      console.log(`[${e.ref}] ${e.kind} "${e.label}"${e.frame ? "  (iframe)" : ""}`);
    }
    console.log(`\n${elements.length} actionable`);
    // Never let a frame vanish silently — an empty list must not read as "nothing there".
    for (const u of unreachable) console.log(`! iframe not reachable: ${shortUrl(u, 70)}`);
  }
  s.close();
}

type Hit = {
  ok: boolean;
  x: number;
  y: number;
  kind: string;
  label: string;
  blocked?: string | null;
  inFrame?: boolean;
  frame?: Frame;
};

/**
 * Resolves a target anywhere in the page: top document and same-origin frames are
 * handled by page JS, cross-origin frames by asking each attached frame session and
 * shifting its viewport-local coordinates by the frame's offset.
 */
async function locateAnywhere(s: Session, target: string, focus = false): Promise<Hit> {
  const hit = await s.eval(P.locate(target, focus));
  if (hit.ok) return hit;
  for (const f of await foreignFrames(s)) {
    try {
      const h = await frameEval(s, f, P.locate(target, focus));
      if (h.ok) return { ...h, x: h.x + f.x, y: h.y + f.y, inFrame: true, blocked: null, frame: f };
    } catch {}
  }
  return { ok: false } as Hit;
}

async function cmdRead(): Promise<void> {
  const { s } = await attach();
  const cap = Number(arg("--max") ?? 20_000);
  if (flag("--links")) {
    const r = await s.eval(P.READ_LINKS);
    console.log(`${shortUrl(r.url)}\n${r.title}\n`);
    for (const l of r.links) console.log(`${l.text} -> ${l.href}`);
  } else if (flag("--html")) {
    const r = await s.eval(P.READ_HTML);
    console.log(r.html.slice(0, cap));
  } else {
    const r = await s.eval(P.READ_TEXT);
    console.log(`${shortUrl(r.url)}\n${r.title}\n`);
    console.log(r.text.slice(0, cap));
    if (r.text.length > cap) console.log(`\n[truncated ${r.text.length - cap} chars]`);
  }
  s.close();
}

async function cmdClick(target: string): Promise<void> {
  if (!target) die("usage: br click <ref|selector|text>");
  const { s } = await attach();
  await focusTab(s);
  const dialog = armDialogs(s);
  const hit = await locateAnywhere(s, target);
  if (!hit.ok) die(`no element matching: ${target}  (try \`br act\`)`);
  if (hit.blocked) {
    die(
      `"${hit.label}" is covered by ${hit.blocked} — a click would hit that instead.\n` +
        `    dismiss the overlay first, or force it with: br eval 'document.querySelector(...).click()'`,
    );
  }
  const at = { x: Math.round(hit.x), y: Math.round(hit.y), button: "left", clickCount: 1 };
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
  await s.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
  console.log(`clicked ${hit.kind} "${hit.label}"`);
  reportDialog(dialog());
  s.close();
}

async function cmdType(target: string, text: string): Promise<void> {
  if (!target || text === undefined) die("usage: br type <ref|selector> <text>");
  const { s } = await attach();
  await focusTab(s);
  const dialog = armDialogs(s);
  const hit = await locateAnywhere(s, target, true);
  if (!hit.ok) die(`no element matching: ${target}  (try \`br act\`)`);
  if (flag("--clear")) await (hit.frame ? frameEval(s, hit.frame, P.CLEAR) : s.eval(P.CLEAR));
  if (flag("--fast")) await s.send("Input.insertText", { text });
  else await typeText(s, text);
  console.log(`typed into ${hit.kind} "${hit.label}"`);
  reportDialog(dialog());
  s.close();
}

/** US layout. Only what a key-filtered input or typeahead handler actually reads. */
const PUNCT: Record<string, [code: string, vk: number]> = {
  " ": ["Space", 32],
  ";": ["Semicolon", 186],
  "=": ["Equal", 187],
  ",": ["Comma", 188],
  "-": ["Minus", 189],
  ".": ["Period", 190],
  "/": ["Slash", 191],
  "`": ["Backquote", 192],
  "[": ["BracketLeft", 219],
  "\\": ["Backslash", 220],
  "]": ["BracketRight", 221],
  "'": ["Quote", 222],
};
/** Shifted glyph -> the physical key that produces it. */
const SHIFTED: Record<string, string> = {
  "~": "`", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5",
  "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
  _: "-", "+": "=", "{": "[", "}": "]", "|": "\\",
  ":": ";", '"': "'", "<": ",", ">": ".", "?": "/",
};

type KeyInfo = { code: string; vk: number; shift: boolean };

function physicalKey(ch: string): KeyInfo | null {
  const shift = ch in SHIFTED;
  const base = shift ? SHIFTED[ch] : ch;
  if (/^[a-z]$/.test(base)) return { code: `Key${base.toUpperCase()}`, vk: base.toUpperCase().charCodeAt(0), shift };
  if (/^[A-Z]$/.test(base)) return { code: `Key${base}`, vk: base.charCodeAt(0), shift: true };
  if (/^[0-9]$/.test(base)) return { code: `Digit${base}`, vk: base.charCodeAt(0), shift };
  const p = PUNCT[base];
  return p ? { code: p[0], vk: p[1], shift } : null;
}

/**
 * Types character by character with real key events. Input.insertText alone fires
 * none, so typeahead, char counters and key-filtered inputs never react — and a
 * handler that preventDefaults the keydown cannot block the insert. `--fast`
 * restores the bulk path for long strings where none of that matters.
 */
async function typeText(s: Session, text: string): Promise<void> {
  for (const ch of [...text]) {
    if (ch === "\n" || ch === "\r") {
      await pressKey(s, KEYS.enter, "\r");
      continue;
    }
    const k = physicalKey(ch);
    // Emoji, CJK and anything else off the US layout have no keycode to synthesise.
    if (!k) {
      await s.send("Input.insertText", { text: ch });
      continue;
    }
    const base = {
      key: ch,
      code: k.code,
      windowsVirtualKeyCode: k.vk,
      nativeVirtualKeyCode: k.vk,
      modifiers: k.shift ? 8 : 0,
    };
    await s.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, unmodifiedText: ch, ...base });
    await s.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
}

async function pressKey(s: Session, k: { key: string; code: string; vk: number }, text?: string): Promise<void> {
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
  await s.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(text ? { text } : {}) });
  await s.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

const KEYS: Record<string, { key: string; code: string; vk: number }> = {
  enter: { key: "Enter", code: "Enter", vk: 13 },
  tab: { key: "Tab", code: "Tab", vk: 9 },
  escape: { key: "Escape", code: "Escape", vk: 27 },
  backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  up: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
};

async function cmdKey(name: string): Promise<void> {
  const k = KEYS[(name ?? "").toLowerCase()];
  if (!k) die(`unknown key: ${name} (have ${Object.keys(KEYS).join(", ")})`);
  const { s } = await attach();
  await focusTab(s);
  const dialog = armDialogs(s);
  await pressKey(s, k);
  console.log(`pressed ${k.key}`);
  reportDialog(dialog());
  s.close();
}

async function cmdShot(path?: string): Promise<void> {
  const out = path ?? join(ROOT, "shot.png");
  const { s } = await attach();
  const r = await s.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: flag("--full"),
  });
  writeFileSync(out, Buffer.from(r.data, "base64"));
  console.log(out);
  s.close();
}

async function cmdNet(): Promise<void> {
  const { s } = await attach();
  const n = Number(arg("-n") ?? 25);
  const filter = arg("--filter");
  let net: any[] = (await s.eval("window.__br ? window.__br.net : []")) ?? [];
  if (filter) net = net.filter((e) => `${e.method} ${e.url} ${e.status}`.includes(filter));
  if (flag("--fail")) net = net.filter((e) => e.status === 0 || e.status >= 400);
  for (const e of net.slice(-n)) {
    console.log(`${String(e.status).padStart(3)} ${e.method.padEnd(6)} ${String(e.ms).padStart(5)}ms  ${shortUrl(e.url, 90)}`);
  }
  if (net.length === 0) console.log("(no fetch/XHR recorded — recorder installs on `br open`)");
  s.close();
}

async function cmdConsole(): Promise<void> {
  const { s } = await attach();
  const n = Number(arg("-n") ?? 50);
  const only = arg("--level");
  let logs: any[] = (await s.eval("window.__br ? window.__br.logs : []")) ?? [];
  if (flag("--errors")) logs = logs.filter((l) => ["error", "uncaught", "rejection"].includes(l.level));
  if (only) logs = logs.filter((l) => l.level === only);
  for (const l of logs.slice(-n)) console.log(`${l.level.padEnd(9)} ${l.text}`);
  if (logs.length === 0) console.log("(no logs recorded — recorder installs on `br open`)");
  s.close();
}

async function cmdWait(what: string): Promise<void> {
  const timeout = Number(arg("--timeout") ?? 15_000);
  if (/^\d+$/.test(what ?? "")) {
    await sleep(Number(what));
    return;
  }
  const { s } = await attach();
  const started = Date.now();

  if (flag("--idle") || !what) {
    let last = -1;
    let stable = 0;
    while (Date.now() - started < timeout) {
      const n = (await s.eval("window.__br ? window.__br.net.length : 0")) ?? 0;
      const ready = await s.eval("document.readyState");
      stable = n === last && ready === "complete" ? stable + 1 : 0;
      if (stable >= 3) {
        console.log(`idle after ${Date.now() - started}ms`);
        s.close();
        return;
      }
      last = n;
      await sleep(200);
    }
    s.close();
    die(`still busy after ${timeout}ms`);
  }

  while (Date.now() - started < timeout) {
    const hit = await locateAnywhere(s, what);
    if (hit.ok) {
      console.log(`found "${hit.label}" after ${Date.now() - started}ms`);
      s.close();
      return;
    }
    await sleep(200);
  }
  s.close();
  die(`timeout ${timeout}ms waiting for: ${what}`);
}

async function cmdStatus(): Promise<void> {
  const mode = await browserMode();
  const up = mode !== null;
  console.log(`chrome:  ${up ? `up on 9222 (${mode})` : "down"}`);
  const seededFrom = existsSync(SEED_MARK) ? readFileSync(SEED_MARK, "utf8").trim() : null;
  console.log(`profile: ${PROFILE}${seededFrom ? ` (seeded from "${seededFrom}")` : " (not seeded)"}`);
  if (!up) return;
  const pages = await listPages();
  const { tabId } = loadState();
  console.log(`tabs:    ${pages.length}`);
  const active = pages.find((p) => p.id === tabId) ?? pages[0];
  if (active) console.log(`active:  ${shortUrl(active.url)}`);
}

const USAGE = `br — Chrome via CDP

  br start [--window]          launch debug Chrome (headless; --window to see it)
  br seed [--profile Default]  copy cookies/logins from your real Chrome
  br status                    is it up, which tab, seeded?
  br stop                      quit debug Chrome

  br open <url> [--new]        navigate (waits for load)
  br back / br forward         history
  br reload [--hard]           reload (--hard bypasses cache)
  br tabs                      list tabs
  br tab <n>                   switch active tab
  br close                     close active tab

  br read [--links|--html] [--max N]     page content
  br act                                 actionable elements w/ [ref]
  br click <ref|selector|text>           real mouse click
  br dialog <accept|dismiss> [--text s]  answer a stuck alert/confirm/prompt
  br hover <ref|selector|text>           move mouse over element
  br viewport <mobile|tablet|desktop|WxH|reset>
  br select <ref|selector|text> <value|label>
  br type <ref|selector> <text> [--clear] [--fast]
  br key <enter|tab|escape|up|down|left|right|backspace>
  br wait <selector|text|ms> | --idle [--timeout ms]

  br eval '<js>'               run JS, print result
  br shot [path] [--full]      screenshot
  br net [-n 25] [--filter s] [--fail]
  br console [-n 50] [--errors] [--level warn]

Refs from \`br act\` stay valid until the DOM changes — re-run act after navigation.`;

// ---------------------------------------------------------------- dispatch

const BOOL_FLAGS = new Set([
  "--new", "--json", "--links", "--html", "--clear",
  "--full", "--fail", "--errors", "--idle", "--hard", "--fast", "--headless", "--window",
  "--accept", "--dismiss",
]);
const VALUE_FLAGS = new Set(["--max", "-n", "--filter", "--level", "--timeout", "--profile", "--text"]);

/**
 * Only *known* flags are consumed — an unrecognised leading dash is a positional,
 * so `br type 1 -50` keeps its text. Everything after `--` is positional verbatim.
 */
const { flags, values, positional } = (() => {
  const raw = process.argv.slice(2);
  const cut = raw.indexOf("--");
  const head = cut >= 0 ? raw.slice(0, cut) : raw;
  const tail = cut >= 0 ? raw.slice(cut + 1) : [];

  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (VALUE_FLAGS.has(a)) {
      const v = head[i + 1];
      if (v !== undefined) values.set(a, v);
      i++;
    } else if (BOOL_FLAGS.has(a)) {
      flags.add(a);
    } else {
      positional.push(a);
    }
  }
  return { flags, values, positional: [...positional, ...tail] };
})();

const flag = (name: string) => flags.has(name);
const arg = (name: string) => values.get(name);

const [cmd, a, ...rest] = positional;

try {
  switch (cmd) {
    case "start": await start(); await cmdStatus(); break;
    case "seed": seed(); break;
    case "status": await cmdStatus(); break;
    case "stop": await stop(); break;
    case "open": case "nav": case "goto": await cmdOpen(a); break;
    case "back": await cmdHistory(-1); break;
    case "forward": await cmdHistory(1); break;
    case "reload": await cmdReload(); break;
    case "tabs": await cmdTabs(); break;
    case "tab": await cmdTab(a); break;
    case "close": { const t = await currentTarget(); await closeTab(t.id); console.log("closed"); break; }
    case "read": await cmdRead(); break;
    case "act": await cmdAct(); break;
    case "dialog": await cmdDialog(a); break;
    case "click": await cmdClick(a); break;
    case "hover": await cmdHover(a); break;
    case "viewport": await cmdViewport(a); break;
    case "select": await cmdSelect(a, rest.join(" ")); break;
    case "type": await cmdType(a, rest.join(" ")); break;
    case "key": await cmdKey(a); break;
    case "wait": await cmdWait(a); break;
    case "eval": await cmdEval(a); break;
    case "shot": await cmdShot(a); break;
    case "net": await cmdNet(); break;
    case "console": await cmdConsole(); break;
    default: console.log(USAGE);
  }
  process.exit(0);
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
