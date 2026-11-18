#!/bin/sh
# mnemostxt release, start to finish, on the release machine:
#
#   sh scripts/release.sh            next patch version (0.0.2 -> 0.0.3)
#   sh scripts/release.sh minor      0.0.2 -> 0.1.0
#   sh scripts/release.sh major      0.0.2 -> 1.0.0
#   sh scripts/release.sh 0.2.0      an exact version
#
# Options: --dry-run (only the checks), --yes (no questions), --no-deploy,
#          --no-wait (push the tag, do not wait for the build),
#          --continue (a release that stopped after its tag: wait for its
#          build, check it, deploy; nothing is bumped or tagged again).
#
# What it does, stopping at the first problem:
#   1. pre-flight: tools, token, on main, clean, up to date, CHANGELOG "Unreleased"
#      filled in, version files agree, nothing private in the repo
#   2. bump: VERSION, package.json/-lock, Cargo.toml/.lock, tauri.conf.json;
#      CHANGELOG "Unreleased" becomes "[X.Y.Z] - today"
#   3. commit and push main, wait for its check pipeline to pass
#   4. tag vX.Y.Z and push it, wait for the release pipeline (deb, exe, apk);
#      every GitLab job is shown as it starts and ends, and the release
#      build's own steps as they finish
#   A push that reaches GitLab but not another push address (a mirror that is
#   down) is a warning, not a stop: push again later with git push origin.
#   5. post-release: the GitLab release exists with its files, the permanent
#      download links answer
#   6. deploy the web app with scripts/deploy.sh: built while the old one
#      serves, replaced in seconds, put back if the new one does not answer
#   7. a status report
#
# Settings: scripts/release.conf (in git) and ~/.config/mnemostxt/release.env
# (yours: GITLAB_TOKEN with read_api, DEPLOY_DIR, HEALTH_URL). docs/RELEASING.md
# has the details.
set -eu
cd "$(dirname "$0")/.."
ROOT=$(pwd)

# ── output helpers ──────────────────────────────────────────────────────────
if [ -t 1 ]; then B=$(printf '\033[1m'); G=$(printf '\033[32m'); R=$(printf '\033[31m'); Y=$(printf '\033[33m'); D=$(printf '\033[2m'); N=$(printf '\033[0m'); else B= G= R= Y= D= N=; fi
REPORT=""
START=$(date +%s)
step() { printf '\n%s▸ %s%s\n' "$B" "$1" "$N"; }
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$1"; REPORT="$REPORT
✓ $1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$1"; REPORT="$REPORT
! $1"; }
note() { printf '  %s%s%s\n' "$D" "$1" "$N"; }
fail() {
  printf '  %s✗ %s%s\n' "$R" "$1" "$N"
  REPORT="$REPORT
✗ $1"
  report
  exit 1
}
report() {
  printf '\n%s── status ──────────────────────────────────────────%s%s\n' "$B" "$N" "$REPORT"
  printf '\n%s(%s min)%s\n' "$D" "$(( ($(date +%s) - START + 59) / 60 ))" "$N"
}

# ── arguments ───────────────────────────────────────────────────────────────
BUMP=patch DRY=0 YES=0 DEPLOY=1 WAIT=1 CONT=0
for a in "$@"; do
  case "$a" in
    patch|minor|major) BUMP=$a ;;
    [0-9]*.[0-9]*.[0-9]*) BUMP=$a ;;
    --dry-run) DRY=1 ;;
    --yes|-y) YES=1 ;;
    --no-deploy) DEPLOY=0 ;;
    --no-wait) WAIT=0 ;;
    --continue) CONT=1 ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a (see --help)"; exit 2 ;;
  esac
done

# ── settings ────────────────────────────────────────────────────────────────
. "$ROOT/scripts/release.conf"
PRIVATE_ENV=${MNEMOSTXT_RELEASE_ENV:-$HOME/.config/mnemostxt/release.env}
if [ -f "$PRIVATE_ENV" ]; then
  perm=$(stat -c %a "$PRIVATE_ENV" 2>/dev/null || echo 600)
  case "$perm" in 600|400) ;; *) echo "${Y}! $PRIVATE_ENV is readable by others (chmod 600 it)$N" ;; esac
  . "$PRIVATE_ENV"
