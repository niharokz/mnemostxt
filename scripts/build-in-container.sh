#!/bin/sh
# Builds the release files inside the builder image (docker/builder/Dockerfile),
# either as the GitLab release job or from scripts/build-release.sh by hand.
#
#   sh scripts/build-in-container.sh deb exe apk
#
# The log is kept short: each step prints one ✓/✗ line; the full tool output
# sits in a collapsed section in GitLab (or in dist/logs/ by hand), and a
# failing step shows its output expanded, ending with the error.
#
# The gtlbrunner contract (its INTEGRATION.md): dist/release/ holds only the
# release files and SHA256SUMS; caches live under BUILD_CACHE; nothing is
# uploaded here; the build stays inside the job's memory cap (below).
#
# BUILD_CACHE  folder for cargo/target/gradle/npm/xwin caches (a Docker volume)
# KEY_DIR      folder with mnemostxt.jks + keystore.env (read-only mount)
set -eu
cd "$(dirname "$0")/.."
ROOT=$(pwd)
C=${BUILD_CACHE:-/cache}
KEY_DIR=${KEY_DIR:-/keys}
export HOME=$C/home CARGO_HOME=$C/cargo CARGO_TARGET_DIR=$C/target GRADLE_USER_HOME=$C/gradle \
       npm_config_cache=$C/npm XWIN_CACHE_DIR=$C/xwin CARGO_TERM_COLOR=never NO_COLOR=1
# Tauri's NSIS tools are baked into the image (docker/builder/Dockerfile)
[ -d /opt/tauri-tools ] && export XDG_CACHE_HOME=/opt/tauri-tools
mkdir -p "$HOME" "$CARGO_HOME" "$CARGO_TARGET_DIR" "$GRADLE_USER_HOME" "$npm_config_cache" "$XWIN_CACHE_DIR"
# the toolchain (rustc, cargo-xwin) stays in the image; the cache holds registries
[ -d /usr/local/rustup ] && export PATH=/usr/local/cargo/bin:$PATH RUSTUP_HOME=/usr/local/rustup
V=$(tr -d ' \n\r' < VERSION)
OUT=dist/release
LOGS=dist/logs
TAURI=$ROOT/frontend/node_modules/.bin/tauri
rm -rf "$OUT" "$LOGS"
mkdir -p "$OUT" "$LOGS"

# ── memory: stay inside the job's cap ────────────────────────────────────────
# gtlbrunner runs this with a hard memory limit (75 % of the host's RAM, no
# swap); at the limit the kernel kills the build (exit 137). The limit is read
# from the container's cgroup; without one (another machine) 75 % of the RAM
# is assumed. Everything that takes memory is sized from it.
cap_mb() {
  for f in /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory/memory.limit_in_bytes; do
    [ -r "$f" ] || continue
    v=$(cat "$f" 2>/dev/null) || continue
    case "$v" in ''|max|*[!0-9]*) continue ;; esac
    [ "$v" -lt 1099511627776 ] && { echo $((v / 1048576)); return; } # cgroup v1 "unlimited" is huge
  done
  awk '$1 == "MemTotal:" { printf "%d\n", $2 * 0.75 / 1024 }' /proc/meminfo
}
clamp() { if [ "$1" -lt "$2" ]; then echo "$2"; elif [ "$1" -gt "$3" ]; then echo "$3"; else echo "$1"; fi; }
MEM_MB=$(cap_mb)
CPUS=$(nproc 2>/dev/null || echo 2)
GRADLE_MB=$(clamp $((MEM_MB / 5)) 1024 3072)   # the Gradle JVM
KOTLIN_MB=$(clamp $((MEM_MB / 8)) 512 2048)    # the Kotlin compile daemon
NODE_MB=$(clamp $((MEM_MB / 4)) 1024 4096)     # Vite, the Tauri CLI
# rustc runs next to Gradle in the Android build: ~1.5 GB per job, after the JVMs
JOBS=$(clamp $(((MEM_MB - GRADLE_MB - KOTLIN_MB - 1024) / 1536)) 1 "$CPUS")
export CARGO_BUILD_JOBS=$JOBS NODE_OPTIONS="--max-old-space-size=$NODE_MB"
LTO="fat (Cargo.toml)"
if [ "$MEM_MB" -lt 6144 ]; then  # fat LTO's last link may not fit in a small cap
  export CARGO_PROFILE_RELEASE_LTO=thin CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
  LTO=thin
fi
# Gradle reads GRADLE_USER_HOME/gradle.properties before the project's own
cat > "$GRADLE_USER_HOME/gradle.properties" <<EOF
# written by scripts/build-in-container.sh for every build (memory cap ${MEM_MB} MB)
org.gradle.jvmargs=-Xmx${GRADLE_MB}m -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8
org.gradle.daemon=false
org.gradle.workers.max=$(clamp "$JOBS" 1 4)
kotlin.daemon.jvmargs=-Xmx${KOTLIN_MB}m
EOF

