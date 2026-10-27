#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import re
import shlex
import subprocess
import sys
import uuid
from pathlib import Path

STATE = Path("~/.local/state/angular-review/runs").expanduser()
COUNCIL = Path(__file__).resolve().parents[2] / "council" / "scripts" / "council.py"
DEFAULTS = {"claude": {"moderator": "opus", "members": ["sol", "opus"]},
            "codex": {"moderator": "sol", "members": ["sol", "opus"]}}
ESCALATED = ["opus@high", "astra"]
BUDGET = 150_000
SIZE_LINES, SIZE_FILES, ESCALATE_AT = 800, 25, 2

NOISE = re.compile(r"(^|/)(bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|openapi(\.pin)?\.json|routes\.oas\.json)$"
                   r"|__fixtures__/|(^|/)fixtures?/|\.snap$|(^|/)dist/|\.generated\.|(^|/)drizzle/meta/")
TEST = re.compile(r"\.(spec|test)\.[cm]?[jt]sx?$|(^|/)(test|tests|__tests__)/")
DOCS = re.compile(r"\.(mdx?|txt|rst)$")
PATH_SIGNALS = {
    "money/compliance/auth/crypto": re.compile(
        r"compliance|payment|payout|deposit|treasury|ledger|balance|transfer|rebalanc|withdraw|"
        r"auth|signer|signing|crypto|webhook|kyc|travel-rule|screening|allowlist", re.I),
    "migration/schema": re.compile(r"(^|/)(migrations?|drizzle)/|\.sql$|(^|/)db/.*schema", re.I),
    "public API/enum contract": re.compile(r"openapi|routes\.oas|\.dto\.ts$|enum|(^|/)packages/types/", re.I),
}
TEXT_SIGNALS = {
    "concurrency/transactions/idempotency": re.compile(
        r"\b(transaction|for update|forupdate|advisory|mutex|semaphore|idempoten\w*|lock(ed|ing|s)?|race)\b", re.I),
}
EFFORTS = {"low": "low", "medium": "medium", "med": "medium", "high": "high", "hi": "high"}

PASS_MODELS = {"opus": ("claude", "claude-opus-5-5"), "sol": ("codex", "gpt-6.1-sol"), "terra": ("codex", "gpt-5.6-terra")}
TIERS = {"light": {"claude": "opus@high", "codex": "terra@high"},
         "standard": {"claude": "opus@high", "codex": "sol@medium"},
         "heavy": {"claude": "opus@high", "codex": "sol@high"}}
LIGHT_SRC_LINES = 60


def sh(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True).stdout


def git(repo, *args):
    return sh(["git", "-C", str(repo), *args])


def classify(path):
    if NOISE.search(path):
        return "noise"
    if TEST.search(path):
        return "test"
    if DOCS.search(path):
        return "docs"
    return "src"


def parse_numstat(text):
    files = []
    for line in text.splitlines():
        added, removed, path = line.split("\t", 2)
        path = re.sub(r"\{[^{}]* => ([^{}]*)\}", r"\1", path).split(" => ")[-1].replace("//", "/")
        files.append({"path": path, "added": int(added) if added != "-" else 0,
                      "removed": int(removed) if removed != "-" else 0, "kind": classify(path)})
    return files


def assess(files, changed_src_text):
    src_lines = sum(f["added"] + f["removed"] for f in files if f["kind"] == "src")
    scoped = [f["path"] for f in files if f["kind"] in ("src", "noise")]
    signals = {}
    for name, pattern in PATH_SIGNALS.items():
        hits = [p for p in scoped if pattern.search(p)]
        if hits:
            signals[name] = hits[:5]
    for name, pattern in TEXT_SIGNALS.items():
        hits = sorted({m.group(0).lower() for m in pattern.finditer(changed_src_text)})
        if hits:
            signals[name] = hits[:8]
    if src_lines > SIZE_LINES or len(files) > SIZE_FILES:
        signals["size"] = [f"{src_lines} src lines, {len(files)} files"]
    return {"src_lines": src_lines, "files": len(files), "signals": signals,
            "score": len(signals), "escalate": len(signals) >= ESCALATE_AT}


def role_spec(value):
    alias, _, level = value.partition("@")
    if level and level.lower() not in EFFORTS:
        raise argparse.ArgumentTypeError(f"Bad effort in {value}: use low, medium, high")
    return alias, EFFORTS[level.lower()] if level else None


