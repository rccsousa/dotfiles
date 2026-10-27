/**
 * Page-context scripts. Every export is a JS source string evaluated via
 * Runtime.evaluate — output shapes are tuned for low token count, not fidelity:
 * `act` returns only actionable elements with stable refs, never a full a11y tree.
 */

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=tab]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=menuitem]",
  "[role=option]",
  "[role=switch]",
  "[contenteditable=true]",
  "[onclick]",
].join(",");

/** Shared helpers spliced into each script; page-scope, no globals leaked. */
const HELPERS = `
const __vis = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const win = el.ownerDocument.defaultView || window;
  const s = win.getComputedStyle(el);
  if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) < 0.05) return false;
  return true;
};
/** Top document plus every same-origin frame document, depth-first. Cross-origin
 *  frames throw on contentDocument and are skipped — br.ts drives those over CDP. */
const __docs = () => {
  const out = [];
  const walk = (win, depth) => {
    let doc = null;
    try { doc = win.document; } catch { return; }
    if (!doc) return;
    out.push(win);
    if (depth > 4) return;
    for (const f of doc.querySelectorAll("iframe,frame")) {
      let cw = null;
      try { cw = f.contentDocument ? f.contentWindow : null; } catch { cw = null; }
      if (cw) walk(cw, depth + 1);
    }
  };
  walk(window, 0);
  return out;
};
/** Frame-local viewport coords -> top-level viewport coords. */
const __offset = (win) => {
  let x = 0, y = 0;
  let w = win;
  while (w && w !== window) {
    let fe = null;
    try { fe = w.frameElement; } catch { fe = null; }
    if (!fe) break;
    const r = fe.getBoundingClientRect();
    const cs = (fe.ownerDocument.defaultView || window).getComputedStyle(fe);
    x += r.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
    y += r.top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
    w = w.parent;
  }
  return { x, y };
};
const __labelledby = (el) => {
  const ids = (el.getAttribute("aria-labelledby") || "").split(/\\s+/).filter(Boolean);
  return ids.map((id) => { const n = document.getElementById(id); return n ? n.innerText : ""; }).join(" ");
};
// Icon-only links/buttons are common and carry no innerText; without these
// fallbacks a quarter of a typical page returns unusable empty refs.
const __nested = (el) => {
  const img = el.querySelector("img[alt]");
  if (img && img.alt.trim()) return img.alt;
  const svg = el.querySelector("svg");
  if (svg) {
    const t = svg.querySelector("title");
    if (t && t.textContent.trim()) return t.textContent;
    if (svg.getAttribute("aria-label")) return svg.getAttribute("aria-label");
  }
  const inner = el.querySelector("[aria-label]");
  return inner ? inner.getAttribute("aria-label") : "";
};
const __hrefHint = (el) => {
  const href = el.getAttribute("href");
  if (!href || href.startsWith("javascript:") || href === "#") return "";
  try {
    const u = new URL(href, location.href);
    const tail = u.pathname.split("/").filter(Boolean).pop();
    return tail ? "→" + tail : (u.hostname !== location.hostname ? "→" + u.hostname : "");
  } catch { return ""; }
};
const __label = (el) => {
  const pick = [
    el.getAttribute("aria-label"),
    __labelledby(el),
    el.getAttribute("placeholder"),
    el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? el.value : null,
    el.innerText,
    __nested(el),
    el.getAttribute("title"),
    el.getAttribute("alt"),
    el.getAttribute("name"),
    __hrefHint(el),
  ].find((v) => v && v.trim());
  return (pick || "").replace(/\\s+/g, " ").trim().slice(0, 80);
};
const __kind = (el) => {
  const t = el.tagName.toLowerCase();
  if (t === "input") return "input:" + (el.getAttribute("type") || "text");
  if (t === "a") return "link";
  return el.getAttribute("role") || t;
};
/** Resolution order: data-br-ref index, CSS selector, exact label, label substring.
 *  Each pass sweeps every same-origin document before the next one widens. */
const __find = (t) => {
  const wins = __docs();
  const q = (fn) => {
    for (const w of wins) {
      try { const hit = fn(w.document); if (hit) return hit; } catch {}
    }
    return null;
  };
  let el = null;
  if (/^\\d+$/.test(t)) el = q((d) => d.querySelector('[data-br-ref="' + t + '"]'));
  if (!el) el = q((d) => { try { return d.querySelector(t); } catch { return null; } });
  if (!el) {
    const wanted = t.toLowerCase();
    const cands = [];
    for (const w of wins) {
      try { cands.push(...w.document.querySelectorAll(${JSON.stringify(INTERACTIVE_SELECTOR)})); } catch {}
    }
    const vis = cands.filter(__vis);
    el = vis.find((c) => __label(c).toLowerCase() === wanted)
      || vis.find((c) => __label(c).toLowerCase().includes(wanted));
  }
  return el;
};
`;

