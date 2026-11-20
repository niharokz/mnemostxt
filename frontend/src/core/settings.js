// The one settings file, shared by every mnemostxt (desktop, Android, web):
//   <notes folder>/logs/mnemostxt/settings.json  (the app folder can be changed)
// The app keeps nothing at the top of the notes folder.
// It travels with the notes (Syncthing), so all devices look and behave alike.
// Unknown keys are kept, so a newer version never loses an older one's values.
//
// Per platform (0.1.0): "platforms": { "linux": { "windowOpacity": 0.85 } }
// overrides the shared values on that platform only (linux, windows, android,
// web). PER_PLATFORM settings always live there; any other one can be pinned
// to a platform in Preferences. Older versions just read the shared values.
import { join } from './paths.js';

// The app folder, relative to the notes folder. Every device should use the same
// one (it holds the shared settings and scratch files). Desktop and Android can
// change it in Preferences (kept per device, next to the notes folder path);
// the web server reads MNEMOSTXT_APP_DIR.
export const DEFAULT_APP_DIR = 'logs/mnemostxt';
export const SETTINGS_FILE = 'settings.json';
export const appDirOf = (backend) => backend.appDir || DEFAULT_APP_DIR;
export const trashDirOf = (backend) => appDirOf(backend) + '/trash';

export const DEFAULTS = Object.freeze({
  // appearance
  theme: 'nss-dark', // a theme id (core/themes.js or "themes" below) | system
  themeDark: 'nss-dark', // used by "system" when the OS is dark
  themeLight: 'nss-light', // used by "system" when the OS is light
  themes: {}, // your own themes: { "id": { "label": "…", "base": "nord", "keyword": "#ffcc00", … } }
  windowOpacity: 1, // desktop: 0.2–1; below 1 the window background is see-through (needs a compositor, e.g. picom)
  panelOpacity: 0, // desktop: sidebar, tabs, menus and status bar; 0 = a little more solid than the window, else 0.2–1
  fontSize: 14, // desktop and web
  mobileFontSize: 15, // phones
  fontFamily: '', // empty = JetBrains Mono (bundled)
  lineHeight: 1.55,
  lineNumbers: true,
  minimap: false,
  highlightActiveLine: true,
  showWhitespace: false,
  wordWrap: false,
  typewriter: false, // keep the line being typed in the middle of the window
  // editing
  tabSize: 4,
  indentWithTabs: false,
  autoCloseBrackets: true,
  spellcheck: false, // the browser's (or web view's) own spell checker, in the editor
  newFileEol: 'LF', // LF | CRLF
  trimTrailingWhitespaceOnSave: false,
  insertFinalNewlineOnSave: false,
  keybindings: {}, // { "command.id": ["Ctrl+Shift+D"] } replaces that command's keys; [] removes them (F1 lists the ids)
  // saving
  autosave: 'notes', // notes (files in the notes folder) | all | off
  autosaveDelayMs: 1000,
  backupDelayMs: 700, // how soon unsaved edits are copied for hot exit
  scratchFolder: 'scratch', // new, never-saved tabs are kept here (inside the app folder)
  scratchExtension: 'txt', // scratch_<device>_<date-time>.<this>
  historyKept: 10, // earlier versions kept per note (app folder/history); 0 = no history
  historyMinutes: 5, // at most one version per note this often
  // notes
  dailyFolder: 'daily', // "Today's note" lives here (relative to the notes folder): <this>/2026-11-17.md
  dailyTemplate: '# {date}\n\n', // text of a new daily note; {date} becomes the date
  // files
  showHidden: false,
  hidden: ['.git', '.trash', '.obsidian', '.stfolder', '.stversions', 'node_modules'],
  trashDays: 30,
  confirmDelete: true,
  markdownPreviewOnOpen: false,
  readOnlyAboveMB: 20, // larger files open read-only
  diskCheckSeconds: 15, // how often open files are checked for changes (web: at least 30)
  recentlyClosedKept: 20,
  // desktop
  keepInTray: false, // closing the window keeps mnemostxt in the tray, so files open instantly
  compareOptions: {}, // Compare window: { rules: { case, ws, blank }, filter: all | diffs, context, wrap } (remembered)
  // Android
  androidInbox: 'inbox', // where "Share to mnemostxt" saves (relative to the notes folder)
  androidLock: false, // ask for fingerprint, face or the screen lock
  androidLockAfterMinutes: 1, // …after this long in the background (0 = every time)
  androidSecure: false, // hide the app's content in Recents and block screenshots
  androidIcon: 'black', // the launcher icon's background: black | white
  // per platform: { "linux": { … }, "windows": { … }, "android": { … }, "web": { … } }
  platforms: {},
});

