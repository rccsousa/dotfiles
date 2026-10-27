// Shared by build-hub.ts (static file) and serve-hub.ts (live service): scan plans, overlay live PR state, render the page.

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const HOME = homedir();
export const DEFAULT_ROOTS = [join(HOME, "work"), join(HOME, "projects")];

const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "vendor",
  "target",
  ".venv",
]);

export type Doc = {
  name: string;
  path: string;
  kind: "html" | "md";
  mtime: string;
};
export type PrLive = {
  state: string;
  draft: boolean;
  merge: string | null;
  review: string | null;
  checks: string | null;
  url: string;
};
export type Card = {
  project: string;
  plan: string;
  id: string;
  title: string;
  state: string;
  ticket: string | null;
  track: string | null;
  wave: number | null;
  effort: string | null;
  loc: [number, number] | null;
  pr: number | null;
  prUrl: string | null;
  critical: boolean;
  money: boolean;
  note: string | null;
  needs: string[];
  live?: PrLive | null;
};
export type HubData = {
  built: string;
  roots: string[];
  projects: {
    name: string;
    dir: string;
    remote: string | null;
    plans: string[];
    looseDocs: Doc[];
  }[];
  plans: any[];
  cards: Card[];
  questions: any[];
  handoffDirs: string[];
  prChecked: string | null;
  prError: string | null;
};

function findHandoffDirs(dir: string, depth: number, acc: string[]) {
  if (depth < 0) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.name === ".claude") {
      const h = join(p, "handoffs");
      if (existsSync(h)) acc.push(h);
      continue;
    }
    if (e.name.startsWith(".") && e.name !== ".worktrees") continue;
    findHandoffDirs(p, depth - 1, acc);
  }
}

const remoteCache = new Map<string, string | null>();
const gitRemote = (cwd: string): string | null => {
  if (remoteCache.has(cwd)) return remoteCache.get(cwd)!;
  const r = Bun.spawnSync(["git", "-C", cwd, "remote", "get-url", "origin"]);
  const m =
    r.exitCode === 0
      ? r.stdout
          .toString()
          .trim()
          .match(/github\.com[:/](.+?)(\.git)?$/)
      : null;
  const url = m ? `https://github.com/${m[1]}` : null;
  remoteCache.set(cwd, url);
  return url;
};

// worktree paths map back to the repo they belong to
const projectRootOf = (handoffs: string) => {
  const repo = dirname(dirname(handoffs));
  const wt = repo.split("/.worktrees/");
  return {
    repo,
    project: basename(wt[0]),
    worktree: wt[1] ?? null,
    projectDir: wt[0],
  };
};