/** Tags visible interactive elements with data-br-ref and returns a compact list. */
/**
 * `start` lets br.ts continue the ref sequence into cross-origin frames, so refs
 * stay one flat namespace the user can click by number regardless of frame.
 */
export function act(start = 0): string {
  return `(() => {
${HELPERS}
  const wins = __docs();
  const out = [];
  let n = ${start};
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    let doc;
    try { doc = w.document; } catch { continue; }
    doc.querySelectorAll("[data-br-ref]").forEach((el) => el.removeAttribute("data-br-ref"));
    for (const el of doc.querySelectorAll(${JSON.stringify(INTERACTIVE_SELECTOR)})) {
      if (!__vis(el)) continue;
      if (el.disabled) continue;
      n += 1;
      el.setAttribute("data-br-ref", String(n));
      out.push({ ref: n, kind: __kind(el), label: __label(el), frame: i === 0 ? null : "iframe" });
    }
  }
  return { url: location.href, title: document.title, elements: out, next: n };
})()`;
}

/** Visible text, blank-line collapsed. */
export const READ_TEXT = `(() => {
  const el = document.querySelector("main, article, [role=main]") || document.body;
  return {
    url: location.href,
    title: document.title,
    text: (el.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim(),
  };
})()`;

export const READ_LINKS = `(() => {
${HELPERS}
  const seen = new Set();
  const links = [];
  for (const a of document.querySelectorAll("a[href]")) {
    if (!__vis(a)) continue;
    const href = a.href;
    if (seen.has(href) || href.startsWith("javascript:")) continue;
    seen.add(href);
    links.push({ text: __label(a), href });
  }
  return { url: location.href, title: document.title, links };
})()`;

export const READ_HTML = `(() => ({
  url: location.href,
  title: document.title,
  html: document.documentElement.outerHTML,
}))()`;

/**
 * Ring-buffer recorder for console + fetch/XHR. Installed via
 * Page.addScriptToEvaluateOnNewDocument so it survives navigation and runs
 * before page scripts. Only patches fetch/XHR — subresource loads (img, css,
 * document) are invisible to it by design.
 */
export const RECORDER = `(() => {
  if (window.__br) return;
  const CAP = 300;
  const push = (arr, v) => { arr.push(v); if (arr.length > CAP) arr.shift(); };
  const br = { logs: [], net: [], t0: Date.now() };
  window.__br = br;

  const fmt = (a) => {
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      push(br.logs, { level, text: args.map(fmt).join(" ").slice(0, 500), at: Date.now() - br.t0 });
      orig(...args);
    };
  }
  addEventListener("error", (e) =>
    push(br.logs, { level: "uncaught", text: String(e.message), at: Date.now() - br.t0 }));
  addEventListener("unhandledrejection", (e) =>
    push(br.logs, { level: "rejection", text: String(e.reason), at: Date.now() - br.t0 }));

  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    const started = Date.now();
    const req = args[0];
    const url = typeof req === "string" ? req : req.url;
    const method = (args[1] && args[1].method) || (typeof req === "object" && req.method) || "GET";
    try {
      const res = await origFetch(...args);
      push(br.net, { method, url, status: res.status, ms: Date.now() - started, via: "fetch" });
      return res;
    } catch (err) {
      push(br.net, { method, url, status: 0, ms: Date.now() - started, via: "fetch", error: String(err) });
      throw err;
    }
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__br = { method, url };
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const started = Date.now();
    this.addEventListener("loadend", () => {
      const m = this.__br || {};
      push(br.net, { method: m.method, url: m.url, status: this.status, ms: Date.now() - started, via: "xhr" });
    });
    return origSend.call(this, ...args);
  };
})()`;