// Always per platform: what looks or works differently on each system.
export const PER_PLATFORM = new Set(['windowOpacity', 'panelOpacity', 'fontFamily', 'keepInTray', 'androidIcon']);
export const PLATFORM_LABEL = { linux: 'Linux', windows: 'Windows', android: 'Android', macos: 'macOS', web: 'the web app', demo: 'the demo' };

const ENUMS = { autosave: ['notes', 'all', 'off'], newFileEol: ['LF', 'CRLF'], androidIcon: ['black', 'white'] };
const RANGES = {
  fontSize: [8, 40], mobileFontSize: [8, 40], lineHeight: [1, 3], tabSize: [1, 16], autosaveDelayMs: [200, 60000], backupDelayMs: [200, 10000],
  trashDays: [1, 3650], windowOpacity: [0.2, 1], panelOpacity: [0, 1], readOnlyAboveMB: [1, 50], diskCheckSeconds: [5, 3600], recentlyClosedKept: [0, 200], androidLockAfterMinutes: [0, 1440],
  historyKept: [0, 500], historyMinutes: [0, 1440],
};
// Strings that become file or folder names: letters, digits, dot, dash, underscore and "/" between parts.
const NAMEISH = { scratchFolder: /^[\w.-]+(\/[\w.-]+)*$/, scratchExtension: /^[A-Za-z0-9]{1,10}$/, androidInbox: /^[\w .-]+(\/[\w .-]+)*$/, dailyFolder: /^[\w .-]+(\/[\w .-]+)*$/ };
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const LEGACY_THEME = { dark: 'nss-dark', light: 'nss-light' };

// Merges raw JSON onto the defaults, dropping values of the wrong type.
export function sanitize(raw) {
  const out = { ...DEFAULTS };
  if (!isPlainObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in DEFAULTS)) { out[k] = v; continue; }
    const d = DEFAULTS[k];
    if (Array.isArray(d)) { if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = v; continue; }
    if (isPlainObject(d)) { if (isPlainObject(v)) out[k] = v; continue; }
    if (typeof v !== typeof d) continue;
    if (ENUMS[k] && !ENUMS[k].includes(v)) continue;
    if (NAMEISH[k] && (!NAMEISH[k].test(v) || v.split('/').includes('..'))) continue;
    if (RANGES[k]) { const [lo, hi] = RANGES[k]; if (!Number.isFinite(v)) continue; out[k] = Math.min(hi, Math.max(lo, v)); continue; }
    out[k] = v;
  }
  for (const k of ['theme', 'themeDark', 'themeLight']) out[k] = LEGACY_THEME[out[k]] || out[k];
  return out;
}

// The valid part of one platform's overrides (a wrong value is dropped, so the
// shared one applies, not the default).
function cleanOverrides(over) {
  if (!isPlainObject(over)) return {};
  const s = sanitize(over);
  const out = {};
  for (const [k, v] of Object.entries(over)) {
    if (k === 'platforms') continue;
    if (!(k in DEFAULTS)) { out[k] = v; continue; }
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    if (!same(s[k], DEFAULTS[k]) || same(v, DEFAULTS[k])) out[k] = s[k];
  }
  return out;
}

