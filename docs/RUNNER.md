# The release runner

Check jobs run on GitLab's shared runners. The **release build** (a `vX.Y.Z`
tag) runs on your own machine, on the shared Docker runner from the separate
**gtlbrunner** project, which builds the releases of all your apps. Its
README has the full set-up; this page lists only what mnemostxt needs from it.

| | mnemostxt |
|---|---|
| Runner tag | `mnemostxt-app` (a project runner registered from this project) |
| Release image | `mnemostxt-builder:4`, built from `docker/builder/` of this repo (`BUILDER_TAG` in `scripts/build-release.sh`, `image:` of `release-files` in `.gitlab-ci.yml`) |
| Volumes | `mnemostxt-build-cache:/build-cache` (caches), `<gtlbrunner>/keys/mnemostxt:/keys:ro` (signing key) |
| Key folder | `mnemostxt.jks` + `keystore.env` (`MNEMOSTXT_STORE_PASSWORD`, `MNEMOSTXT_KEY_PASSWORD`, `MNEMOSTXT_KEY_ALIAS`), made by `scripts/make-keystore.sh` |
| `allowed_images` | `["mnemostxt-builder:*", "alpine:*"]` with `pull_policy = ["if-not-present"]` |

The gtlbrunner `docker-compose.yml` builds the image straight from GitLab:

```yaml
  mnemostxt-builder:
    profiles: [build]
    image: mnemostxt-builder:4
    build: https://gitlab.com/niharokz/mnemostxt.git#main:docker/builder
```

## When docker/builder/Dockerfile changes

1. Bump the tag in `scripts/build-release.sh` (`BUILDER_TAG`) and in
   `.gitlab-ci.yml` (`image:` of `release-files`); push to `main`.
2. In the gtlbrunner folder: set the same tag on `mnemostxt-builder`, then
   `docker compose build mnemostxt-builder`.
3. Release as usual. Until step 2 is done, the job fails with
   `pull access denied for mnemostxt-builder`.

## Building by hand (no runner)

On any Linux machine with Docker:

```sh
sh scripts/make-keystore.sh     # once: the Android signing key, outside the repo
sh scripts/build-release.sh     # → dist/release/*.deb, *-setup.exe, *.apk
```
