#!/usr/bin/env bash
# Budget: 2 processes per render (one subshell + one jq). Renders fire per-session
# several times a second across many sessions; every extra $(...) is a fork storm.
# Keep all string/date/branch work in builtins or fold it into the single jq pass.

IFS= read -r -d '' input

read -r -d '' JQ <<'JQPROG'
def commafy: tostring | if length > 3 then (.[0:length-3] | commafy) + "," + .[length-3:] else . end;
def fmtreset: if . <= 0 then "0m"
  elif . >= 3600 then "\(. / 3600 | floor)h\((. % 3600) / 60 | floor)m"
  elif . >= 60 then "\(. / 60 | floor)m"
  else "\(.)s" end;

. as $in
| ($in.model.display_name // ""
   | sub("Opus"; "O") | sub("Sonnet"; "S") | sub("Haiku"; "H")
   | sub(" +(?<d>[0-9])"; .d)
   | sub(" *\\((?<m>[0-9]+M)[^)]*\\)"; "(\(.m))")) as $model0
| ($in.effort.level // "") as $ef
| ({"low": "lw", "medium": "md", "high": "hi", "xhigh": "xhi", "max": "mx"}[$ef] // $ef) as $efs
| (if $model0 == "" then ""
   elif $efs == "" then $model0
   else $model0 + " " + $efs end) as $model
| (($in.context_window.current_usage // {}) as $u
   | ($u.input_tokens // 0) + ($u.cache_creation_input_tokens // 0)
     + ($u.cache_read_input_tokens // 0) + ($u.output_tokens // 0)) as $tk
| (if $tk > 0 then ($tk | commafy) else "" end) as $tks
| ($in.context_window.used_percentage // null) as $up
| (if $up == null then "" else "\($up | round)" end) as $ctx
| ($in.rate_limits.five_hour.used_percentage // null) as $fp
| ($in.rate_limits.five_hour.resets_at // null) as $fr
| (if $fp == null then ""
   else "5h:\($fp | round)%"
        + (if $fr == null then "" else "/" + (($fr - now) | floor | fmtreset) end)
   end) as $lim
| (($in.session_id // "")[0:8]) as $sid
| [($in.workspace.current_dir // $in.cwd // ""), $model, $tks, $ctx, $lim, $sid]
| join("\u001f")
JQPROG

fields=$(jq -r "$JQ" <<<"$input" 2>/dev/null)

# \037 not tab: whitespace IFS collapses runs, which would shift empty fields.
IFS=$'\037' read -r cwd model tokens ctx limits sid <<<"$fields"

dir="${cwd##*/}"

# Resolve branch by reading .git/HEAD directly; `git` here costs a fork per render.
branch=""
gitdir=""
d="$cwd"
while [ -n "$d" ] && [ "$d" != "/" ]; do
  if [ -d "$d/.git" ]; then
    gitdir="$d/.git"
    break
  fi
  if [ -f "$d/.git" ]; then
    # worktree/submodule: ".git" is a file holding "gitdir: <path>"
    read -r ln <"$d/.git" || ln=""
    ln="${ln#gitdir: }"
    case "$ln" in
      /*) gitdir="$ln" ;;
      *) gitdir="$d/$ln" ;;
    esac
    break
  fi
  d="${d%/*}"
done

if [ -n "$gitdir" ] && [ -r "$gitdir/HEAD" ]; then
  read -r head <"$gitdir/HEAD" || head=""
  case "$head" in
    "ref: refs/heads/"*) branch="${head#ref: refs/heads/}" ;;
    "") ;;
    *) branch="${head:0:7}" ;;
  esac
fi

esc=$'\033'
cyan="${esc}[0;36m"
red="${esc}[0;31m"
yellow="${esc}[0;33m"
green="${esc}[0;32m"
magenta="${esc}[0;35m"
dim="${esc}[2m"
reset="${esc}[0m"
sep="${dim} | ${reset}"

out="${cyan}${dir}${reset}"
[ -n "$branch" ] && out+="${dim}@${reset}${red}${branch}${reset}"
[ -n "$model" ] && out+="${sep}${yellow}${model}${reset}"
[ -n "$tokens" ] && out+="${sep}${green}tks: ${tokens}${reset}"
[ -n "$ctx" ] && out+="${sep}${magenta}ctx: ${ctx}%${reset}"
[ -n "$limits" ] && out+="${sep}${red}${limits}${reset}"
case "${WEZTERM_PANE:-}" in
  *[!0-9]*|"") ;;
  *) out+="${sep}${dim}pane: ${WEZTERM_PANE}${reset}" ;;
esac
[ -n "$sid" ] && out+="${sep}${dim}${sid}${reset}"

printf '%s\n' "$out"
