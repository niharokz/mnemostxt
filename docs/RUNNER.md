# The release runner

Check jobs run on GitLab's shared runners. The **release build** (a `vX.Y.Z`
tag) runs on the homelab, in **gtlbrunner**: the private Docker runner that
builds the release files of all your apps. Its `INTEGRATION.md` is the
contract this repository follows; its `README.md` has the set-up. This page
lists what mnemostxt needs from it.

| | mnemostxt |
|---|---|
| Runner tag | `mnemostxt-app` (a project runner; `./build.sh -gitlab mnemostxt glrt-…` registers it) |
| Release image | `mnemostxt-builder:4`, built from `docker/builder/` of this repo. The tag is the same in three places: `image:` of `release-files` in `.gitlab-ci.yml`, `BUILDER_TAG` in `scripts/build-release.sh`, and gtlbrunner's `apps/mnemostxt/compose.yml` |
| Volumes | `mnemostxt-build-cache:/build-cache` (caches), `keys/mnemostxt:/keys:ro` (signing key) |
| Key folder | `mnemostxt.jks` + `keystore.env` (`MNEMOSTXT_STORE_PASSWORD`, `MNEMOSTXT_KEY_PASSWORD`, `MNEMOSTXT_KEY_ALIAS`), made once by `scripts/make-keystore.sh`; never a new one (phones refuse the update) |
| Build | `sh scripts/build-in-container.sh deb exe apk` → `dist/release/` (the three files + `SHA256SUMS`), logs in `dist/logs/` |

## Memory

Every job, every local build and every image build gtlbrunner runs is capped at
`GTLB_MEM_PCT` (75 %) of the host's RAM, without swap, and only one runs at a
time. `scripts/build-in-container.sh` reads that cap from its container and
sizes the build to fit: cargo jobs, Gradle and Kotlin heaps, Node's heap, and
thin LTO below 6 GB. The first line of its log shows the numbers. A build that
still reaches the cap fails with exit 137; the host is not affected.

Never build the image with plain `docker build` or `docker compose build` on
the homelab: those have no memory cap. Use gtlbrunner.

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
