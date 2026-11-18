#!/bin/sh
# Deploys the mnemostxt web app safely, from DEPLOY_DIR (release.env):
#
#   sh scripts/deploy.sh              the version checked out there
#   sh scripts/deploy.sh --check      only the checks, changes nothing
#
# 1. waits while a release build runs on this machine (never two at once)
# 2. builds the new image while the old container keeps serving (in
#    gtlbrunner's capped builder when it is there)
# 3. keeps the running image as mnemostxt:previous
# 4. replaces the container (a few seconds) and waits until it answers
# 5. not answering within 90 s: the previous image is put back, then an error
#
# release.sh runs this after a release; run it by hand to deploy again.
set -eu
cd "$(dirname "$0")/.."
ROOT=$(pwd)

if [ -t 1 ]; then B=$(printf '\033[1m'); G=$(printf '\033[32m'); R=$(printf '\033[31m'); Y=$(printf '\033[33m'); D=$(printf '\033[2m'); N=$(printf '\033[0m'); else B= G= R= Y= D= N=; fi
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$1"; }
note() { printf '  %s%s%s\n' "$D" "$1" "$N"; }
fail() { printf '  %s✗ %s%s\n' "$R" "$1" "$N"; exit 1; }

CHECK=0
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a (see --help)"; exit 2 ;;
  esac
done

# ── settings (same files as release.sh) ─────────────────────────────────────
. "$ROOT/scripts/release.conf"
PRIVATE_ENV=${MNEMOSTXT_RELEASE_ENV:-$HOME/.config/mnemostxt/release.env}
[ -f "$PRIVATE_ENV" ] && . "$PRIVATE_ENV"
DEPLOY_WAIT_JOBS_MIN=${DEPLOY_WAIT_JOBS_MIN:-60}   # longest wait for a running GitLab job
DEPLOY_HEALTH_SEC=${DEPLOY_HEALTH_SEC:-90}         # the new container must answer within this
[ -n "$DEPLOY_DIR" ] || fail "DEPLOY_DIR is not set (in $PRIVATE_ENV)"
[ -f "$DEPLOY_DIR/docker-compose.yml" ] || fail "DEPLOY_DIR=$DEPLOY_DIR has no docker-compose.yml"
command -v docker >/dev/null || fail "docker is not installed"
VER=$(tr -d ' \n\r' < "$DEPLOY_DIR/VERSION")
SVC=$WEB_SERVICE

printf '\n%s▸ Deploy mnemostxt %s (web)%s\n' "$B" "$VER" "$N"
note "folder     $DEPLOY_DIR"
note "service    $SVC"

# the running container, if any: its image is the way back
PREV_ID=$(docker inspect -f '{{.Image}}' "$SVC" 2>/dev/null || true)
IMG=$(cd "$DEPLOY_DIR" && docker compose config --images "$SVC" 2>/dev/null | head -1)
[ -n "$IMG" ] || fail "docker compose config does not name an image for $SVC"
if [ -n "$PREV_ID" ]; then
  ok "running now: $(docker inspect -f '{{.Config.Image}}' "$SVC") ($(printf '%s' "$PREV_ID" | cut -c8-19))"
else
  warn "no running $SVC container: first deploy, nothing to go back to"
fi

build_args=build
if docker buildx inspect "$WEB_BUILDER" >/dev/null 2>&1; then
  build_args="build --builder $WEB_BUILDER"
  ok "image built in $WEB_BUILDER (capped)"
else
  warn "no builder $WEB_BUILDER: the image build is not capped (gtlbrunner: ./build.sh -limits)"
fi
[ "$CHECK" = 1 ] && { ok "check only: nothing changed"; exit 0; }

# ── 1. one heavy build at a time ────────────────────────────────────────────
deadline=$(( $(date +%s) + DEPLOY_WAIT_JOBS_MIN * 60 ))
# GitLab job containers (runner-…) and local release builds (…-builder images)
busy() { docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -Eq '^runner-| [^ ]*-builder:'; }
while busy; do
  [ "$(date +%s)" -lt "$deadline" ] || fail "a build is still running here after $DEPLOY_WAIT_JOBS_MIN min (docker ps)"
  note "$(date +%H:%M) a build is running on this machine: waiting"
  sleep 30
done

# ── 2. build while the old container serves ─────────────────────────────────
start=$(date +%s)
log="$ROOT/.deploy-build.log"
# shellcheck disable=SC2086
(cd "$DEPLOY_DIR" && docker compose $build_args "$SVC") >"$log" 2>&1 \
  || { tail -20 "$log" | sed 's/^/    /'; fail "image build failed (whole log: $log); the old container still serves"; }
NEW_ID=$(docker image inspect -f '{{.Id}}' "$IMG" 2>/dev/null || true)
[ -n "$NEW_ID" ] || fail "the build made no image $IMG (log: $log)"
ok "image built ($(( $(date +%s) - start ))s), the old container served meanwhile"
rm -f "$log"

if [ -n "$PREV_ID" ] && [ "$NEW_ID" = "$PREV_ID" ]; then
  ok "same image as the running one: nothing to replace"
  exit 0
fi

# ── 3. the way back ─────────────────────────────────────────────────────────
[ -n "$PREV_ID" ] && docker image tag "$PREV_ID" "${IMG%%:*}:previous" && ok "kept the old image as ${IMG%%:*}:previous"

# ── 4. replace, then wait until it answers ──────────────────────────────────
healthy() {
  [ "$(docker inspect -f '{{.State.Running}}' "$SVC" 2>/dev/null)" = true ] || return 1
  [ "$(docker inspect -f '{{.Image}}' "$SVC" 2>/dev/null)" = "$1" ] || return 1
  docker exec "$SVC" /mnemostxt health >/dev/null 2>&1
}
switch() { (cd "$DEPLOY_DIR" && docker compose up -d --no-build "$SVC") >/dev/null 2>&1; }

t0=$(date +%s)
switch || fail "docker compose up failed (cd $DEPLOY_DIR && docker compose up -d --no-build $SVC)"
i=0
while ! healthy "$NEW_ID"; do
  i=$((i + 2))
  if [ "$i" -ge "$DEPLOY_HEALTH_SEC" ]; then
    docker logs --tail 15 "$SVC" 2>&1 | sed 's/^/    /'
    [ -n "$PREV_ID" ] || fail "the new container does not answer (logs above)"
    warn "the new container does not answer after ${DEPLOY_HEALTH_SEC}s (logs above): going back"
    docker image tag "$PREV_ID" "$IMG"
    switch || fail "going back failed too: cd $DEPLOY_DIR && docker compose up -d --no-build $SVC"
    j=0
    while ! healthy "$PREV_ID"; do j=$((j + 2)); [ "$j" -lt 60 ] || fail "the previous image does not answer either"; sleep 2; done
    fail "deploy of $VER undone: the previous version serves again"
  fi
  sleep 2
done
ok "new container answers ($(( $(date +%s) - t0 ))s from switch to healthy)"

if [ -n "${HEALTH_URL:-}" ]; then
  h=$(curl -fsS --max-time 10 "$HEALTH_URL/health" 2>/dev/null || true)
  [ "$h" = ok ] || fail "$HEALTH_URL/health did not answer ok (the container itself does)"
  if curl -fsS --max-time 10 "$HEALTH_URL/" 2>/dev/null | grep -qi "mnemostxt $VER"; then
    ok "$HEALTH_URL serves $VER"
  else
    warn "$HEALTH_URL answers, but its page does not show $VER (cache?)"
  fi
fi
docker image prune -f >/dev/null 2>&1 || true
ok "mnemostxt $VER deployed"