fi
GITLAB_TOKEN=${GITLAB_TOKEN:-}
RELEASE_JOB=${RELEASE_JOB:-release-files}   # its log lines are shown while it runs
API="$GITLAB_URL/api/v4/projects/$(printf '%s' "$GITLAB_PROJECT" | sed 's|/|%2F|g')"
WEB="$GITLAB_URL/$GITLAB_PROJECT"

# GitLab API GET -> stdout (JSON). Never prints the token.
api() { curl -gfsS --retry 2 -H "PRIVATE-TOKEN: $GITLAB_TOKEN" "$API$1"; }
# json EXPR: reads JSON on stdin, prints the Python expression over it (j)
json() { python3 -c "import json,sys; j=json.load(sys.stdin); v=($1); print('' if v is None else v)"; }

# ── 1. pre-flight ───────────────────────────────────────────────────────────
step "Pre-flight checks"
for t in git curl python3 sed awk; do command -v "$t" >/dev/null || fail "$t is not installed"; done
ok "tools: git, curl, python3"
[ -n "$GITLAB_TOKEN" ] || fail "no GITLAB_TOKEN — put it in $PRIVATE_ENV (a personal access token with read_api)"
name=$(api "" | json "j['path_with_namespace']") || fail "GitLab refused the token or the project $GITLAB_PROJECT"
ok "GitLab: $name"

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "$MAIN_BRANCH" ] || fail "on branch '$branch' — switch to $MAIN_BRANCH"
[ -z "$(git status --porcelain)" ] || fail "uncommitted changes — commit or stash them (git status)"
# local tags follow GitLab's (a re-pushed tag would otherwise stop the fetch)
if ! out=$(git fetch origin "$MAIN_BRANCH" --tags --force 2>&1); then
  printf '%s\n' "$out" | sed 's/^/    /'
  fail "git fetch failed (message above)"
fi
behind=$(git rev-list --count "HEAD..origin/$MAIN_BRANCH")
[ "$behind" -eq 0 ] || fail "$behind commit(s) behind origin/$MAIN_BRANCH — git pull first"
ahead=$(git rev-list --count "origin/$MAIN_BRANCH..HEAD")
ok "on $MAIN_BRANCH, clean, up to date ($ahead local commit(s) to push)"

sh scripts/check-version.sh >/dev/null || fail "version files disagree (sh scripts/check-version.sh)"
OLD=$(tr -d ' \n\r' < VERSION)
if [ "$CONT" = 1 ]; then
  NEW=$OLD
  git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null || fail "--continue: there is no tag v$NEW (VERSION is $NEW)"
  [ "$(git rev-parse "v$NEW^{commit}")" = "$(git rev-parse HEAD)" ] || fail "--continue: HEAD is not at v$NEW (git log --oneline -3)"
  ok "continuing the release of $NEW (tag v$NEW, nothing is bumped)"
else
case "$BUMP" in
  patch|minor|major) NEW=$(echo "$OLD" | awk -F. -v b="$BUMP" '{ if (b=="major") print $1+1".0.0"; else if (b=="minor") print $1"."$2+1".0"; else print $1"."$2"."$3+1 }') ;;
  *) NEW=$BUMP ;;
esac
echo "$NEW" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "'$NEW' is not X.Y.Z"
[ "$NEW" != "$OLD" ] || fail "$NEW is the current version"
git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null && fail "tag v$NEW already exists"
ok "version $OLD → $NEW"

unreleased=$(awk '/^## \[Unreleased\]/{on=1;next} /^## /{on=0} on' CHANGELOG.md | grep -c '^[-*] ' || true)
[ "$unreleased" -gt 0 ] || fail "CHANGELOG.md: the [Unreleased] section has no entries — write what changed first"
ok "CHANGELOG: $unreleased entries under [Unreleased]"
fi

sh scripts/check-public.sh >/dev/null || fail "check-public found something private (run sh scripts/check-public.sh)"
ok "no secrets or private words in the repo"

running=$(api "/pipelines?ref=$MAIN_BRANCH&status=running&per_page=1" | json "len(j)")
[ "$running" = 0 ] || warn "a pipeline is already running on $MAIN_BRANCH"