export async function collect(roots = DEFAULT_ROOTS): Promise<HubData> {
  const dirs: string[] = [];
  for (const r of roots) findHandoffDirs(r, 4, dirs);

  const plans: any[] = [];
  const cards: Card[] = [];
  const questions: any[] = [];
  const projects = new Map<string, HubData["projects"][number]>();

  for (const h of dirs) {
    const { repo, project, worktree, projectDir } = projectRootOf(h);
    const files = readdirSync(h);
    const planFiles = files.filter((f) => /\.plan\.(ya?ml|json)$/.test(f));
    if (!planFiles.length && !files.some((f) => f.endsWith(".html"))) continue;

    const remote = gitRemote(repo);
    const proj = projects.get(project) ?? {
      name: project,
      dir: projectDir.replace(HOME, "~"),
      remote,
      plans: [],
      looseDocs: [],
    };
    projects.set(project, proj);

    const docs: Doc[] = files
      .filter((f) => /\.(html|md)$/.test(f))
      .map((f) => {
        const p = join(h, f);
        return {
          name: f,
          path: p,
          kind: f.endsWith(".html") ? "html" : "md",
          mtime: statSync(p).mtime.toISOString(),
        } as Doc;
      });
    const claimed = new Set<string>();

    for (const pf of planFiles) {
      const path = join(h, pf);
      let plan: any;
      try {
        plan = Bun.YAML.parse(await Bun.file(path).text());
      } catch (e) {
        console.error(`skip ${path}: ${(e as Error).message}`);
        continue;
      }
      const m = plan.meta ?? {};
      const slug: string = m.slug ?? pf.replace(/\.plan\..+$/, "");
      const key = `${project}/${slug}`;
      const planDocs = docs.filter(
        (d) => d.name.startsWith(`${slug}-`) || d.name.startsWith(`${slug}.`),
      );
      planDocs.forEach((d) => claimed.add(d.name));
      const humanView = m.human_view ? join(repo, m.human_view) : null;
      const slices: any[] = plan.slices ?? [];
      const prUrl = (n: number | null | undefined) =>
        n && remote ? `${remote}/pull/${n}` : null;

      const updated = String(m.updated ?? statSync(path).mtime.toISOString());
      const existing = plans.findIndex((p) => p.key === key);
      if (existing >= 0 && plans[existing].updated >= updated) continue;
      if (existing >= 0) {
        plans.splice(existing, 1);
        for (let i = cards.length - 1; i >= 0; i--)
          if (`${cards[i].project}/${cards[i].plan}` === key)
            cards.splice(i, 1);
        for (let i = questions.length - 1; i >= 0; i--)
          if (questions[i].key === key) questions.splice(i, 1);
      }

      for (const s of slices) {
        cards.push({
          project,
          plan: slug,
          id: String(s.id),
          title: s.title ?? "",
          state: s.state ?? "todo",
          ticket: s.ticket ?? null,
          track: s.track ?? null,
          wave: s.wave ?? null,
          effort: s.effort ?? null,
          loc: s.loc ?? null,
          pr: s.pr ?? null,
          prUrl: prUrl(s.pr),
          critical: !!s.critical,
          money: !!s.money,
          note: s.note ?? null,
          needs: (s.needs ?? []).map(String),
        });
      }
      const openQs = (plan.open ?? []).filter(isOpen);
      const answersPath = answersPathFor(path, slug);
      const answers = latestAnswers(await readAnswers(answersPath));
      for (const q of openQs)
        questions.push({
          answer: answers.get(String(q.id)) ?? null,
          key,
          project,
          plan: slug,
          id: q.id,
          owner: q.owner ?? "?",
          title: q.title ?? null,
          ask: q.ask ?? "",
          blocks: q.blocks ?? [],
        });

      const story: any[] = plan.story ?? [];
      plans.push({
        key,
        project,
        slug,
        title: m.title ?? slug,
        parent: m.parent ?? null,
        mode: m.mode ?? null,
        updated,
        worktree,
        yaml: path,
        humanView: humanView && existsSync(humanView) ? humanView : null,
        published: m.published ?? null,
        pr: m.pr ?? null,
        prUrl: m.pr_url ?? prUrl(m.pr),
        states: slices.reduce(
          (a: Record<string, number>, s: any) => (
            (a[s.state ?? "todo"] = (a[s.state ?? "todo"] ?? 0) + 1), a
          ),
          {},
        ),
        slices: slices.length,
        decisions: (plan.decisions ?? []).filter(
          (d: any) => d.status !== "reverted",
        ).length,
        openQs: openQs.length,
        answered: openQs.filter((q: any) => answers.has(String(q.id))).length,
        answersPath,
        story: story.length
          ? {
              total: story.length,
              done: story.filter((c: any) => c.sha).length,
            }
          : null,
        spike: plan.spike
          ? { branch: plan.spike.branch ?? null, head: plan.spike.head ?? null }
          : null,
        docs: planDocs.sort((a, b) => a.name.localeCompare(b.name)),
        live: null,
      });
      proj.plans.push(key);
    }
    proj.looseDocs.push(
      ...docs.filter((d) => !claimed.has(d.name) && d.kind === "html"),
    );
  }

  plans.sort((a, b) => b.updated.localeCompare(a.updated));
  return {
    built: new Date().toISOString(),
    roots,
    projects: [...projects.values()],
    plans,
    cards,
    questions,
    handoffDirs: dirs,
    prChecked: null,
    prError: null,
  };
}

