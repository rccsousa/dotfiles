#!/usr/bin/env bun
// Lists hub answers not yet folded into the plan. Usage: bun pending-answers.ts <slug>.plan.yaml   (exit 0, prints "none" when clean)
import { pendingAnswers } from "./hub-lib";

const planPath = process.argv[2];
if (!planPath) {
  console.error("usage: bun pending-answers.ts <plan.yaml>");
  process.exit(2);
}
const pending = await pendingAnswers(planPath);
if (!pending.length) console.log("none");
for (const p of pending) {
  const q = p.question as { title?: string; ask: string; blocks?: string[] };
  console.log(`${p.q}${p.discuss ? " [NEEDS DISCUSSION]" : ""} · answered ${p.at} by ${p.by}`);
  console.log(`  Q: ${q.title ? `${q.title}: ` : ""}${q.ask}`);
  if (q.blocks?.length) console.log(`  blocks: ${q.blocks.join(", ")}`);
  console.log(`  A: ${p.answer.replace(/\n/g, "\n     ")}\n`);
}