if [ "$DEPLOY" = 1 ] && [ -n "$DEPLOY_DIR" ]; then
  [ -f "$DEPLOY_DIR/docker-compose.yml" ] || fail "DEPLOY_DIR=$DEPLOY_DIR has no docker-compose.yml"
  command -v docker >/dev/null || fail "docker is not installed (needed to deploy; or use --no-deploy)"
  ok "deploy target: $DEPLOY_DIR ($WEB_SERVICE)"
  if docker buildx inspect "$WEB_BUILDER" >/dev/null 2>&1; then
    ok "web image is built in $WEB_BUILDER (memory-capped)"
  else
    warn "no image builder $WEB_BUILDER (gtlbrunner: ./build.sh -limits): the web image build is not memory-capped"
  fi
elif [ "$DEPLOY" = 1 ]; then
  warn "DEPLOY_DIR is not set: the web app will not be deployed"
  DEPLOY=0
fi

if [ "$DRY" = 1 ]; then ok "dry run: nothing changed"; report; exit 0; fi
if [ "$YES" != 1 ]; then
  if [ "$CONT" = 1 ]; then what="wait for the build, check$([ "$DEPLOY" = 1 ] && echo ', deploy')"; else what="commit, push, tag, build$([ "$DEPLOY" = 1 ] && echo ', deploy')"; fi
  printf '\n%sRelease mnemostxt %s (%s)? [y/N] %s' "$B" "$NEW" "$what" "$N"
  read -r answer
  case "$answer" in y|Y|yes) ;; *) echo "Nothing done."; exit 0 ;; esac
fi

# ── GitLab helpers ──────────────────────────────────────────────────────────
# push_ref REF WHAT CHECK: pushes REF to every push remote. A remote with
# several push addresses may fail on one (a mirror that is down): then CHECK
# (a GitLab API path) decides; if GitLab has it, that is a warning, not a stop.
push_ref() {
  ref=$1 what=$2 check=$3
  for r in $PUSH_REMOTES; do
    if out=$(git push -q "$r" "$ref" 2>&1); then continue; fi
    printf '%s\n' "$out" | sed 's/^/    /'
    if api "$check" >/dev/null 2>&1; then
      warn "GitLab has $what, another push address of '$r' failed (above): later, git push $r ${4:-$ref}"
    else
      fail "git push $r $ref failed, and GitLab does not have $what"
    fi
  done
}

