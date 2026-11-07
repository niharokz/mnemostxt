# Releasing

One version for everything (Linux, Windows, Android, web). A tag `vX.Y.Z`
makes GitLab build the three installers on your runner ([RUNNER.md](RUNNER.md))
and publish a release with permanent download links. `scripts/release.sh` does
the whole thing from your main machine and tells you what happened.

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
| Tag | annotated `vX.Y.Z` (message = the changelog section), push, **wait for the release pipeline** (deb, exe, apk; ~10–20 min, the first one longer) |
| Verify | the GitLab release exists with its 4 files; the 3 permanent download links answer |
| Deploy | `docker compose up -d --build mnemostxt` in `DEPLOY_DIR`, wait for *healthy*, check `HEALTH_URL/health` and that the About page shows the new version |
| Report | every step with ✓ / ! / ✗ and the links |

Options: `--yes` (no question), `--no-deploy`, `--no-wait` (push the tag and
stop).

Then install the new `.apk` on the phone and the `.deb` / `setup.exe` on the
computers (the About page of your web app links them).

## A release failed

The report names the failing job and its link. Fix the problem, commit and push
to `main`. Then:

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

```sh
cd "$DEPLOY_DIR" && git checkout v0.0.1 && docker compose up -d --build
```

Desktop and Android: install the older file from its release page.

## GitLab settings that go with it

[GITLAB.md](GITLAB.md): protected branch and tags, labels, milestones,
badges, templates.
