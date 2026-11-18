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
# uploaded here.
#
# The build limits itself so the host stays healthy (see "limits" below):
# a share of the CPUs, at most 70 % of the memory cap, low CPU and I/O
# priority, one target at a time, and a pause while the CPU is too hot.
#
# BUILD_CACHE  folder for cargo/target/gradle/npm/xwin caches (a Docker volume)
# KEY_DIR      folder with mnemostxt.jks + keystore.env (read-only mount)
# Optional:
# MNEMOSTXT_CPUS         use at most this many CPUs (default: the cgroup quota, else all but 3)
# MNEMOSTXT_FAT_LTO=1    fat LTO (smaller, slower to build) when the cap is ≥ 10 GB
# MNEMOSTXT_TEMP_PAUSE   pause the build at this CPU temperature in °C (default 85, 0 = off)
# MNEMOSTXT_TEMP_RESUME  resume it at this temperature (default 75)
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

# ── limits ───────────────────────────────────────────────────────────────────
# Read from the container's cgroup (the job's or `docker run`'s limits);
# without them, the safe defaults below. Tests point these at fake folders.
CG=${MNEMOSTXT_CGROUP_DIR:-/sys/fs/cgroup}
TH=${MNEMOSTXT_THERMAL_DIR:-/sys/class}
clamp() { if [ "$1" -lt "$2" ]; then echo "$2"; elif [ "$1" -gt "$3" ]; then echo "$3"; else echo "$1"; fi; }
isnum() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; }

# cap_mb: the memory cap in MB (cgroup memory.max), else 75 % of the RAM
cap_mb() {
  for f in "$CG/memory.max" "$CG/memory/memory.limit_in_bytes"; do
    [ -r "$f" ] || continue
    v=$(cat "$f" 2>/dev/null) || continue
    isnum "$v" || continue                              # "max": no limit here
    [ "$v" -lt 1099511627776 ] && { echo $((v / 1048576)); return; } # cgroup v1 "unlimited" is huge
  done
  awk '$1 == "MemTotal:" { printf "%d\n", $2 * 0.75 / 1024 }' /proc/meminfo
}

# cpu_quota: whole CPUs allowed by the cgroup (cpu.max), empty without a quota
cpu_quota() {
  if [ -r "$CG/cpu.max" ]; then
    read -r q p < "$CG/cpu.max" || true
  elif [ -r "$CG/cpu/cpu.cfs_quota_us" ] && [ -r "$CG/cpu/cpu.cfs_period_us" ]; then
    q=$(cat "$CG/cpu/cpu.cfs_quota_us"); p=$(cat "$CG/cpu/cpu.cfs_period_us")
  else
    return 0
  fi
  isnum "${q:-}" && isnum "${p:-}" && [ "$p" -gt 0 ] && echo $((q / p))
  return 0
}

NPROC=$(nproc 2>/dev/null || echo 2)
QUOTA=$(cpu_quota)
if [ -n "$QUOTA" ]; then
  CPUS=$(clamp "$QUOTA" 1 "$NPROC"); CPU_WHY="cgroup quota"
else
  CPUS=$(clamp $((NPROC - 3)) 1 "$NPROC"); CPU_WHY="no quota: $NPROC − 3"   # never all of them
fi
if [ -n "${MNEMOSTXT_CPUS:-}" ]; then
  isnum "$MNEMOSTXT_CPUS" || { echo "✗ MNEMOSTXT_CPUS=$MNEMOSTXT_CPUS is not a number"; exit 2; }
  CPUS=$(clamp "$MNEMOSTXT_CPUS" 1 "$NPROC"); CPU_WHY="MNEMOSTXT_CPUS"
fi

# Memory: everything running at once stays under 70 % of the cap, so a model
# loading in Ollama or Immich beside the build cannot push the host over.
MEM_MB=$(cap_mb)
BUDGET=$((MEM_MB * 70 / 100))
GRADLE_MB=$(clamp $((MEM_MB / 6)) 1536 2560)   # Gradle heap; Kotlin compiles inside it
JVM_EXTRA=768                                  # Gradle's metaspace, code cache and threads
NODE_MB=$(clamp $((MEM_MB / 10)) 768 2048)     # Vite, the Tauri CLI
RUSTC_MB=1536                                  # one rustc job
# deb, exe: Node + rustc; apk: Gradle runs beside rustc
JOBS=$(clamp $(((BUDGET - NODE_MB) / RUSTC_MB)) 1 "$CPUS")
JOBS_APK=$(clamp $(((BUDGET - NODE_MB - GRADLE_MB - JVM_EXTRA) / RUSTC_MB)) 1 "$CPUS")
PLAN=$((NODE_MB + JOBS * RUSTC_MB))
PLAN_APK=$((NODE_MB + GRADLE_MB + JVM_EXTRA + JOBS_APK * RUSTC_MB))
[ "$PLAN_APK" -gt "$PLAN" ] && PLAN=$PLAN_APK

if [ "${MNEMOSTXT_FAT_LTO:-0}" = 1 ] && [ "$MEM_MB" -ge 10240 ]; then
  LTO="fat (MNEMOSTXT_FAT_LTO)"   # Cargo.toml's own profile
