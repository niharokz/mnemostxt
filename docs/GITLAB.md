# Using GitLab well for mnemostxt

What is set up in the repository, and the few switches to flip in the GitLab
UI (once). GitLab mirrors the repository to GitHub and Codeberg.

## In the repository

| What | Where |
|---|---|
| CI: checks on every push and merge request; release builds on `vX.Y.Z` | `.gitlab-ci.yml` |
| Changelog in Keep a Changelog format, `[Unreleased]` first | `CHANGELOG.md` |
| Release notes on the release page = that version's changelog section | `scripts/upload-release.sh` |
| Permanent download links (`/-/releases/permalink/latest/downloads/mnemostxt.apk`, `.deb`, `-setup.exe`) | `release:` in `.gitlab-ci.yml` |
| Issue templates (Bug, Feature, Release checklist) and a merge request template | `.gitlab/` |
| Pipeline and release badges | top of `README.md` |
| One-command release | `scripts/release.sh` ([RELEASING.md](RELEASING.md)) |

## Once, in the GitLab UI

**Settings → Repository**
- *Protected branches*: `main` — allowed to merge: Maintainers; allowed to push: Maintainers.
- *Protected tags*: `v*` — allowed to create: Maintainers. (Release jobs only
  run on protected tags, and protected tags cannot be moved: see RELEASING.md.)
- *Mirroring repositories*: push mirrors to GitHub and Codeberg (already set up).

**Settings → General**
- *Badges*: none needed (the README carries them), or add the same two here.
- *Merge requests*: "Pipelines must succeed" on; "Delete source branch" on by default.
- *Visibility*: Issues, Repository, CI/CD, Releases, Package registry on.

**Settings → CI/CD**
- *General pipelines*: timeout 2h; "Auto-cancel redundant pipelines" on.
- *Runners*: the project runner `mnemostxt-app` (green), and instance runners enabled.
- *Variables*: none — the signing key never goes to GitLab.

**Manage → Labels** (create once; the templates use them)

| Label | Colour | For |
|---|---|---|
| `bug` | #d63c3c | something broken |
| `feature` | #3a807a | something new |
| `android`, `desktop`, `web` | #4b5bb5 | which app |
| `release` | #a86a00 | release checklists |
| `docs` | #5c6b6a | documentation |

**Plan → Milestones** (optional): one per version (`0.0.3`), with its
issues. When the version is out, close the milestone; the release page links
to it if the milestone has the same name as the release.

## A change, start to finish

1. An issue (template *Bug* or *Feature*), labelled, maybe in a milestone.
2. A branch and a merge request (template *Default*): the checks run; add the
   change to `## [Unreleased]` in `CHANGELOG.md`.
3. Merge. When enough is in `[Unreleased]`: `sh scripts/release.sh`.
