#!/usr/bin/env bun
// Injects the plan's open questions as JSON between <!-- q:data --> markers so the page's answer inbox can render them.
// Usage: bun render-answers.ts <plan.yaml> <page.html>

const [yamlPath, htmlPath] = process.argv.slice(2);
if (!yamlPath || !htmlPath) {
  console.error("usage: bun render-answers.ts <plan.yaml> <page.html>");
  process.exit(2);
}

type Open = {
  id: string;
  owner: string;
  title?: string;
  ask: string;
  blocks?: string[];
  choices?: string[];
  link?: string;
  status?: string;
};

type StoryStep = {
  n: number;
  short?: string;
  subject: string;
  role?: string;
  lane?: string;
  kind?: string;
  money?: boolean;
  state: string;
  sha?: string | null;
};
const plan = Bun.YAML.parse(await Bun.file(yamlPath).text()) as {
  open?: Open[];
  story?: StoryStep[];
  meta: Record<string, unknown>;
};
const story = (plan.story ?? []).map((c) => ({
  n: c.n,
  short: c.short ?? c.subject,
  subject: c.subject,
  role: c.role ?? "",
  lane: c.lane ?? "other",
  kind: c.kind ?? "feat",
  money: c.money ?? false,
  state: c.state,
  sha: c.sha ?? null,
}));
const questions = (plan.open ?? [])
  .filter((q) => q.status !== "resolved")
  .map((q) => ({
    id: q.id,
    owner: q.owner,
    title: q.title ?? q.id,
    ask: q.ask,
    blocks: q.blocks ?? [],
    choices: q.choices ?? [],
    link: q.link ?? null,
  }));

const json = JSON.stringify({
  published: plan.meta.published ?? null,
  questions,
  story,
}).replaceAll("<", "\\u003c");
const html = await Bun.file(htmlPath).text();
const re = /(<!-- q:data -->)[\s\S]*?(<!-- \/q:data -->)/;
if (!re.test(html)) {
  console.error("no <!-- q:data --> block in page");
  process.exit(1);
}
await Bun.write(
  htmlPath,
  html.replace(
    re,
    `$1\n<script type="application/json" id="qdata">${json}</script>\n$2`,
  ),
);
console.log(`injected ${questions.length} open questions`);
