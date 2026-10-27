#!/usr/bin/env bun
// Static build of the plan hub. The live service is serve-hub.ts; this is the offline fallback the hook runs when the service is down.
// Usage: bun build-hub.ts [--out <file>] [--open] [--pr] [root ...]   (default out: ~/.claude/plan-hub/index.html)

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  applyPrLive,
  collect,
  DEFAULT_ROOTS,
  fetchPrLive,
  HOME,
  render,
} from "./hub-lib";

const args = process.argv.slice(2);
let out = join(HOME, ".claude/plan-hub/index.html");
let open = false;
let pr = false;
const roots: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") out = args[++i];
  else if (args[i] === "--open") open = true;
  else if (args[i] === "--pr") pr = true;
  else roots.push(args[i]);
}

const data = await collect(roots.length ? roots : DEFAULT_ROOTS);
if (pr) {
  try {
    applyPrLive(data, await fetchPrLive(data), new Date().toISOString());
  } catch (e) {
    data.prError = (e as Error).message;
  }
}
mkdirSync(dirname(out), { recursive: true });
await Bun.write(out, await render(data, { served: false }));
console.log(
  `${out}\n${data.projects.length} projects, ${data.plans.length} plans, ${data.cards.length} slices, ${data.questions.length} open questions`,
);
if (open) Bun.spawnSync(["open", out]);