// The values that apply on `platform`: the shared ones, then its overrides.
export function effective(raw, platform) {
  const over = cleanOverrides(raw.platforms?.[platform]);
  return Object.keys(over).length ? { ...raw, ...over, platforms: raw.platforms } : raw;
}

export class Settings {
  constructor(backend) {
    this.backend = backend;
    this.platform = backend.platform || 'web';
    this.raw = { ...DEFAULTS }; // as in the file: shared values plus "platforms"
    this.values = { ...DEFAULTS }; // what applies here
    this.listeners = new Set();
    this.mtime = null;
    this.timer = null;
  }

  get path() {
    const root = this.backend.notesRoot;
    return root == null ? null : join(root, appDirOf(this.backend), SETTINGS_FILE);
  }

  get(k) { return this.values[k]; }
  get platformLabel() { return PLATFORM_LABEL[this.platform] || this.platform; }
  perPlatform(k) { return PER_PLATFORM.has(k); }
  // set for this platform only (always true for PER_PLATFORM settings once changed)
  pinned(k) { const o = this.raw.platforms?.[this.platform]; return isPlainObject(o) && Object.hasOwn(o, k); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(keys) { for (const fn of this.listeners) fn(keys, this.values); }

  async load() {
    const p = this.path;
    if (!p) return;
    try {
      const st = await this.backend.stat(p);
      if (!st) return; // first run: defaults until something changes
      const { bytes, mtime } = await this.backend.read(p);
      this.mtime = mtime;
      this.raw = sanitize(JSON.parse(new TextDecoder().decode(bytes)));
      this.apply();
    } catch (e) {
      console.warn('settings: using defaults —', e?.message || e);
    }
  }

  // Re-reads the file when another device (or the user, by hand) changed it.
  async refresh() {
    const p = this.path;
    if (!p) return;
    const st = await this.backend.stat(p).catch(() => null);
    if (st && st.mtime !== this.mtime) await this.load();
  }

  // Recomputes what applies here; emits the keys whose value changed.
  apply() {
    const next = effective(this.raw, this.platform);
    const changed = Object.keys({ ...next, ...this.values }).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(this.values[k]));
    this.values = next;
    if (changed.length) this.emit(changed);
    return changed;
  }

  // Changes settings: a pinned or per-platform one changes for this platform
  // only, every other one for all devices.
  set(patch) {
    const shared = {}, mine = {};
    for (const [k, v] of Object.entries(patch)) (this.perPlatform(k) || this.pinned(k) ? mine : shared)[k] = v;
    const platforms = { ...this.raw.platforms };
    if (Object.keys(mine).length) platforms[this.platform] = { ...cleanOverrides(platforms[this.platform]), ...cleanOverrides(mine) };
    this.update(sanitize({ ...this.raw, ...shared, platforms }));
  }

  // Pins a setting to this platform (keeps its current value) or, with
  // on = false, lets this platform use the shared value again.
  pin(k, on = true) {
    if (this.perPlatform(k) && !on) return;
    const platforms = { ...this.raw.platforms };
    const mine = { ...cleanOverrides(platforms[this.platform]) };
    if (on) mine[k] = this.values[k]; else delete mine[k];
    if (Object.keys(mine).length) platforms[this.platform] = mine; else delete platforms[this.platform];
    this.update(sanitize({ ...this.raw, platforms }));
  }

  update(raw) {
    const before = JSON.stringify(this.raw);
    this.raw = raw;
    this.apply();
    if (JSON.stringify(raw) === before) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 300);
  }

  async save() {
    const p = this.path;
    if (!p) return;
    clearTimeout(this.timer);
    const raw = { ...this.raw };
    if (!Object.keys(raw.platforms || {}).length) delete raw.platforms; // no empty section in the file
    const body = JSON.stringify(raw, null, 2) + '\n';
    try {
      await this.backend.mkdirAll(join(this.backend.notesRoot, appDirOf(this.backend)));
      const r = await this.backend.write(p, new TextEncoder().encode(body), null);
      this.mtime = r.mtime;
    } catch (e) {
      console.warn('settings: not saved —', e?.message || e);
    }
  }
}