# ── log helpers ──────────────────────────────────────────────────────────────
now() { date +%s; }
took() { s=$(( $(now) - $1 )); printf '%dm %02ds' $((s / 60)) $((s % 60)); }
size() { du -h "$1" | cut -f1; }
# GitLab collapsible sections (plain text elsewhere)
open_section() { # id title collapsed(true|false)
  if [ -n "${CI:-}" ]; then printf '\033[0Ksection_start:%s:%s[collapsed=%s]\r\033[0K%s\n' "$(now)" "$1" "$3" "$2"; fi
}
close_section() { if [ -n "${CI:-}" ]; then printf '\033[0Ksection_end:%s:%s\r\033[0K\n' "$(now)" "$1"; fi; }

# step ID "Title" command...: runs the command with its output in $LOGS/ID.log.
# Success: one ✓ line (+ the output collapsed in CI). Failure: the output
# expanded, then a ✗ line, then exit.
step() {
  id=$1; title=$2; shift 2
  t0=$(now)
  if "$@" > "$LOGS/$id.log" 2>&1; then
    if [ -n "${CI:-}" ]; then
      open_section "$id" "  details: $title" true; cat "$LOGS/$id.log"; close_section "$id"
    fi
    printf '✓ %-34s %s\n' "$title" "$(took "$t0")"
  else
    code=$?
    open_section "$id" "✗ $title — output (the error is at the end)" false
    cat "$LOGS/$id.log"
    close_section "$id"
    printf '\n✗ %s failed after %s (exit %s). See the section above; full log: %s\n' "$title" "$(took "$t0")" "$code" "$LOGS/$id.log"
    exit "$code"
  fi
}

# ── the steps ────────────────────────────────────────────────────────────────
# Each step chains with && — `set -e` does not apply inside a function that is
# called from an `if` (see step()).
deb() {
  chmod 755 app/linux/m && # the "m file.txt" launcher (a checkout from Windows may lose the bit)
  (cd app && "$TAURI" build --bundles deb --ci) &&
  cp "$CARGO_TARGET_DIR/release/bundle/deb/mnemostxt_${V}_amd64.deb" "$OUT/mnemostxt-$V-amd64.deb"
}
exe() {
  (cd app && "$TAURI" build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis --ci) &&
  cp "$CARGO_TARGET_DIR/x86_64-pc-windows-msvc/release/bundle/nsis/mnemostxt_${V}_x64-setup.exe" "$OUT/mnemostxt-$V-setup.exe"
}
apk() {
  python3 scripts/android-prepare.py --keys "$KEY_DIR" &&
  (cd app && "$TAURI" android build --apk --target aarch64 --ci) || { rm -f app/gen/android/keystore.properties; return 1; }
  rm -f app/gen/android/keystore.properties
  f=$(find app/gen/android/app/build/outputs/apk -name '*release*.apk' ! -name '*unsigned*' | head -1)
  [ -n "$f" ] || { echo "no signed release APK found — check keystore.properties / the signing key"; find app/gen/android/app/build/outputs -name '*.apk'; return 1; }
  cp "$f" "$OUT/mnemostxt-$V.apk" &&
  "$ANDROID_HOME"/build-tools/*/apksigner verify --print-certs "$OUT/mnemostxt-$V.apk"
}
frontend() {
  (cd frontend && npm ci --no-audit --no-fund --loglevel=error && node --test --test-reporter=spec test/*.test.js)
}

T0=$(now)
echo "mnemostxt $V — building: $*"
echo "memory cap ${MEM_MB} MB: cargo jobs $JOBS, LTO $LTO, Gradle ${GRADLE_MB} MB, Kotlin ${KOTLIN_MB} MB, Node ${NODE_MB} MB"
echo
step checks "Version check" sh scripts/check-version.sh
step frontend "Frontend dependencies and tests" frontend
for t in "$@"; do
  case "$t" in
    deb) step deb "Linux .deb" deb ;;
    exe) step exe "Windows setup.exe (cross-compiled)" exe ;;
    apk) step apk "Android .apk (arm64, signed)" apk ;;
    *) echo "unknown target $t (deb, exe, apk)"; exit 2 ;;
  esac
done
(cd "$OUT" && sha256sum mnemostxt-* > SHA256SUMS)

# ── summary ──────────────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════════"
echo " mnemostxt $V — release files ($(took "$T0"))"
echo "════════════════════════════════════════════════════════════════════"
for f in "$OUT"/mnemostxt-*; do
  case "$f" in
    *.deb) kind="Linux  " ;; *.exe) kind="Windows" ;; *.apk) kind="Android" ;; *) kind="       " ;;
  esac
  printf ' %s  %-28s %6s  sha256 %s…\n' "$kind" "$(basename "$f")" "$(size "$f")" "$(sha256sum "$f" | cut -c1-16)"
done
if [ -f "$OUT/mnemostxt-$V.apk" ]; then
  dn=$(sed -n 's/^Signer #1 certificate DN: //p' "$LOGS/apk.log" | head -1)
  fp=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$LOGS/apk.log" | head -1)
  echo
  echo " APK signed by: $dn"
  echo " key SHA-256:   $fp"
  echo " (must stay the same for every release, or phones refuse the update)"
fi
echo "════════════════════════════════════════════════════════════════════"