def pick_roster(host, assessment, members=None, no_escalate=False, moderator=None, overrides=()):
    mod_alias, mod_effort = role_spec(moderator) if moderator else (DEFAULTS[host]["moderator"], None)
    if members:
        chosen, reason = [role_spec(m) for m in members], "explicit --members"
    elif assessment["escalate"] and not no_escalate:
        chosen = [role_spec(m) for m in ESCALATED]
        reason = f"escalated: score {assessment['score']} >= {ESCALATE_AT} ({', '.join(assessment['signals'])})"
    else:
        chosen = [(m, None) for m in DEFAULTS[host]["members"]]
        reason = ("escalation suppressed by --no-escalate" if assessment["escalate"]
                  else f"default: score {assessment['score']} < {ESCALATE_AT}")
    by_alias = dict(role_spec(o) for o in overrides)
    moderator_role = {"role": "moderator", "model": mod_alias,
                      "effort": mod_effort or by_alias.get(mod_alias) or "medium"}
    reviewers = [{"role": f"reviewer-{i+1}", "model": alias, "effort": effort or by_alias.get(alias) or "medium"}
                 for i, (alias, effort) in enumerate(chosen)]
    return {"host": host, "reason": reason, "roles": [moderator_role, *reviewers]}


def pick_tier(assessment, forced=None):
    if forced:
        tier, reason = forced, "explicit --tier"
    elif assessment["escalate"]:
        tier, reason = "heavy", f"score {assessment['score']} >= {ESCALATE_AT} ({', '.join(assessment['signals'])})"
    elif assessment["score"] == 0 and assessment["src_lines"] <= LIGHT_SRC_LINES:
        tier, reason = "light", f"no risk signals, {assessment['src_lines']} src lines <= {LIGHT_SRC_LINES}"
    else:
        tier, reason = "standard", f"score {assessment['score']}, {assessment['src_lines']} src lines"
    passes = {}
    for side, spec in TIERS[tier].items():
        alias, effort = role_spec(spec)
        passes[side] = {"model": alias, "id": PASS_MODELS[alias][1], "effort": effort}
    return {"tier": tier, "reason": reason, "passes": passes}


def pass_command(side, p):
    if side == "codex":
        return (f"codex exec -s read-only -m {p['id']} -c model_reasoning_effort={p['effort']} "
                "--skip-git-repo-check - < <prompt-file>")
    return (f"claude -p --model {p['id']} --effort {p['effort']} --no-session-persistence "
            "--tools Read,Grep,Glob < <prompt-file>")


def triage(args):
    repo = Path(args.repo).expanduser().resolve()
    meta = resolve(repo, args.target, args.base, dry_run=True)
    files = parse_numstat(git(repo, "diff", "--numstat", "-M", meta["base"], meta["head"]))
    assessment = assess(files, changed_src_text(repo, meta["base"], meta["head"], files))
    decision = pick_tier(assessment, args.tier)
    print(f"Target: {args.target}  base {meta['base'][:12]} → head {meta['head'][:12]}")
    print(f"Tier: {decision['tier']} — {decision['reason']}")
    for side, p in decision["passes"].items():
        role = "host" if side == args.host else "counterpart"
        print(f"  {role:<11} {p['model']}@{p['effort']}  {pass_command(side, p)}")
    print(f"Assessment: {assessment['src_lines']} src lines, {assessment['files']} files, score {assessment['score']}")
    for name, hits in assessment["signals"].items():
        print(f"  - {name}: {', '.join(hits)}")


def default_base(repo):
    try:
        return git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").strip()
    except subprocess.CalledProcessError:
        return "origin/main"


def checkout(repo, name, head):
    tree = repo / ".worktrees" / name
    if not tree.exists():
        git(repo, "worktree", "add", "--detach", str(tree), head)
    elif git(tree, "rev-parse", "HEAD").strip() != head:
        if git(tree, "status", "--porcelain").strip():
            raise RuntimeError(f"{tree} is dirty and not at {head}; clean it or pass --dry-run")
        git(tree, "checkout", "--detach", head)
    return tree


