<p align="center"><img src="assets/logo/mnemostxt.svg" width="96" alt=""></p>

<h1 align="center">MnemoTXT</h1>

<p align="center"><b>Just a notepad.</b> Tabs, a folder sidebar, Notepad++ keys and syntax highlighting for 140+ languages — on Linux, Windows, Android and the web.</p>

<p align="center"><sub>The app is called <b>MnemoTXT</b>; the command, package, repository and folders stay lowercase: <code>mnemostxt</code>.</sub></p>

<p align="center">
  <a href="https://gitlab.com/niharokz/mnemostxt/-/pipelines"><img src="https://gitlab.com/niharokz/mnemostxt/badges/main/pipeline.svg" alt="pipeline"></a>
  <a href="https://gitlab.com/niharokz/mnemostxt/-/releases"><img src="https://gitlab.com/niharokz/mnemostxt/-/badges/release.svg" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-MIT-3a807a" alt="MIT"></a>
</p>

| Download | |
|---|---|
| Windows | [mnemostxt-setup.exe](https://gitlab.com/niharokz/mnemostxt/-/releases/permalink/latest/downloads/mnemostxt-setup.exe) |
| Linux (Debian, Ubuntu) | [mnemostxt.deb](https://gitlab.com/niharokz/mnemostxt/-/releases/permalink/latest/downloads/mnemostxt.deb) |
| Android 8+ (arm64) | [mnemostxt.apk](https://gitlab.com/niharokz/mnemostxt/-/releases/permalink/latest/downloads/mnemostxt.apk) |
| Web | run your own server — see [Web app](#web-app) |

## What it is

- **A notepad, not an IDE.** No terminal, no plugins, no extensions.
- **Tabs** for open files; **Open editors** list; middle-click closes, drag reorders.
  A new tab is a **scratch file** at once (`<app folder>/scratch/`), so nothing
  typed is ever lost and it shows up on your other devices.
- **Folder sidebar** with nested folders that collapse and expand. Your **notes
  folder is always there**; on the desktop you can open more folders next to
  it, or open any file on your computer (File → Open, "Open with mnemostxt",
  `mnemostxt file.txt` or `m file.txt` in a terminal, or drag and drop).
- **Notepad++ key bindings** (see [docs/KEYBINDINGS.md](docs/KEYBINDINGS.md)):
  Ctrl+D duplicates a line, Ctrl+L cuts it, Ctrl+Q comments, F2 bookmarks,
  Alt+drag column selection, Ctrl+click multi-cursor, Ctrl+Shift+F find in
  files. Every key can be remapped (Preferences → Keyboard).
- **140+ languages** highlighted, plus Caddyfile, `.env` and batch files.
- **Themes**: nss dark and light, Solarized, Nord, Gruvbox, Dracula- and
  Monokai-style, High contrast — or your own colours (Preferences → Appearance).
- **Encodings and line endings**: UTF-8, UTF-8 BOM, UTF-16 LE/BE, ANSI; LF, CRLF, CR.
- **View** button for Markdown and CSV/TSV (Ctrl+Shift+V): a clean reading
  view, or a sortable, filterable table. Markdown preview beside the editor
  (Ctrl+Shift+M), and a viewer for images and PDFs.
- **Never loses work.** Unsaved edits survive closing (or crashing); a file
  changed by another program or device is never overwritten silently;
  Syncthing conflict copies are flagged.
- **One setting.** Everything lives in the notes folder's app folder
  (default `logs/mnemostxt/`: `settings.json`, trash, scratch, each device's
  open tabs), so the desktop, phone and web app look and behave the same.
  Nothing is written at the top of your notes folder.
- **Desktop**: optional tray (files open instantly), see-through background
  for picom and other compositors.
- **Android**: system folder picker, fingerprint/face/screen-lock lock,
  "Share to mnemostxt" into your inbox folder, and home-screen widgets:
  Recent files (2×2, 3×2, 4×2), Pinned note (2×2, 4×2), Quick capture (4×1),
  each with its own theme, opacity, text size and font.

## Web app

The web app edits only the notes folder, behind a sign-in.

```sh
git clone https://gitlab.com/niharokz/mnemostxt.git && cd mnemostxt
cp .env.example .env        # NOTE_PATH, MNEMOSTXT_USER, MNEMOSTXT_PASSWORD_HASH, MNEMOSTXT_SECRET
docker compose build
docker compose run --rm -T mnemostxt hash-password <<< 'your-password'   # → MNEMOSTXT_PASSWORD_HASH
docker network create homelab 2>/dev/null || true
docker compose up -d
```

An optional demo account (`MNEMOSTXT_DEMO_USER`, `MNEMOSTXT_DEMO_PASSWORD`)
sees built-in sample notes, read-only; the sign-in card offers it.

Point your reverse proxy at `mnemostxt:8080` on the `homelab` network
(Caddy: `reverse_proxy mnemostxt:8080`). The About page is at `/`, the editor
at `/app/`. All settings: [.env.example](.env.example).

## Layout

```
frontend/   the editor UI (Vite + CodeMirror 6), shared by every build
app/        the Tauri 2 app: Linux, Windows and Android (Rust commands for files)
server/     the web server (Go, one static binary) with the UI built in
scripts/    release (release.sh + release.conf), version checks, release builds, keystore, icons
docker/     the release builder image (deb + exe + apk on one Linux machine)
assets/     logo sources
docs/       key bindings, releasing, GitLab, the runner
```

How it fits together: [ARCHITECTURE.md](ARCHITECTURE.md).

## Develop

```sh
cd frontend && npm ci
npm run dev                    # http://localhost:5173 — in-memory demo files
npm test                       # unit tests

cd ../app && ../frontend/node_modules/.bin/tauri dev    # the desktop app (Linux needs libwebkit2gtk-4.1-dev)
cargo test

cd ../server && go test -mod=vendor ./...
```

## Build and release

Write changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md), then:

```sh
sh scripts/release.sh           # checks, bump, push, wait for CI, tag, wait for the build,
                                # verify the release and download links, deploy, report
```

A version tag builds all three installers on your own GitLab runner (the
shared gtlbrunner project) and publishes a release with permanent download
links. Build them by hand on any Linux machine with Docker:

```sh
sh scripts/make-keystore.sh     # once: the Android signing key, outside the repo
sh scripts/build-release.sh     # → dist/release/*.deb, *-setup.exe, *.apk
```

[docs/RELEASING.md](docs/RELEASING.md) · [docs/GITLAB.md](docs/GITLAB.md) · [docs/RUNNER.md](docs/RUNNER.md)

## Licence

MIT — see [LICENSE](LICENSE). JetBrains Mono is under the SIL Open Font Licence.