else
  export CARGO_PROFILE_RELEASE_LTO=thin CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
  LTO=thin
fi

# every tool that would otherwise use all the CPUs it sees
export CARGO_BUILD_JOBS=$JOBS MAKEFLAGS="-j$CPUS" CMAKE_BUILD_PARALLEL_LEVEL=$CPUS \
       RAYON_NUM_THREADS=$CPUS GOMAXPROCS=$CPUS UV_THREADPOOL_SIZE=$CPUS \
       NODE_OPTIONS="--max-old-space-size=$NODE_MB" \
       JAVA_TOOL_OPTIONS="-XX:ActiveProcessorCount=$CPUS"
# Gradle reads GRADLE_USER_HOME/gradle.properties before the project's own
cat > "$GRADLE_USER_HOME/gradle.properties" <<EOF
# written by scripts/build-in-container.sh for every build (memory cap ${MEM_MB} MB, ${CPUS} CPUs)
org.gradle.jvmargs=-Xmx${GRADLE_MB}m -XX:MaxMetaspaceSize=512m -XX:ActiveProcessorCount=${CPUS} -Dfile.encoding=UTF-8
org.gradle.daemon=false
org.gradle.parallel=false
org.gradle.workers.max=${CPUS}
org.gradle.vfs.watch=false
kotlin.compiler.execution.strategy=in-process
EOF

# low CPU and I/O priority for this script and everything it starts
renice -n 10 -p $$ >/dev/null 2>&1 || true
command -v ionice >/dev/null 2>&1 && ionice -c 3 -p $$ >/dev/null 2>&1 || true

# ── temperature guard ────────────────────────────────────────────────────────
# Every 5 s: when the hottest sensor reaches TEMP_PAUSE, every process of the
# build is stopped (SIGSTOP) until it is back at TEMP_RESUME (SIGCONT).
TEMP_PAUSE=${MNEMOSTXT_TEMP_PAUSE:-85}
TEMP_RESUME=${MNEMOSTXT_TEMP_RESUME:-75}
MAIN=$$
GUARD_PID=""

# cpu_temp: the hottest sensor in °C (thermal zones, hwmon), empty if none can be read
cpu_temp() {
  best=""
  for f in "$TH"/thermal/thermal_zone*/temp "$TH"/hwmon/hwmon*/temp*_input; do
    [ -r "$f" ] || continue
    t=$(cat "$f" 2>/dev/null) || continue
    isnum "$t" || continue
    t=$((t / 1000))
    [ "$t" -gt 0 ] && [ "$t" -lt 150 ] || continue      # skip absent or broken sensors
    if [ -z "$best" ] || [ "$t" -gt "$best" ]; then best=$t; fi
  done
  echo "$best"
}

# build_pids: every process below this script, except the guard and what it runs
build_pids() {
  for d in /proc/[0-9]*; do
    pp=$(sed -n 's/^PPid:[[:space:]]*//p' "$d/status" 2>/dev/null) || continue
    [ -n "$pp" ] && echo "${d#/proc/} $pp"
  done | awk -v root="$MAIN" -v skip="${GUARD_PID:-0}" '
    { parent[$1] = $2 }
    END {
      inside[root] = 1
      do {
        grew = 0
        for (p in parent) if (!(p in inside) && p != skip && (parent[p] in inside)) { inside[p] = 1; grew = 1 }
      } while (grew)
      for (p in inside) if (p != root) print p
    }'
}

signal_build() { # STOP | CONT; twice, to catch a process started in between
  for _ in 1 2; do
    pids=$(build_pids)
    # shellcheck disable=SC2086
    [ -n "$pids" ] && kill -"$1" $pids 2>/dev/null || true
  done
}

guard() {
  read -r GUARD_PID _ < /proc/self/stat   # this subshell's own pid (not $$)
  paused=0
  while kill -0 "$MAIN" 2>/dev/null; do
    t=$(cpu_temp)
    if [ -n "$t" ]; then
      if [ "$paused" = 0 ] && [ "$t" -ge "$TEMP_PAUSE" ]; then
        signal_build STOP; paused=1
        echo "⏸ CPU at ${t} °C: build paused until it is back at ${TEMP_RESUME} °C"
      elif [ "$paused" = 1 ] && [ "$t" -le "$TEMP_RESUME" ]; then
        signal_build CONT; paused=0
        echo "▶ CPU at ${t} °C: build resumed"
      fi
    fi
    sleep 5
  done
}

GUARD_INFO=off
if isnum "$TEMP_PAUSE" && isnum "$TEMP_RESUME" && [ "$TEMP_PAUSE" -gt 0 ]; then
  [ "$TEMP_RESUME" -lt "$TEMP_PAUSE" ] || TEMP_RESUME=$((TEMP_PAUSE - 10))
  now_t=$(cpu_temp)
  if [ -n "$now_t" ]; then
    guard &
    GUARD_PID=$!
    GUARD_INFO="pause at ${TEMP_PAUSE} °C, resume at ${TEMP_RESUME} °C (now ${now_t} °C)"
  else
    GUARD_INFO="off (no temperature sensor visible)"
  fi