def resolve(repo, target, base, dry_run):
    meta = {"target": target}
    if target.isdigit():
        pr = json.loads(sh(["gh", "pr", "view", target, "--json",
                            "number,title,body,url,headRefOid,headRefName,baseRefName"], cwd=repo))
        # Update the exact remote-tracking refs we resolve below. Fetching bare
        # source names updates only FETCH_HEAD and can leave origin/<base> stale.
        git(repo, "fetch", "origin",
            f"+refs/pull/{target}/head:refs/remotes/origin/pr/{target}",
            f"+refs/heads/{pr['baseRefName']}:refs/remotes/origin/{pr['baseRefName']}")
        head = pr["headRefOid"]
        base_ref = f"origin/{pr['baseRefName']}"
        name = f"pr-{target}"
        meta["pr"] = pr
    elif ".." in target:
        left, dots, right = re.split(r"(\.{2,3})", target, maxsplit=1)
        head = git(repo, "rev-parse", right or "HEAD").strip()
        base_ref = left
        name = "review-" + head[:12]
        meta["range_dots"] = dots
    else:
        head = git(repo, "rev-parse", target).strip()
        base_ref = base or default_base(repo)
        name = "review-" + re.sub(r"[^A-Za-z0-9._-]", "-", target)
    base_sha = (git(repo, "rev-parse", base_ref) if meta.get("range_dots") == ".."
                else git(repo, "merge-base", base_ref, head)).strip()
    current = git(repo, "rev-parse", "HEAD").strip()
    if dry_run:
        tree = None
    elif current == head and not git(repo, "status", "--porcelain", "--untracked-files=no").strip():
        tree = repo
    else:
        tree = checkout(repo, name, head)
    meta.update({"repo": str(repo), "worktree": str(tree) if tree else None,
                 "head": head, "base": base_sha, "base_ref": base_ref})
    return meta


def changed_src_text(repo, base, head, files):
    paths = [f["path"] for f in files if f["kind"] == "src"]
    if not paths:
        return ""
    diff = git(repo, "diff", "-U0", base, head, "--", *paths)
    return "\n".join(l[1:] for l in diff.splitlines()
                     if l[:1] in "+-" and not l.startswith(("+++", "---")))


def print_roster(roster, assessment):
    print(f"Roster ({roster['host']} host) — {roster['reason']}")
    for role in roster["roles"]:
        print(f"  {role['role']:<11} {role['model']:<6} @{role['effort']}")
    print(f"Assessment: {assessment['src_lines']} src lines, {assessment['files']} files, score {assessment['score']}")
    for name, hits in assessment["signals"].items():
        print(f"  - {name}: {', '.join(hits)}")


def prepare(args):
    repo = Path(args.repo).expanduser().resolve()
    meta = resolve(repo, args.target, args.base, args.dry_run)
    files = parse_numstat(git(repo, "diff", "--numstat", "-M", meta["base"], meta["head"]))
    assessment = assess(files, changed_src_text(repo, meta["base"], meta["head"], files))
    roster = pick_roster(args.host, assessment, args.members.split(",") if args.members else None,
                         args.no_escalate, args.moderator, args.role or ())
    run = STATE / (dt.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6])
    run.mkdir(parents=True, mode=0o700)
    tree = meta["worktree"]
    if tree and not args.no_install and tree != str(repo) and any((Path(tree) / f).exists() for f in ("bun.lock", "bun.lockb")):
        sh(["bun", "install"], cwd=tree)
    for name, data in (("target.json", meta), ("files.json", files),
                       ("assessment.json", assessment), ("roster.json", roster)):
        (run / name).write_text(json.dumps(data, indent=2) + "\n")
    print(f"Run: {run}")
    print(f"Target: {args.target}  base {meta['base'][:12]} → head {meta['head'][:12]}  worktree {tree or '(dry run, none)'}")
    print_roster(roster, assessment)


def optional(path):
    return Path(path).expanduser().read_text().strip() if path else ""


