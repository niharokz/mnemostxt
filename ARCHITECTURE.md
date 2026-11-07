# Architecture

One editor UI, three ways to reach files.

```
                ┌────────────────────── frontend/ (Vite, CodeMirror 6) ──────────────────────┐
                │  ui/app.js      documents, saving, autosave, hot exit, disk-change checks   │
                │  ui/shell.js    layout: menu bar, sidebar, tabs, editor, preview, status    │
                │  ui/commands.js every action + its Notepad++ shortcut (menus read it too)    │
                │  backend/*      one interface, three implementations                         │
                └──────────────┬─────────────────────────┬──────────────────────┬─────────────┘
              tauri.js (invoke; raw bytes)         web.js (fetch /api)     memory.js (demo/tests)
              + android.js (JS bridge)                   │
                               │                         │
            app/ (Tauri 2, Rust) — Linux, Windows,   server/ (Go) — the notes folder only,
            Android: any file the user opens         behind a sign-in (+ a read-only demo)
```

## The app folder

Everything mnemostxt keeps lives inside the notes folder, in one app folder
(default `logs/mnemostxt`; per device in Preferences → This device, on the
server `MNEMOSTXT_APP_DIR`; every device should use the same). Syncthing carries
it along; nothing is written at the top of the notes folder.

```
<notes>/logs/mnemostxt/
  settings.json                       shared settings (themes, keybindings … everything)
  trash/  .mnemostxt-trash.tsv        notes moved to trash, and where they came from
  scratch/scratch_<device>_<date-time>.txt
                                      new tabs, saved as you type; shared by all devices
  state/<device>/session.json         that device's open tabs, cursors, folders, layout
  state/<device>/backups/<id>.txt     that device's unsaved edits of open files
```

Per device, outside the notes folder: the notes folder path, the device name
and the app folder (`bootstrap.json` in the app's config folder). The web app
keeps session and backups in the browser, per account.

## Frontend (`frontend/src`)

| Path | What it does |
|---|---|
| `main.js` | start-up: backend → sign-in (web) → notes folder (first run) → settings → session → UI |
| `core/settings.js` | the one settings file, `<app folder>/settings.json`; every default with a comment; values are sanitised, unknown keys kept |
| `core/themes.js` | built-in themes, user themes (`settings.json` → `themes`, each with a `base`), → CSS variables `--nss-*`, `--ed-*`, `--syn-*`; window opacity |
| `core/store.js` | session, backups and scratch file names in the app folder (web: the browser) |
| `core/encoding.js` | bytes ↔ text: UTF-8 (BOM), UTF-16 LE/BE, ANSI (Windows-1252); line-ending detection |
| `core/languages.js` | language detection (file name, shebang) and the A–Z Language menu |
| `core/keys.js` | keyboard events → "Ctrl+Shift+S" strings; `keybindings` overrides |
| `editor/extensions.js` | the CodeMirror setup per document; settings live in compartments |
| `editor/lineops.js` | Notepad++ line operations (pure functions, unit-tested) |
| `editor/bookmarks.js` | Ctrl+F2 / F2 bookmarks in a gutter |
| `ui/app.js` | open/save/close, autosave, conflict checks, hot exit, trash |
| `ui/commands.js` | the command table and the capture-phase key handler |
| `ui/menu.js` | menu bar, collapsed ≡ menu, phone drill-down menu |
| `ui/tree.js`, `ui/tabs.js`, `ui/statusbar.js`, `ui/search.js`, `ui/preview.js`, `ui/viewer.js` | the panels |
| `ui/settingsSheet.js` | Preferences in sections, the theme colour editor, the key editor, per-device settings |
| `ui/login.js` | the web sign-in card (and the demo box) |
| `backend/android.js` | `window.MnemostxtAndroid`: folder picker, lock, permission screens, share settings |
| `styles/nss-app.css` | the shared nss tokens and components (copied unchanged from the other apps) |

Each tab keeps its own `EditorState` (undo history, folds, bookmarks); the one
`EditorView` swaps between them.

### Backend interface

Every backend has the same async methods; paths always use `/`:

| Method | Notes |
|---|---|
| `list(dir)` | `[{name, dir, size, mtime}]` |
| `read(path)` | `{bytes, mtime, size}` |
| `write(path, bytes, expectedMtime)` | rejects with code `CONFLICT` when the file changed on disk |
| `stat(path)` | `{dir, size, mtime}` or `null` |
| `mkdirAll`, `createFile`, `rename`, `trash`, `trashPurge(days)`, `search(roots, q, opts)` | |
| `remove(path)` | deletes one file, **only inside the app folder** (state, backups, empty scratch) |
| `loadSession`, `saveSession`, `backupWrite/Read/Delete/List` | the backend's own hot-exit storage (web: the browser; desktop: 0.0.1's, read once) |
| `appDir`, `deviceName`, `setDeviceConfig` | the app folder and this device's name (desktop, Android) |