/**
 * Scrolls target into view and returns its viewport-center coordinates.
 * Resolution order: data-br-ref index, CSS selector, exact label, label substring.
 * `blocked` is set when a hit-test at those coordinates lands on something else —
 * a coordinate click would silently hit the overlay and report success.
 */
export function locate(target: string, focus = false): string {
  return `(() => {
${HELPERS}
  const __desc = (el) => {
    if (!el) return "nothing (off-screen)";
    const id = el.id ? "#" + el.id : "";
    const cls = el.className && typeof el.className === "string"
      ? "." + el.className.trim().split(/\\s+/)[0] : "";
    return el.tagName.toLowerCase() + id + cls;
  };
  const el = __find(${JSON.stringify(target)});
  if (!el) return { ok: false };
  el.scrollIntoView({ block: "center", inline: "center" });
  ${focus ? "el.focus();" : ""}
  const win = el.ownerDocument.defaultView || window;
  const off = __offset(win);
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2 + off.x;
  const y = r.top + r.height / 2 + off.y;

  const top = document.elementFromPoint(x, y);
  // Ancestor hits count as reachable: wrappers with pointer-events:none on the
  // child are common and the click still lands on the intended handler. For an
  // element inside a frame the top-level hit test can only ever return the
  // <iframe>, so that counts as reachable once it is the right frame.
  let reachable = top && (top === el || el.contains(top) || top.contains(el));
  if (!reachable && top && top.tagName === "IFRAME") {
    let w = win;
    while (w && w !== window) {
      let fe = null;
      try { fe = w.frameElement; } catch { fe = null; }
      if (fe === top) { reachable = true; break; }
      w = w.parent;
    }
  }
  return {
    ok: true,
    x, y,
    inFrame: win !== window,
    kind: __kind(el),
    label: __label(el),
    blocked: reachable ? null : __desc(top),
  };
})()`;
}

/**
 * Picks an option in a <select>. Matches on value, then exact label, then label
 * substring. Writes selectedIndex rather than .value so the framework's value
 * tracker sees a diff on the change event (see CLEAR).
 */
export function select(target: string, choice: string): string {
  return `(() => {
${HELPERS}
  let el = __find(${JSON.stringify(target)});
  if (el && el.tagName !== "SELECT") el = el.closest("select") || el.querySelector("select") || el;
  if (!el) return { ok: false, error: "no element matching" };
  if (el.tagName !== "SELECT") return { ok: false, error: "not a <select>, it is a " + __kind(el) };

  const want = ${JSON.stringify(choice)};
  const lc = want.toLowerCase();
  const opts = [...el.options];
  const txt = (o) => (o.label || o.textContent || "").replace(/\\s+/g, " ").trim();
  const hit =
    opts.find((o) => o.value === want) ||
    opts.find((o) => txt(o).toLowerCase() === lc) ||
    opts.find((o) => txt(o).toLowerCase().includes(lc));
  if (!hit) {
    return { ok: false, error: "no option matching", options: opts.map((o) => txt(o) + " (" + o.value + ")") };
  }

  if (el.multiple) hit.selected = true;
  else el.selectedIndex = hit.index;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, label: txt(hit), value: hit.value, name: el.id || el.name || "select" };
})()`;
}

/**
 * Clears the focused field. Assigning `.value` goes through React's instance-level
 * value tracker, which then sees no diff on the input event and reverts the field;
 * the prototype setter bypasses it. Same trap in Vue/Svelte two-way bindings.
 */
export const CLEAR = `(() => {
  // document.activeElement stops at the <iframe>; descend to the real field.
  let el = document.activeElement;
  for (let i = 0; i < 5; i++) {
    let inner = null;
    try { inner = el && el.contentDocument ? el.contentDocument.activeElement : null; } catch { inner = null; }
    if (!inner) break;
    el = inner;
  }
  if (!el) return false;
  if (el.isContentEditable) {
    el.textContent = "";
  } else {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, "value");
    if (d && d.set) d.set.call(el, ""); else el.value = "";
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`;