// One GraphQL call per repo. Returns "owner/name#n" → PrLive.
export async function fetchPrLive(data: HubData): Promise<Map<string, PrLive>> {
  const byRepo = new Map<string, Set<number>>();
  const add = (remote: string | null, n: number | null) => {
    if (!remote || !n) return;
    const slug = remote.replace("https://github.com/", "");
    (byRepo.get(slug) ?? byRepo.set(slug, new Set()).get(slug)!).add(n);
  };
  const remoteOf = (project: string) =>
    data.projects.find((p) => p.name === project)?.remote ?? null;
  for (const c of data.cards) add(remoteOf(c.project), c.pr);
  for (const p of data.plans) add(remoteOf(p.project), p.pr);

  const out = new Map<string, PrLive>();
  await Promise.all(
    [...byRepo].map(async ([slug, nums]) => {
      const [owner, name] = slug.split("/");
      const fields = [...nums]
        .map(
          (n) =>
            `p${n}: pullRequest(number: ${n}) { url state isDraft mergeStateStatus reviewDecision commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }`,
        )
        .join("\n");
      const query = `query { repository(owner: "${owner}", name: "${name}") { ${fields} } }`;
      const proc = Bun.spawn(["gh", "api", "graphql", "-f", `query=${query}`], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [text, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(
          `gh graphql ${slug}: ${err.trim() || text.slice(0, 200)}`,
        );
      }
      const repo = json.data?.repository ?? {};
      for (const n of nums) {
        const pr = repo[`p${n}`];
        if (!pr) continue;
        out.set(`${slug}#${n}`, {
          state: pr.state,
          draft: pr.isDraft,
          merge: pr.mergeStateStatus ?? null,
          review: pr.reviewDecision ?? null,
          checks:
            pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
          url: pr.url,
        });
      }
    }),
  );
  return out;
}

export function applyPrLive(
  data: HubData,
  live: Map<string, PrLive>,
  checked: string,
) {
  const slugOf = (project: string) =>
    data.projects
      .find((p) => p.name === project)
      ?.remote?.replace("https://github.com/", "") ?? null;
  for (const c of data.cards)
    c.live = c.pr ? (live.get(`${slugOf(c.project)}#${c.pr}`) ?? null) : null;
  for (const p of data.plans)
    p.live = p.pr ? (live.get(`${slugOf(p.project)}#${p.pr}`) ?? null) : null;
  data.prChecked = checked;
}

const TEMPLATE = join(import.meta.dir, "hub-template.html");
export async function render(data: HubData, opts: { served: boolean }) {
  const template = await Bun.file(TEMPLATE).text();
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return template
    .replace("/*__HUB_DATA__*/null", json)
    .replace("/*__HUB_SERVED__*/false", String(opts.served));
}

// Answers inbox: `<slug>.answers.yaml` next to the plan, append-only, one JSON flow mapping per line.
// The hub is its only writer; the orchestrator folds answers into plan.yaml (orchestrator-plan SKILL.md, "Answers inbox").
export type Answer = { q: string; answer: string; discuss: boolean; at: string; by: string };

export const isOpen = (q: any) => !q.status || !/resolved|closed|answered/i.test(q.status);
export const answersPathFor = (planPath: string, slug: string) => join(dirname(planPath), `${slug}.answers.yaml`);

export async function readAnswers(path: string): Promise<Answer[]> {
  const f = Bun.file(path);
  if (!(await f.exists())) return [];
  return (Bun.YAML.parse(await f.text()) as Answer[] | null) ?? [];
}

export const latestAnswers = (all: Answer[]) => {
  const m = new Map<string, Answer>();
  for (const a of all) if (!m.has(a.q) || m.get(a.q)!.at <= a.at) m.set(a.q, a);
  return m;
};

export async function appendAnswer(path: string, slug: string, a: Answer) {
  const f = Bun.file(path);
  const head = (await f.exists())
    ? await f.text()
    : `# Answers from the plan hub for ${slug}.plan.yaml. Append-only, latest per question wins.\n# Pending = the question is still open in the plan; the orchestrator folds it in (orchestrator-plan SKILL.md).\n`;
  await Bun.write(path, `${head}- ${JSON.stringify(a)}\n`);
}

// Answers whose question is still open in the plan: what an orchestrator has to fold in.
export async function pendingAnswers(planPath: string) {
  const plan = Bun.YAML.parse(await Bun.file(planPath).text()) as any;
  const slug = plan.meta?.slug ?? basename(planPath).replace(/\.plan\..+$/, "");
  const open = new Map((plan.open ?? []).filter(isOpen).map((q: any) => [String(q.id), q]));
  const latest = latestAnswers(await readAnswers(answersPathFor(planPath, slug)));
  return [...latest.values()].filter((a) => open.has(a.q)).map((a) => ({ ...a, question: open.get(a.q) }));
}