Errors carry a code: `CONFLICT NOT_FOUND EXISTS DENIED TOO_LARGE INVALID AUTH OFFLINE IO`.

## Saving, conflicts and hot exit

- **Save** writes the whole file with the modification time it was read at.
  If the file changed meanwhile, the save is refused and the user chooses
  *Overwrite* or *Reload theirs*.
- **Autosave** (default: files in the notes folder) saves `autosaveDelayMs`
  (1 s) after typing stops. Scratch files are always autosaved.
- **Scratch**: a new tab becomes `scratch/scratch_<device>_<date-time>.txt` on
  its first keystroke. *Save as* moves it out; closing keeps it (empty ones go).
- **Disk checks** run on window focus and every `diskCheckSeconds` (15 s; web
  at least 30 s): a clean document reloads quietly; an edited one shows a banner.
- **Hot exit**: every unsaved document is backed up `backupDelayMs` (0.7 s)
  after a change into `state/<device>/backups/` (web: the browser). The session
  (tabs, cursors, folders, layout) goes to `state/<device>/session.json`. On
  start both are restored, so closing — or a crash — never loses typing.
- **Writes are atomic**: a temp file next to the target, then a rename. Symlinks
  are followed (a linked `.env` stays a link) and permissions are kept.

## Desktop and Android (`app/`)

Tauri 2. `src/lib.rs` registers async commands (they run off the UI thread):

| Module | |
|---|---|
| `files.rs` | list, read, write (atomic + conflict check), stat, create, rename, remove (app folder only), trash, purge |
| `search.rs` | find in files (skips the app folder, hidden names, binary files, files over 4 MB, symlinked folders) |
| `session.rs` | `bootstrap.json` (notes folder, app folder, device name); 0.0.1's session and backups |
| `tray.rs` | the optional tray icon (desktop) |
| `util.rs` | error codes, path normalising, "is inside" checks, URL decoding, device names |

**Fast file opening**: `read_raw` answers with raw bytes (8 bytes of
modification time, then the file) and `write_raw` takes the file as the raw
request body (path and expected time in headers) — no base64, no JSON. Android
and any web view that cannot do this use `read_file` / `write_file` (base64).

Desktop extras: single instance (a second launch passes its files to the open
window, also from the tray), window size/position remembered, an optional tray
(closing then only hides the window), a transparent window for the opacity
setting, `.deb` desktop entry with `%F` and `/usr/bin/m` (`m file.txt`),
Windows installer adds "Open with mnemostxt" for every file and folder
(`windows/hooks.nsh`).

Android: the project in `app/gen/android` is generated by `tauri android init`
and patched by `scripts/android-prepare.py`: All files access, our
`MainActivity.kt` (insets, folder picker, lock, the `MnemostxtAndroid` bridge),
`ShareActivity.kt` (share target), androidx.biometric, a ProGuard rule for the
bridge, icons, release signing. It is not committed.

- **Lock**: the phone's own lock through BiometricPrompt (fingerprint, face,
  or PIN/pattern/password), at start and after `androidLockAfterMinutes` in the
  background. A cover hides the app until it succeeds. mnemostxt stores no PIN.
- **Share**: `ShareActivity` writes into `<notes>/<androidInbox>` (text as
  `<date>_<time>.md`, files under their names) using the folder the app last
  told it (`configure`), and closes.

## Web (`server/`)

Go, standard library plus vendored bcrypt; one static binary in a `scratch`
image. `internal/vault` jails every path inside the notes folder (lexical check
plus symlink resolution). `internal/auth` handles the sign-in (owner and an
optional demo account), sessions and bans. The built frontend is embedded
(`web/dist`), and so are the About page and the demo's sample notes
(`web/demo`, copied to `/state/demo-notes` at start and opened read-only).

| Route | |
|---|---|
| `GET /` | About page with download links (`MNEMOSTXT_LANDING=false`: straight to the app) |
| `GET /app/` | the editor |
| `POST /api/login`, `POST /api/logout`, `GET /api/me` | sign-in |
| `GET /api/info`, `list`, `stat`, `file`, `search` | read |
| `PUT /api/file?path=&expect=`, `DELETE /api/file` (app folder only), `POST /api/mkdir`, `create`, `rename`, `trash`, `trash/purge` | change (need `X-Mnemostxt` header, same origin; refused for the demo) |
| `GET /health` | Docker health check |

## Trash

Deleting moves an item to `<app folder>/trash/` and appends a line to
`trash/.mnemostxt-trash.tsv` (`name⇥original path⇥unix time`). Settings →
Empty trash deletes items older than `trashDays`. Files outside the notes
folder (desktop) go to the system trash.

## Versions

`VERSION`, `frontend/package.json`, `app/Cargo.toml` and `app/tauri.conf.json`
must agree, and `CHANGELOG.md` needs a `## [X.Y.Z]` section;
`scripts/check-version.sh` checks it in CI. `scripts/release.sh` bumps them all
together (docs/RELEASING.md). The Android versionCode is derived from the
version by Tauri.
