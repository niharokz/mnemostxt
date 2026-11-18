# The release runner

Check jobs run on GitLab's shared runners. The **release build** (a `vX.Y.Z`
tag) runs on the homelab, in **gtlbrunner**: the private Docker runner that
builds the release files of all your apps. Its `INTEGRATION.md` is the
contract this repository follows; its `README.md` has the set-up. This page
lists what mnemostxt needs from it.

| | mnemostxt |
|---|---|
| Runner tag | `mnemostxt-app` (a project runner; `./build.sh -gitlab mnemostxt glrt-…` registers it) |
| Release image | `mnemostxt-builder:5`, built from `docker/builder/` of this repo. The tag is the same in three places: `image:` of `release-files` in `.gitlab-ci.yml`, `BUILDER_TAG` in `scripts/build-release.sh`, and gtlbrunner's `apps/mnemostxt/compose.yml` |
| Volumes | `mnemostxt-build-cache:/build-cache` (caches), `keys/mnemostxt:/keys:ro` (signing key) |
| Key folder | `mnemostxt.jks` + `keystore.env` (`MNEMOSTXT_STORE_PASSWORD`, `MNEMOSTXT_KEY_PASSWORD`, `MNEMOSTXT_KEY_ALIAS`), made once by `scripts/make-keystore.sh`; never a new one (phones refuse the update) |
| Build | `sh scripts/build-in-container.sh deb exe apk` → `dist/release/` (the three files + `SHA256SUMS`), logs in `dist/logs/` |

## Limits

Every job, every local build and every image build gtlbrunner runs is capped at
`GTLB_MEM_PCT` (75 %) of the host's RAM, without swap, and only one runs at a
time. On top of that, `scripts/build-in-container.sh` limits itself, because a
small machine can also go down from heat or power under long full CPU load:

- CPUs: the job's quota, else all but 3 (3 of 6 on the homelab);
- memory: everything planned under 70 % of the cap;
- thin LTO, `nice 10`, idle I/O, one target at a time;
- a pause while the CPU is at 85 °C or more, until 75 °C.

The first lines of its log show the numbers (`limits: …`). A build that still
reaches the memory cap fails with exit 137 and says how to make it lighter.
ARCHITECTURE.md (Release build) has the details.

The builder image compiles nothing (it downloads and unpacks), so building it
is light. Still, never build it with plain `docker build` or `docker compose
build` on the homelab: those have no memory cap. Use gtlbrunner.

## On the homelab (in the gtlbrunner folder)

```sh
./build.sh -list               # apps, images, keys, runners
./build.sh -status -f          # what builds now, follow its log
./build.sh -image mnemostxt    # (re)build mnemostxt-builder, memory-capped
./build.sh mnemostxt           # a local release build → dist/mnemostxt/<version>/
```

## When docker/builder/Dockerfile changes

1. Bump the tag: `.gitlab-ci.yml` (`image:` of `release-files`) and
   `scripts/build-release.sh` (`BUILDER_TAG`); push to `main`.
2. In gtlbrunner: the same tag in `apps/mnemostxt/compose.yml`, then
   `./build.sh -image mnemostxt`.
3. Release as usual. Until step 2 is done the job fails with
   `pull access denied for mnemostxt-builder`.

## Building on another machine (no runner)

On any Linux machine with Docker and the image already built:

```sh
sh scripts/make-keystore.sh     # once: the Android signing key, outside the repo
sh scripts/build-release.sh     # → dist/release/*.deb, *-setup.exe, *.apk (capped at 75 % of the RAM)
```