def build_brief(args):
    run = Path(args.run).expanduser().resolve()
    meta = json.loads((run / "target.json").read_text())
    files = json.loads((run / "files.json").read_text())
    roster = json.loads((run / "roster.json").read_text())
    repo, base, head = meta["repo"], meta["base"], meta["head"]
    pr = meta.get("pr") or {}
    parts = [
        "# Angular review brief\n",
        "## Objective\n\nAdversarial code review of the change below. Find real defects that would break correctness, "
        "money movement, compliance, security, data integrity, or public contracts. For every finding give: severity "
        "(Critical / High / Medium / Low), file:line, a concrete reachable failure scenario (inputs and state → wrong "
        "outcome), impact, fix, and verified-by (code in this packet / test evidence / unverified). Report a finding only "
        "when the scenario contradicts repository behavior, an explicit requirement, an ADR, or an authoritative external "
        "contract. An intentional documented policy choice is an assumption or evidence gap unless supported execution "
        "produces a concrete unsafe or incorrect outcome. Verify external semantics from primary documentation. Name "
        "load-bearing assumptions. Challenge supplied findings and author claims: confirm, refute, or mark unverified.\n",
        "## Constraints and non-goals\n\n- Tools are disabled; reason only from this packet. Missing evidence is an "
        "explicit gap, never an assumption.\n- Surgical scope: this diff and its direct consumers. No style nits, no "
        "generic advice, speculative possibilities, unsupported product requirements, or redesign beyond the change.\n"
        "- Critical/High are blocking. Medium/Low are non-blocking. REQUEST_CHANGES requires Critical or High.\n- Do not "
        "implement, post, or propose follow-up process.\n",
        f"## Repository\n\n- Repo: `{repo}`\n- Worktree: `{meta.get('worktree') or 'not checked out'}`\n"
        f"- Base: `{base}` ({meta['base_ref']})\n- Head: `{head}`\n"
        + (f"- PR: #{pr['number']} {pr['title']} — {pr['url']}\n" if pr else f"- Target: `{meta['target']}`\n"),
    ]
    if pr:
        body = "\n".join("> " + line for line in (pr.get("body") or "_empty PR description_").splitlines())
        parts.append(f"## Author claims (verify, don't trust)\n\n{body}\n")
    # Deliberately exclude host first-pass findings: proposal reviewers must not
    # be anchored by prior conclusions. The option remains parser-compatible
    # with older invocations but is not placed in the blind packet.
    for title, path in (("Test and typecheck results", args.tests),
                        ("Unchanged consumer excerpts", args.excerpts)):
        parts.append(f"## {title}\n\n{optional(path) or '_not supplied — treat as an evidence gap_'}\n")
    parts.append("## Changed files\n\n" + "\n".join(
        f"- `{f['path']}` +{f['added']} −{f['removed']} [{f['kind']}]" for f in files) + "\n")

    used = sum(map(len, parts))
    included, omitted = [], []
    order = {"src": 0, "docs": 1, "test": 2}
    for f in sorted((f for f in files if f["kind"] != "noise"), key=lambda f: order[f["kind"]]):
        diff = git(repo, "diff", "-M", base, head, "--", f["path"])
        block = f"### {f['path']}\n\n````diff\n{diff}````\n"
        if used + len(block) > BUDGET:
            omitted.append(f"`{f['path']}` ({f['kind']}, {len(diff)} chars)")
            continue
        included.append(block)
        used += len(block)
    parts.append("## Diff\n\nOrdered: source, then docs, then tests. Generated files, lockfiles and fixtures "
                 "are excluded.\n\n" + "\n".join(included))
    if omitted:
        parts.append("## Omitted for size (evidence gap)\n\n" + "\n".join(f"- {o}" for o in omitted) + "\n")
    brief = "\n".join(parts)
    (run / "brief.md").write_text(brief)

    council = ["python3", str(COUNCIL), "start", "--brief", str(run / "brief.md"),
               "--rounds", "2", "--no-grill"]
    for role in roster["roles"]:
        flag = "--moderator" if role["role"] == "moderator" else "--member"
        council += [flag, f"{role['model']}@{role['effort']}"]
    (run / "council-command.txt").write_text(shlex.join(council) + "\n")
    print(f"Brief: {run / 'brief.md'}  ({len(brief)} chars, ~{len(brief.split())} words, "
          f"{len(included)} diffs, {len(omitted)} omitted)")
    print(f"Council: {shlex.join(council)}")


def main():
    parser = argparse.ArgumentParser(prog="angular_review")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("target", help="PR number, branch, or base..head range")
    p.add_argument("--host", choices=DEFAULTS, required=True)
    p.add_argument("--repo", default=".")
    p.add_argument("--base", help="Base ref for branch targets (default origin/HEAD)")
    p.add_argument("--members", help="Comma list overriding reviewers, e.g. opus@high,astra")
    p.add_argument("--moderator", help="Moderator alias, optionally @effort")
    p.add_argument("--role", action="append", help="alias@effort override for any role using that alias")
    p.add_argument("--no-escalate", action="store_true")
    p.add_argument("--no-install", action="store_true")
    p.add_argument("--dry-run", action="store_true", help="Fetch and assess only; no worktree or install")
    p.set_defaults(func=prepare)
    t = sub.add_parser("triage")
    t.add_argument("target", help="PR number, branch, or base..head range")
    t.add_argument("--host", choices=DEFAULTS, required=True)
    t.add_argument("--repo", default=".")
    t.add_argument("--base", help="Base ref for branch targets (default origin/HEAD)")
    t.add_argument("--tier", choices=TIERS)
    t.set_defaults(func=triage)
    b = sub.add_parser("brief")
    b.add_argument("run")
    b.add_argument("--first-pass")
    b.add_argument("--tests")
    b.add_argument("--excerpts")
    b.set_defaults(func=build_brief)
    args = parser.parse_args()
    try:
        args.func(args)
    except subprocess.CalledProcessError as error:
        sys.exit(f"{shlex.join(error.cmd)} failed: {error.stderr.strip()}")
    except (RuntimeError, argparse.ArgumentTypeError) as error:
        sys.exit(str(error))


if __name__ == "__main__":
    main()