# wait_pipeline REF SHA LABEL: polls until the pipeline for SHA on REF ends.
# Shows each job as it starts and ends, and the release job's steps.
wait_pipeline() {
  ref=$1 sha=$2 label=$3 deadline=$(( $(date +%s) + PIPELINE_TIMEOUT_MIN * 60 )) id=""
  while [ -z "$id" ]; do
    id=$(api "/pipelines?ref=$ref&sha=$sha&per_page=1" | json "j[0]['id'] if j else None") || true
    [ -n "$id" ] && break
    [ "$(date +%s)" -lt "$deadline" ] || fail "$label: no pipeline appeared"
    sleep 5
  done
  note "$label: $WEB/-/pipelines/$id"
  seen=$(mktemp) shown=$(mktemp)
  while :; do
    st=$(api "/pipelines/$id" | json "j['status']") || st=unknown
    # one line per job whose status changed: "HH:MM  name  status  (time)  url"
    api "/pipelines/$id/jobs?per_page=100&include_retried=false" 2>/dev/null | python3 -c '
import json, sys, time
seen_file = sys.argv[1]
jobs = sorted(json.load(sys.stdin), key=lambda x: x["id"])
seen = dict(l.rstrip("\n").split(" ", 1) for l in open(seen_file) if " " in l)
out = []
icon = {"success": "✓", "failed": "✗", "canceled": "✗", "running": "▸", "pending": "…", "created": "·", "manual": "·", "skipped": "-"}
for j in jobs:
    key, st = str(j["id"]), j["status"]
    if seen.get(key) == st:
        continue
    seen[key] = st
    if st in ("created", "pending") :
        continue
    d = j.get("duration")
    dur = "%dm %02ds" % (int(d) // 60, int(d) % 60) if d else ""
    allowed = st == "failed" and j.get("allow_failure")
    line = "%s %s %-14s %s%s %s" % (time.strftime("%H:%M"), icon.get(st, "?"), j["name"], st, " (allowed to fail)" if allowed else "", dur)
    if st == "running" or (st == "failed" and not allowed):
        line = line.rstrip() + "  " + j["web_url"]
    out.append(line.rstrip())
open(seen_file, "w").write("".join(f"{k} {v}\n" for k, v in seen.items()))
print("\n".join(out))
' "$seen" | while IFS= read -r line; do if [ -n "$line" ]; then note "$line"; fi; done
    # the release job: its own steps as they finish (✓ Linux .deb 3m 53s …)
    rj=$(api "/pipelines/$id/jobs?per_page=100" 2>/dev/null | json "next((x['id'] for x in j if x['name'] == '$RELEASE_JOB' and x['status'] in ('running', 'success', 'failed')), None)") || rj=""
    if [ -n "$rj" ]; then
      api "/jobs/$rj/trace" 2>/dev/null | sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r$//; s/^[0-9T:.Z-]* [0-9A-Z+]* //' \
        | grep -E '^(limits:|✓ |✗ |! )' | while IFS= read -r line; do
            grep -qxF "$line" "$shown" || { printf '%s\n' "$line" >> "$shown"; note "    $RELEASE_JOB: $line"; }
          done
    fi
    case "$st" in
      success) rm -f "$seen" "$shown"; ok "$label passed"; return 0 ;;
      failed|canceled|skipped)
        rm -f "$seen" "$shown"
        bad=$(api "/pipelines/$id/jobs?scope[]=failed" | json "', '.join(f\"{x['name']} ({x['web_url']})\" for x in j if not x.get('allow_failure'))") || bad=""
        fail "$label $st${bad:+: $bad}" ;;
    esac
    [ "$(date +%s)" -lt "$deadline" ] || { rm -f "$seen" "$shown"; fail "$label still '$st' after $PIPELINE_TIMEOUT_MIN min — see $WEB/-/pipelines/$id"; }
    sleep "$POLL_SECONDS"
  done
}

if [ "$CONT" = 0 ]; then
# ── 2. bump ─────────────────────────────────────────────────────────────────
step "Version $NEW"
TODAY=$(date +%F)
python3 - "$NEW" "$TODAY" "$WEB" <<'PY' || fail "could not update the version files"
import json, re, sys
new, today, web = sys.argv[1:4]

def sub(path, pattern, repl, count=1):
    s = open(path, encoding="utf-8").read()
    s2, n = re.subn(pattern, repl, s, count=count, flags=re.M)
    if not n:
        sys.exit(f"{path}: version line not found")
    open(path, "w", encoding="utf-8").write(s2)

open("VERSION", "w").write(new + "\n")
sub("frontend/package.json", r'^(  "version": )"[^"]*"', rf'\1"{new}"')
sub("app/tauri.conf.json", r'^(  "version": )"[^"]*"', rf'\1"{new}"')
sub("app/Cargo.toml", r'^version = "[^"]*"', f'version = "{new}"')
sub("app/Cargo.lock", r'(name = "mnemostxt"\nversion = )"[^"]*"', rf'\1"{new}"')
lock = json.load(open("frontend/package-lock.json", encoding="utf-8"))
lock["version"] = new
lock["packages"][""]["version"] = new
open("frontend/package-lock.json", "w", encoding="utf-8").write(json.dumps(lock, indent=2, ensure_ascii=False) + "\n")

# Keep a Changelog: [Unreleased] -> [new] - today, a fresh [Unreleased] above it,
# and the compare links at the bottom.
c = open("CHANGELOG.md", encoding="utf-8").read()
c = c.replace("## [Unreleased]", f"## [Unreleased]\n\n## [{new}] - {today}", 1)
prev = re.findall(r"^## \[(\d+\.\d+\.\d+)\]", c, flags=re.M)
older = prev[1] if len(prev) > 1 else None
links = re.sub(r"^\[Unreleased\]: .*$", f"[Unreleased]: {web}/-/compare/v{new}...main", c, flags=re.M)
if links == c:
    links = c.rstrip("\n") + f"\n\n[Unreleased]: {web}/-/compare/v{new}...main\n"
