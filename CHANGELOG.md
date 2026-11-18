# Changelog

All notable changes to mnemostxt, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format; versions follow [Semantic Versioning](https://semver.org/). One version
covers every build (Linux, Windows, Android, web).

Write what you change under **[Unreleased]** as you go. `sh scripts/release.sh`
turns that section into the new version, and the release page on GitLab shows it.

## [Unreleased]

## [0.0.7] - 2026-11-18

### Added

- Two themes: **Paper** (light, warm paper with ink-brown accents) and
  **Charcoal** (dark, neutral grey with ember accents), also for the Android
  widgets. View → Theme, or the theme name in the status bar.
- `scripts/deploy.sh`: deploys the web app on its own (`--check` only checks).
- `release.sh --continue`: a release that stopped after its tag is finished
  (waits for its build, checks it, deploys) without a new version.

### Changed

- The web app deploy no longer takes it down for the build: the new image is
  built while the old container serves, the switch takes seconds, and if the
  new one does not answer within 90 s the previous image is put back. It waits
  while a release build runs on the same machine.
- `release.sh` shows every GitLab job as it starts and ends (time, link,
  report-only jobs marked), and the release build's own steps as they finish.
- A push that reaches GitLab but fails for another push address (a mirror
  that is down) is a warning, no longer a stop.

## [0.0.6] - 2026-11-18

### Changed

- Release builder image 5 (`mnemostxt-builder:5`) compiles nothing: cargo-xwin
  is the checked (sha256) prebuilt, the Rust base is pinned (1.97.0-bookworm),
  and downloads run niced with at most 2 jobs.
- The release build limits itself: CPUs from the job's quota, else all but 3
  (never all of them); cargo, Gradle, make and Node stay within that; planned
  memory at most 70 % of the cap; thin LTO unless the cap is 10 GB or more and
  `MNEMOSTXT_FAT_LTO=1`; nice 10 and idle I/O; targets one after another with
  Gradle and Kotlin daemons stopped between them. One `limits:` line at the
  start shows it all.
- The build pauses while the CPU is at 85 °C or more and goes on below 75 °C
  (`MNEMOSTXT_TEMP_PAUSE`, `MNEMOSTXT_TEMP_RESUME`; 0 turns it off).
- Out of memory (exit 137) now says the cap, the step and how to fix it.
- `scripts/build-release.sh` gives the container all CPUs but 3.

## [0.0.5] - 2026-11-18

### Added

- **Links between notes**: `[[note]]`, `[[note|text]]`, `[[note#heading]]`, with
  completion after `[[`. Click one in the View, or Alt+Enter in the editor; a
  link to a missing note offers to create it. New **Notes** menu: Notes that
  link here, Find tag (`#tag`), Go to file (Ctrl+Shift+O, fuzzy), Go to heading
  (Ctrl+Shift+G), Today's note (Alt+D, `daily/<date>.md`, folder and template
  in settings).
- **Encrypted notes** (Notes → Encrypt this note): AES-256-GCM with a passphrase
  that is asked once per app start and never stored. The status bar shows 🔒;
  Lock encrypted notes forgets the passphrase. Unsaved edits and history of an
  encrypted note are never kept in plain text.
- **History**: earlier versions of each note are kept in the app folder as you
  save (File → History…, at most `historyKept` per note, one every
  `historyMinutes`). Compare any version with the current text and restore it
  (Ctrl+Z undoes).
- **Sync conflicts compared**: a Syncthing conflict copy shows a banner with
  Compare: the two versions side by side, then Keep mine or Use theirs (the copy
  goes to the trash).
- **Replace all** in Find in files: open files change in their tabs (undoable),
  others on disk (their old text is kept in History).
- **CSV editing in the View**: double-click a cell to change it (only that cell
  changes in the file); + Row adds a row.
- Focus mode (Ctrl+Alt+Z), typewriter scrolling, spell check, word count in the
  status bar.
- Export a markdown note as one HTML file (images built in); print the rendered
  note (the print dialog saves a PDF).
