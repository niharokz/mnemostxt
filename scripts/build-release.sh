#!/bin/sh
# Builds the release files by hand in the builder image (docker/builder/Dockerfile):
#   dist/release/mnemostxt-X.Y.Z-amd64.deb       Linux
#   dist/release/mnemostxt-X.Y.Z-setup.exe       Windows installer
#   dist/release/mnemostxt-X.Y.Z.apk             Android (arm64), signed
#   dist/release/SHA256SUMS
#
#   sh scripts/build-release.sh            all three
#   sh scripts/build-release.sh deb apk    some of them
#
# On the homelab use gtlbrunner instead: ./build.sh mnemostxt (docs/RUNNER.md).
# This script is for another Linux machine with Docker. Like gtlbrunner it caps
# the build at MNEMOSTXT_MEM_PCT (default 75) % of the RAM, without swap, and it
# never builds the image itself (an image build has no memory cap).
# The Android key comes from MNEMOSTXT_KEY_DIR
# (default $KEYS_HOME/.mnemostxt-keys, else ~/.local/share/keys/.mnemostxt-keys).
set -eu
cd "$(dirname "$0")/.."
TARGETS=${*:-deb exe apk}
BUILDER_TAG=4   # = image: of release-files in .gitlab-ci.yml (and gtlbrunner's apps/mnemostxt/compose.yml)
IMAGE=mnemostxt-builder:$BUILDER_TAG
KEY_DIR=${MNEMOSTXT_KEY_DIR:-${KEYS_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/keys}/.mnemostxt-keys}
PCT=${MNEMOSTXT_MEM_PCT:-75}

case "$PCT" in ''|*[!0-9]*) echo "✗ MNEMOSTXT_MEM_PCT=$PCT: use a whole number from 10 to 95"; exit 2 ;; esac
[ "$PCT" -ge 10 ] && [ "$PCT" -le 95 ] || { echo "✗ MNEMOSTXT_MEM_PCT=$PCT: use a whole number from 10 to 95"; exit 2; }
MEM=$(awk -v p="$PCT" '$1 == "MemTotal:" { printf "%dm", $2 * p / 100 / 1024 }' /proc/meminfo)

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "✗ $IMAGE is not built on this machine."
  echo "  On the homelab: gtlbrunner ./build.sh -image mnemostxt (memory-capped)."
  echo "  Elsewhere, build it yourself, knowing an image build has no memory cap:"
  echo "    docker build -t $IMAGE docker/builder"
  exit 1
fi

case " $TARGETS " in
  *" apk "*) [ -f "$KEY_DIR/mnemostxt.jks" ] || { echo "✗ no signing key in $KEY_DIR — run: sh scripts/make-keystore.sh"; exit 1; } ;;
esac

KEYS_MOUNT=""
[ -d "$KEY_DIR" ] && KEYS_MOUNT="-v $KEY_DIR:/keys:ro"

echo "▸ $IMAGE, memory cap $MEM ($PCT % of the RAM, no swap)"
# runs as you, so files in dist/ are yours; caches live in a Docker volume
# shellcheck disable=SC2086
docker run --rm --user "$(id -u):$(id -g)" --memory "$MEM" --memory-swap "$MEM" \
  -e BUILD_CACHE=/cache -e KEY_DIR=/keys \
  -v mnemostxt-build-cache:/cache -v "$PWD:/src" -w /src $KEYS_MOUNT \
  "$IMAGE" sh scripts/build-in-container.sh $TARGETS || {
  rc=$?
  [ "$rc" = 137 ] && echo "✗ out of memory at the $MEM cap (exit 137): raise MNEMOSTXT_MEM_PCT, or build fewer targets at once"
  exit "$rc"
}
ls -l dist/release
