# Releasing

One version for everything (Linux, Windows, Android, web). A tag `vX.Y.Z`
makes GitLab build the three installers on your runner ([RUNNER.md](RUNNER.md))
and publish a release with permanent download links. `scripts/release.sh` does
the whole thing on the release machine and tells you what happened.

## While you work

Write every change under **`## [Unreleased]`** in `CHANGELOG.md`, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) groups (`### Added`,
`### Changed`, `### Fixed`, `### Removed`). Plain words; the release page shows
this text.

## Once: the token

`release.sh` asks GitLab about pipelines and releases. Make a personal access
token: GitLab → your avatar → **Preferences → Access tokens** → name
`mnemostxt-release`, scope **read_api**, an expiry date → *Create*. Then, on
the machine you release from:

```sh
mkdir -p ~/.config/mnemostxt
cat > ~/.config/mnemostxt/release.env <<'ENV'
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
# optional: deploy the web app after the release
DEPLOY_DIR=/path/to/the/folder/with/mnemostxt/docker-compose.yml
HEALTH_URL=https://notes.example.com
ENV
chmod 600 ~/.config/mnemostxt/release.env
```

Anything in `scripts/release.conf` can be overridden there. Nothing personal
goes in the repository.

## Every release

```sh
git pull
sh scripts/release.sh --dry-run     # only the checks, changes nothing
sh scripts/release.sh               # next patch: 0.0.2 -> 0.0.3
sh scripts/release.sh minor         # 0.0.2 -> 0.1.0   (major, or an exact 1.2.3, work too)
```

What it does, stopping at the first problem with a clear ✗ line:

| Step | |
|---|---|
| Pre-flight | tools, token, on `main`, no uncommitted changes, not behind `origin`, `[Unreleased]` has entries, version files agree, `check-public.sh` finds nothing private, deploy folder exists |
| Bump | `VERSION`, `frontend/package.json` and `-lock.json`, `app/Cargo.toml` and `Cargo.lock`, `app/tauri.conf.json`; `CHANGELOG.md`: `[Unreleased]` becomes `[X.Y.Z] - today`, a new empty `[Unreleased]` above it, compare links at the bottom |
| Push | commit `release: mnemostxt X.Y.Z`, push `main`, **wait for its check pipeline** |
| Tag | annotated `vX.Y.Z` (message = the changelog section), push, **wait for the release pipeline** (deb, exe, apk; ~10 min on the homelab runner) |
| Verify | the GitLab release exists with its 4 files; the 3 permanent download links answer |
| Deploy | `scripts/deploy.sh` (below): the web app is replaced in seconds, and put back if the new one does not answer |
| Report | every step with ✓ / ! / ✗ and the links |

Options: `--yes` (no question), `--no-deploy`, `--no-wait` (push the tag and
stop), `--continue` (see *A release stopped* below).

To release and log out, run it in the background:

```sh
nohup sh scripts/release.sh --yes > ~/release.log 2>&1 &
tail -f ~/release.log          # Ctrl+C stops only the reading
```

While GitLab works, every job is shown as it starts and ends, with its time
and link, and the release build's own steps as they finish:

```
▸ Release build (deb, exe, apk)
  release pipeline: https://gitlab.com/…/-/pipelines/…
  14:58 ▸ release-files  running  https://gitlab.com/…/-/jobs/…
      release-files: limits: memory cap 11841 MB, … CPUs 3 …
      release-files: ✓ Linux .deb                         1m 07s
      release-files: ✓ Windows setup.exe (cross-compiled) 2m 26s
      release-files: ✓ Android .apk (arm64, signed)       4m 01s
  15:08 ✓ release-files  success 10m 25s
  ✓ release pipeline passed
```

Report-only jobs (`govulncheck`, `cargo-audit`, `npm-audit`) show
*failed (allowed to fail)*; they never stop a release.

A push that reaches GitLab but fails for another push address of `origin`
(a mirror that is down) is a `!` warning, not a stop. Push it again later:
`git push origin main` and `git push origin vX.Y.Z`.

## Deploy the web app

`release.sh` deploys after a release; to deploy again by hand (the version
checked out in `DEPLOY_DIR`):

```sh
sh scripts/deploy.sh --check    # only the checks
sh scripts/deploy.sh
```

1. It waits while a release build runs on this machine, so two heavy builds
   never run at once.
2. It builds the new image in gtlbrunner's capped builder while the old
   container keeps serving.
3. It keeps the running image as `mnemostxt:previous`.
4. It replaces the container (a few seconds without the web app) and waits
   until the new one answers `/health`, then checks `HEALTH_URL`.
5. If the new one does not answer within 90 s, the previous image is put back
   and it stops with ✗.

Then install the new `.apk` on the phone and the `.deb` / `setup.exe` on the
computers (the About page of your web app links them).

## A release stopped

**After the tag was pushed** (the tag reached GitLab, then something stopped
`release.sh`: the network, a closed terminal, a failed deploy): never run
`release.sh` again as usual, it would bump to the next version. Continue it:

```sh
sh scripts/release.sh --continue
```

It checks that `main` is at the tag, waits for that release pipeline (or sees
it has passed), checks the release and deploys. Nothing is bumped or tagged.

**A job failed.** The report names the failing job and its link. Fix the
problem, commit and push to `main`. Then:

- **The check pipeline on main failed**: nothing was tagged. Fix and run
  `release.sh` again — but the version was already bumped and pushed, so
  release the *same* version by hand: `git tag -a vX.Y.Z -m "mnemostxt X.Y.Z"
  && git push origin vX.Y.Z`, or bump again with `release.sh` (skipping a
  number is fine).
- **The release pipeline failed**: `v*` tags are protected, so GitLab refuses
  to move them. GitLab → **Code → Tags** → delete `vX.Y.Z` (and, if they
  exist, the release in **Deploy → Releases** and its files in
  **Deploy → Package registry**). Then tag the fixed commit again:
  ```sh
  git tag -fa vX.Y.Z -m "mnemostxt X.Y.Z"
  git push -f origin vX.Y.Z
  ```
  A job that failed for a passing reason (network) can simply be retried in
  the pipeline instead.

## Roll back the web app

Right after a deploy, the previous image is still there:

```sh
cd "$DEPLOY_DIR"
docker image tag mnemostxt:previous mnemostxt:local
docker compose up -d --no-build mnemostxt
```

An older version: check it out, then deploy it (built in the capped builder):

```sh
cd "$DEPLOY_DIR" && git checkout v0.0.6 && sh scripts/deploy.sh
git checkout main               # afterwards, before the next release
```

Desktop and Android: install the older file from its release page.

## GitLab settings that go with it

[GITLAB.md](GITLAB.md): protected branch and tags, labels, milestones,
badges, templates.