fi
# whatever happens: no guard left behind, nothing left stopped
cleanup() {
  [ -n "$GUARD_PID" ] && kill "$GUARD_PID" 2>/dev/null
  signal_build CONT
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ── log helpers ──────────────────────────────────────────────────────────────
now() { date +%s; }
took() { s=$(( $(now) - $1 )); printf '%dm %02ds' $((s / 60)) $((s % 60)); }
size() { du -h "$1" | cut -f1; }
# GitLab collapsible sections (plain text elsewhere)
open_section() { # id title collapsed(true|false)
  if [ -n "${CI:-}" ]; then printf '\033[0Ksection_start:%s:%s[collapsed=%s]\r\033[0K%s\n' "$(now)" "$1" "$3" "$2"; fi
}
close_section() { if [ -n "${CI:-}" ]; then printf '\033[0Ksection_end:%s:%s\r\033[0K\n' "$(now)" "$1"; fi; }

# out_of_memory LOG CODE: did the step die at the memory cap?
out_of_memory() {
  [ "$2" = 137 ] && return 0
  grep -qE 'exit code 137|signal: 9, SIGKILL|Killed[[:space:]]*$|daemon disappeared unexpectedly' "$1" 2>/dev/null
}

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
    if out_of_memory "$LOGS/$id.log" "$code"; then
      printf '\n✗ out of memory at the %s MB cap in step "%s" (exit %s): the kernel stopped the build; the host is fine.\n' "$MEM_MB" "$title" "$code"
      printf '  Fix: fewer parallel jobs (MNEMOSTXT_CPUS=%s), or a larger cap (gtlbrunner GTLB_MEM_PCT, then ./build.sh -limits).\n' "$(clamp $((CPUS - 1)) 1 "$CPUS")"
      exit 137
    fi
    printf '\n✗ %s failed after %s (exit %s). See the section above; full log: %s\n' "$title" "$(took "$t0")" "$code" "$LOGS/$id.log"
    exit "$code"
  fi
}

# settle: between targets, stop any Gradle or Kotlin daemon so its memory is free
settle() {
  pkill -f 'GradleDaemon|KotlinCompileDaemon|org.jetbrains.kotlin.daemon' >/dev/null 2>&1 || true
}

# ── the steps ────────────────────────────────────────────────────────────────
# Each step chains with && — `set -e` does not apply inside a function that is
# called from an `if` (see step()).
deb() {
  export CARGO_BUILD_JOBS=$JOBS
  chmod 755 app/linux/m && # the "m file.txt" launcher (a checkout from Windows may lose the bit)
  (cd app && "$TAURI" build --bundles deb --ci) &&
  cp "$CARGO_TARGET_DIR/release/bundle/deb/mnemostxt_${V}_amd64.deb" "$OUT/mnemostxt-$V-amd64.deb"
}
exe() {
  export CARGO_BUILD_JOBS=$JOBS
  (cd app && "$TAURI" build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis --ci) &&
  cp "$CARGO_TARGET_DIR/x86_64-pc-windows-msvc/release/bundle/nsis/mnemostxt_${V}_x64-setup.exe" "$OUT/mnemostxt-$V-setup.exe"
}
apk() {
  export CARGO_BUILD_JOBS=$JOBS_APK   # Gradle runs beside rustc
  python3 scripts/android-prepare.py --keys "$KEY_DIR" &&
  (cd app && "$TAURI" android build --apk --target aarch64 --ci) || { rm -f app/gen/android/keystore.properties; return 1; }
  rm -f app/gen/android/keystore.properties
  f=$(find app/gen/android/app/build/outputs/apk -name '*release*.apk' ! -name '*unsigned*' | head -1)
  [ -n "$f" ] || { echo "no signed release APK found — check keystore.properties / the signing key"; find app/gen/android/app/build/outputs -name '*.apk'; return 1; }
  cp "$f" "$OUT/mnemostxt-$V.apk" &&
  "$ANDROID_HOME"/build-tools/*/apksigner verify --print-certs "$OUT/mnemostxt-$V.apk"
}
frontend() {
  (cd frontend && npm ci --no-audit --no-fund --loglevel=error && node --test --test-concurrency=1 --test-reporter=spec test/*.test.js)
}

T0=$(now)
echo "mnemostxt $V — building: $*"
echo "limits: memory cap ${MEM_MB} MB, planned at most ${PLAN} MB (≤ 70 % = ${BUDGET} MB) · CPUs ${CPUS} (${CPU_WHY}) · cargo jobs ${JOBS}, apk ${JOBS_APK} · Gradle workers ${CPUS}, heap ${GRADLE_MB} MB (Kotlin inside) · Node ${NODE_MB} MB · LTO ${LTO} · nice 10, idle I/O · temperature guard ${GUARD_INFO}"
[ "$PLAN" -le "$BUDGET" ] || echo "! the memory cap is small for this build: it may stop with exit 137"
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
  settle   # one target at a time, nothing left running between them
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
