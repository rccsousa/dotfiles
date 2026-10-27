const HOST = "127.0.0.1:9222";

export type Target = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
};

export async function listPages(): Promise<Target[]> {
  const res = await fetch(`http://${HOST}/json`);
  const all = (await res.json()) as Target[];
  return all.filter((t) => t.type === "page" && !t.url.startsWith("devtools://"));
}

/** "headless" | "window" from the live browser, or null when it is not running. */
export async function browserMode(): Promise<"headless" | "window" | null> {
  try {
    const res = await fetch(`http://${HOST}/json/version`, { signal: AbortSignal.timeout(800) });
    const v = (await res.json()) as { Browser?: string; "User-Agent"?: string };
    // --headless=new leaves Browser as plain "Chrome/..."; only the UA still says Headless.
    const marker = `${v["User-Agent"] ?? ""} ${v.Browser ?? ""}`;
    return marker.includes("Headless") ? "headless" : "window";
  } catch {
    return null;
  }
}

export async function browserUp(): Promise<boolean> {
  try {
    await fetch(`http://${HOST}/json/version`, {
      signal: AbortSignal.timeout(800),
    });
    return true;
  } catch {
    return false;
  }
}

/** Browser-level endpoint — for targets-wide commands like Browser.close. */
export async function browserTarget(): Promise<Target> {
  const res = await fetch(`http://${HOST}/json/version`);
  const v = (await res.json()) as { webSocketDebuggerUrl: string };
  return { id: "browser", type: "browser", title: "", url: "", webSocketDebuggerUrl: v.webSocketDebuggerUrl };
}

export async function newTab(url: string): Promise<Target> {
  const res = await fetch(`http://${HOST}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  return res.json() as Promise<Target>;
}

export async function activateTab(id: string): Promise<void> {
  await fetch(`http://${HOST}/json/activate/${id}`);
}

export async function closeTab(id: string): Promise<void> {
  await fetch(`http://${HOST}/json/close/${id}`);
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class Session {
  #ws: WebSocket;
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #handlers = new Map<string, ((params: any) => void)[]>();

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.addEventListener("message", (ev) => this.#onMessage(String(ev.data)));
  }

  static async attach(target: Target, timeoutMs = 5000): Promise<Session> {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`ws connect timeout: ${target.webSocketDebuggerUrl}`)),
        timeoutMs,
      );
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`ws connect failed: ${target.webSocketDebuggerUrl}`));
      });
    });
    return new Session(ws);
  }

  #onMessage(raw: string) {
    const msg = JSON.parse(raw);
    if (msg.id !== undefined) {
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else p.resolve(msg.result);
      return;
    }
    // Child-session events (attached iframes) must not fire page-level handlers.
    if (msg.sessionId) return;
    for (const h of this.#handlers.get(msg.method) ?? []) h(msg.params);
  }

  on(method: string, fn: (params: any) => void) {
    const list = this.#handlers.get(method) ?? [];
    list.push(fn);
    this.#handlers.set(method, list);
  }

  /** `sessionId` targets an attached child (out-of-process iframe) instead of the page. */
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = this.#nextId++;
    this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.#pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
    });
  }

  /**
   * Cross-origin iframes run in their own target, so page-context JS cannot reach
   * them. Attaching flat multiplexes those sessions over this same socket.
   */
  async attachToFrames(): Promise<{ sessionId: string; frameId: string; url: string }[]> {
    const { targetInfos } = await this.send("Target.getTargets");
    const out: { sessionId: string; frameId: string; url: string }[] = [];
    for (const t of targetInfos ?? []) {
      if (t.type !== "iframe") continue;
      try {
        const { sessionId } = await this.send("Target.attachToTarget", {
          targetId: t.targetId,
          flatten: true,
        });
        // For an OOPIF the targetId is the frameId, which DOM.getFrameOwner needs.
        out.push({ sessionId, frameId: t.targetId, url: t.url });
      } catch {}
    }
    return out;
  }

  /**
   * Runs `expr` and returns its value. Throws on JS exception. Frames are reached
   * two different ways: an out-of-process iframe is its own target (`sessionId`),
   * while a cross-origin iframe that still shares the process is only addressable
   * as a separate execution context (`contextId`) on this target.
   */
  async eval(expr: string, into: { sessionId?: string; contextId?: number } = {}): Promise<any> {
    const r = await this.send(
      "Runtime.evaluate",
      {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
        ...(into.contextId ? { contextId: into.contextId } : {}),
      },
      into.sessionId,
    );
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description ?? d.text ?? "eval failed");
    }
    return r.result?.value;
  }

  close() {
    this.#ws.close();
  }
}