- Android: a Quick capture tile for the quick settings; launcher shortcuts New
  note and Today's note; Preferences → This device → Hide in Recents and block
  screenshots.
- Web: install it from the browser (opens offline, appears in the share menu;
  shared text opens in a new tab).
- Web: optional authenticator code at sign-in (`MNEMOSTXT_TOTP_SECRET`; make
  one with `mnemostxt totp-secret`).
- Releases: `SHA256SUMS.sig` when a signing key is in the runner's key folder;
  CI runs `npm audit`, `govulncheck`, `cargo audit` and `gitleaks` (report only).

### Changed

- Rendered markdown is stricter: scripts, styles, forms, frames, inline styles
  and event handlers are removed (a note may come from another device).
- Desktop: the app never reads or writes credential stores (`~/.ssh`,
  `~/.gnupg`, `~/.aws`, password stores, browser profiles, keyrings…) and never
  writes system folders, whatever the window asks; Find in files skips them.
  The CSP also blocks plugins, frames and form posts.
- Web: files are opened through an `os.Root` handle on the notes folder (Go
  1.24), so a symlink swapped in at the wrong moment still cannot lead outside.
- Web: the sign-in cookie is SameSite=Strict; more security headers (HSTS over
  HTTPS, COOP/CORP, Permissions-Policy, `no-referrer`); warnings at start for a
  plain password or a short `MNEMOSTXT_SECRET`.
- Web container: limits on processes (256) and memory (512 MB).
- The builder image is labelled `nih.ar.keep=true`, so a filtered
  `docker image prune` keeps it.

### Fixed

- Web: a client could avoid the sign-in limit by sending its own
  `X-Forwarded-For`. Forwarding headers now count only from a trusted proxy
  (`MNEMOSTXT_TRUSTED_PROXIES`, default: private ranges such as the Docker
  network).
- Android: Share accepted `file://` links, so another app could make MnemoTXT
  copy its own private files into the inbox. Only other apps' `content://`
  links are taken now, up to 200 MB a file.
- Android: any app could ask MnemoTXT to open any path through the widget
  intent; only files inside the notes folder are opened now.
- Android: app data was included in Android backups; it no longer is.

## [0.0.4] - 2026-11-10

### Added

- **View** button for Markdown and CSV/TSV files (top bar, phone: the eye; or
  Ctrl+Shift+V). Markdown opens as a clean reading view; CSV and TSV as a table
  with a sticky header, row numbers, numbers aligned right, click a column to
  sort, and a filter box. Edit (or a double-click) goes back to the editor.
  Each tab remembers its mode across restarts.

### Changed

- The app is called **MnemoTXT** everywhere you see its name: window title,
  menus, About, sign-in and About pages, the Android launcher, share menu and
  widgets, the Windows Start menu and "Open with", the Linux menu and tray.
  The command, package, repository, folders and settings keep the lowercase
  `mnemostxt`, so installs upgrade in place.

## [0.0.3] - 2026-11-07

### Added

- **Android home-screen widgets**: long-press the home screen → Widgets → mnemostxt.
  - *Recent files* (2×2, 3×2, 4×2): the newest files of the notes folder or a
    folder you choose; tap one to open it, **+** for a new tab, ⟳ to refresh.
  - *Pinned note* (2×2, 4×2): one note's text, scrollable; tap to open it.
  - *Quick capture* (4×1): tap, type, Save — the note lands in
    `inbox/<date>_<time>.md`, like "Share to mnemostxt".
- Each widget has its own settings (when it is added; later by long-press →
  settings or a tap on its title): theme (like the app, like the phone, or any
  built-in theme), background opacity, text size, font (sans or monospace),
  the folder or note, and whether its text hides while the app lock is on
  (on by default for Pinned note).
- Widgets redraw when you leave the app, after saving, after a share or a
  capture, every 30 minutes, and with ⟳.

### Changed