line = f"[{new}]: {web}/-/compare/v{older}...v{new}" if older else f"[{new}]: {web}/-/releases/v{new}"
links = re.sub(r"^(\[Unreleased\]: .*)$", lambda m: m.group(1) + "\n" + line, links, count=1, flags=re.M)
open("CHANGELOG.md", "w", encoding="utf-8").write(links)
PY
sh scripts/check-version.sh "v$NEW" >/dev/null || fail "version files disagree after the bump"
ok "VERSION, package.json, package-lock.json, Cargo.toml, Cargo.lock, tauri.conf.json → $NEW"
ok "CHANGELOG: [Unreleased] → [$NEW] - $TODAY"

# ── 3. commit, push main, wait for the checks ───────────────────────────────
step "Commit and push $MAIN_BRANCH"
git add VERSION CHANGELOG.md frontend/package.json frontend/package-lock.json app/Cargo.toml app/Cargo.lock app/tauri.conf.json
git commit -q -m "release: mnemostxt $NEW" || fail "git commit failed"
SHA=$(git rev-parse HEAD)
push_ref "HEAD:$MAIN_BRANCH" "commit $(git rev-parse --short HEAD)" "/repository/commits/$SHA" "$MAIN_BRANCH"
ok "pushed $(git rev-parse --short HEAD) to $PUSH_REMOTES"

step "Checks on $MAIN_BRANCH"
wait_pipeline "$MAIN_BRANCH" "$SHA" "check pipeline"

# ── 4. tag, wait for the release build ──────────────────────────────────────
step "Tag v$NEW"
notes=$(awk -v v="$NEW" '$0 ~ "^## \\["v"\\]" {on=1; next} /^## / {on=0} on' CHANGELOG.md | sed '/^\[.*\]: /d')
git tag -a "v$NEW" -m "mnemostxt $NEW

$notes" || fail "git tag failed"
push_ref "v$NEW" "tag v$NEW" "/repository/tags/v$NEW"
ok "pushed tag v$NEW"
else
  SHA=$(git rev-parse HEAD)
fi

if [ "$WAIT" = 0 ]; then
  warn "not waiting for the build (--no-wait): $WEB/-/pipelines?ref=v$NEW"
  report; exit 0
fi
step "Release build (deb, exe, apk)"
wait_pipeline "v$NEW" "$SHA" "release pipeline"

# ── 5. post-release checks ──────────────────────────────────────────────────
step "Release on GitLab"
rel=$(api "/releases/v$NEW") || fail "release v$NEW not found on GitLab"
assets=$(printf '%s' "$rel" | json "len(j['assets']['links'])")
[ "$assets" -ge 4 ] || fail "release v$NEW has $assets file links, expected 4"
ok "release v$NEW with $assets files: $WEB/-/releases/v$NEW"
for f in $PERMALINKS; do
  url="$WEB/-/releases/permalink/latest/downloads/$f"
  code=$(curl -s -o /dev/null -L -r 0-0 -w '%{http_code}' "$url")
  case "$code" in 200|206) ok "download link answers: $f" ;; *) fail "download link $f answered HTTP $code ($url)" ;; esac
done

# ── 6. deploy the web app ───────────────────────────────────────────────────
if [ "$DEPLOY" = 1 ]; then
  if [ "$(cd "$DEPLOY_DIR" && git rev-parse --show-toplevel 2>/dev/null)" != "$ROOT" ] && [ -d "$DEPLOY_DIR/.git" ]; then
    (cd "$DEPLOY_DIR" && git fetch -q --tags && git checkout -q "v$NEW") || fail "could not check out v$NEW in $DEPLOY_DIR"
    ok "$DEPLOY_DIR at v$NEW"
  fi
  sh "$ROOT/scripts/deploy.sh" || fail "deploy failed (above); the release itself is done. Again: sh scripts/deploy.sh"
  ok "web app deployed"
fi

# ── 7. report ───────────────────────────────────────────────────────────────
ok "mnemostxt $NEW released"
report
printf '\n  release   %s/-/releases/v%s\n  Android   %s/-/releases/permalink/latest/downloads/mnemostxt.apk\n  Windows   %s/-/releases/permalink/latest/downloads/mnemostxt-setup.exe\n  Linux     %s/-/releases/permalink/latest/downloads/mnemostxt.deb\n' "$WEB" "$NEW" "$WEB" "$WEB" "$WEB"
