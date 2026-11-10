# Changelog

All notable changes to mnemostxt, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format; versions follow [Semantic Versioning](https://semver.org/). One version
covers every build (Linux, Windows, Android, web).

Write what you change under **[Unreleased]** as you go. `sh scripts/release.sh`
turns that section into the new version, and the release page on GitLab shows it.

## [Unreleased]

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

[Unreleased]: https://gitlab.com/niharokz/mnemostxt/-/compare/v0.0.4...main
[0.0.4]: https://gitlab.com/niharokz/mnemostxt/-/compare/v0.0.3...v0.0.4
[0.0.3]: https://gitlab.com/niharokz/mnemostxt/-/compare/v0.0.2...v0.0.3
[0.0.2]: https://gitlab.com/niharokz/mnemostxt/-/compare/v0.0.1...v0.0.2
[0.0.1]: https://gitlab.com/niharokz/mnemostxt/-/releases/v0.0.1