- Android: a widget tap opens the file in the running app instead of a new
  copy (the app's activity is now single-task).

### Added

- **Android home-screen widgets**: long-press the home screen → Widgets → mnemostxt.
  - *Recent files* (2×2, 3×2, 4×2): the newest files of the notes folder or a
    folder you choose; tap one to open it, **+** for a new tab, ⟳ to refresh.
  - *Pinned note* (2×2, 4×2): one note's text, scrollable; tap to open it.
  - *Quick capture* (4×1): tap, type, Save — the note lands in
    `inbox/<date>_<time>.md`, like "Share to mnemostxt".
- Each widget has its own settings (when it is added; later by long-press →
  settings or a tap on its title): theme (like the app, like the phone, or any
  built-in theme), background opacity, text size, font (sans or monospace),
  the folder or note, and whether its text hides while the app lock is on
  (on by default for Pinned note).
- Widgets redraw when you leave the app, after saving, after a share or a
  capture, every 30 minutes, and with ⟳.

### Changed

- Android: a widget tap opens the file in the running app instead of a new
  copy (the app's activity is now single-task).

## [0.0.2] - 2026-11-07

### Added

- **Themes**: nss dark and light, Solarized dark and light, Nord, Gruvbox,
  Dracula-style, Monokai-style and High contrast (View → Theme, or click the
  theme name in the status bar). "Follow system" picks one theme for a dark
  system and one for a light one.
- **Your own themes**, stored in `settings.json` → `"themes"`, so every device
  has them: Preferences → Appearance → *Copy and edit* opens a colour editor
  (interface, editor and 27 syntax colours). Each colour you leave alone follows
  the theme it is based on.
- **More syntax colours**: control flow, escapes, constants, built-ins, classes,
  namespaces, attributes, operators, labels and diff lines each have their own.
- **Scratch files**: a new tab becomes `scratch_<device>_<date-time>.txt` in
  `<app folder>/scratch/` on its first keystroke and is saved automatically, so
  it reaches your other devices. *Save as…* moves it where you want; closing it
  keeps it (an empty one is removed). Choosing a language changes its extension.
  File → Scratch folder shows them.
- **Remappable keys**: Preferences → Keyboard, or `settings.json` →
  `"keybindings"` (e.g. `"edit.duplicate": ["Ctrl+Shift+D"]`).
- **Preferences in sections** (Appearance, Editor, Saving, Files, Keyboard, This
  device), with new settings: font, window opacity, backup delay, scratch folder
  and extension, read-only size, disk-check interval, recently-closed count, tray,
  Android inbox and lock. Everything is also in `settings.json`.
- **This device**: a device name (used in scratch file names) and the app folder
  are kept per device; the app folder defaults to `logs/mnemostxt`.
- **Desktop: see-through window** (Preferences → Appearance → Window opacity),
  for picom and other compositors.
- **Desktop: keep running in the tray**, so opening a file is instant. Quit from
  the tray icon or File → Exit. Linux needs `libayatana-appindicator3-1`
  (recommended by the .deb).
- **Linux: `m file.txt`** opens files from a terminal and returns the prompt.
- **Android: folder picker** (the system one) for the notes folder.
- **Android: lock** with fingerprint, face or the screen lock, at start and after
  a chosen time in the background (default 1 minute).
- **Android: "Share to mnemostxt"** saves shared text as
  `inbox/<date>_<time>.md` and shared files under their own names.
- **Android: permissions** in Preferences → This device (All files access, app info).
- **Web: demo account** (`MNEMOSTXT_DEMO_USER`, `MNEMOSTXT_DEMO_PASSWORD`):
  built-in sample notes, read-only, offered on the sign-in card only.
- **Web: `MNEMOSTXT_PASSWORD_HASH`**, like the other apps (`MNEMOSTXT_PASSWORD`
  still works), plus `MNEMOSTXT_APP_DIR` and `MNEMOSTXT_LANDING`.
- **Release tooling**: `sh scripts/release.sh [patch|minor|major]` runs the
  checks, bumps the version, pushes, waits for both pipelines, verifies the
  release and its download links, deploys the web app and prints a status
  report (`scripts/release.conf`, docs/RELEASING.md).

### Changed

- **Faster file opening on the desktop**: file bytes cross to the editor raw
  instead of as base64 text.
- **Unsaved edits and open tabs** (hot exit) now live in the notes folder too:
  `<app folder>/state/<device>/` (they were in the app's data folder). The
  first start takes the old ones over.
- **Web sign-in and About page** look like Natlas and Arthik (Username,
  Password, demo box, "← About mnemostxt"; cards, apps table, "Run your own").
- The web app keeps each account's tabs separately in the browser.
- `.deb`, setup.exe and .apk builds from a runner in its own Docker project
  (gtlbrunner), shared by all apps (runner tag `mnemostxt-app`).
- Builder image 4: NSIS tools and `RestartManager.nsh` built in (no downloads
  during a build), Android SDK platform 37, readable CI logs (one ✓ line per
  step, details collapsed, full logs in the job artifacts).

### Fixed

Fixes released as patches after 0.0.1, now part of 0.0.2:

- `0.0.1-fix`: settings and trash moved from the top of the notes folder to
  `logs/mnemostxt/`.
- `0.0.1-runner`, `-all`: release builds on the Docker-executor runner with the
  signing key mounted read-only.
- `0.0.1-nsis`, `-nsis2`: Windows installer builds (missing `RestartManager.nsh`
  in Debian's NSIS; Tauri's NSIS helper no longer downloaded per build).
- `0.0.1-android`, `-android2`: Android release signing without
  `java.util.Properties` (Gradle Kotlin DSL), and the Gradle build task calling
  the real Tauri CLI.
- `0.0.1-logs`: readable release logs; builder image 4.
- Protected `v*` tags: RELEASING.md explains re-tagging.

### Removed

- The concept art (`inspiration/`), the mnemos handoff, the migration notes and
  the runner's compose files (now the separate gtlbrunner project).

## [0.0.1] - 2026-11-07

First release. mnemostxt replaces mnemos.

### Added

- Notepad for Linux (.deb), Windows (setup.exe) and Android (.apk), plus the
  web app (Docker) for the notes folder.
- Tabs, folder sidebar with nested folders, open editors list, find in files.
- The notes folder is always in the sidebar; other folders can be opened next
  to it (desktop).
- Notepad++ key bindings, line operations, bookmarks, column selection,
  multi-cursor, encodings (UTF-8, UTF-8 BOM, UTF-16, ANSI) and line endings.
- Syntax highlighting for 140+ languages (plus Caddyfile, .env, batch).
- Markdown preview, image and PDF viewer.
- One settings file shared by every device: `<notes>/logs/mnemostxt/settings.json`.
- Hot exit: unsaved edits survive closing (or killing) the app.
- Changes on disk are detected; saving never overwrites them silently.
- Syncthing conflict copies are flagged.
- Trash in `<notes>/logs/mnemostxt/trash` with "Empty trash" after N days.
- Collapsible menu bar (Alt opens it), nss dark and light themes.
- Web: sign-in with rate limiting and bans, home page with download links.

[Unreleased]: https://gitlab.com/niharokz/mnemostxt/-/compare/v0.0.7...main
[0.0.7]: https://gitlab.com/niharokz/mnemostxt/-/compare/v0.0.6...v0.0.7
[0.0.6]: https://gitlab.com/niharokz/mnemostxt/-/compare/v0.0.5...v0.0.6
[0.0.5]: https://gitlab.com/niharokz/mnemostxt/-/compare/v0.0.4...v0.0.5
[0.0.4]: https://gitlab.com/niharokz/mnemostxt/-/compare/v0.0.3...v0.0.4
[0.0.3]: https://gitlab.com/niharokz/mnemostxt/-/compare/v0.0.2...v0.0.3
[0.0.2]: https://gitlab.com/niharokz/mnemostxt/-/compare/v0.0.1...v0.0.2
[0.0.1]: https://gitlab.com/niharokz/mnemostxt/-/releases/v0.0.1
