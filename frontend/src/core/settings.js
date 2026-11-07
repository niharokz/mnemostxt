// The one settings file, shared by every mnemostxt (desktop, Android, web):
//   <notes folder>/logs/mnemostxt/settings.json  (the app folder can be changed)
// The app keeps nothing at the top of the notes folder.
// It travels with the notes (Syncthing), so all devices look and behave alike.
// Unknown keys are kept, so a newer version never loses an older one's values.
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
  fontSize: 14, // desktop and web
  mobileFontSize: 15, // phones
  fontFamily: '', // empty = JetBrains Mono (bundled)
  lineHeight: 1.55,
  lineNumbers: true,
  minimap: false,
  highlightActiveLine: true,
  showWhitespace: false,
  wordWrap: false,
  // editing
  tabSize: 4,
  indentWithTabs: false,
  autoCloseBrackets: true,
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
  // Android
  androidInbox: 'inbox', // where "Share to mnemostxt" saves (relative to the notes folder)
  androidLock: false, // ask for fingerprint, face or the screen lock
  androidLockAfterMinutes: 1, // …after this long in the background (0 = every time)
});

const ENUMS = { autosave: ['notes', 'all', 'off'], newFileEol: ['LF', 'CRLF'] };
const RANGES = {
  fontSize: [8, 40], mobileFontSize: [8, 40], lineHeight: [1, 3], tabSize: [1, 16], autosaveDelayMs: [200, 60000], backupDelayMs: [200, 10000],
  trashDays: [1, 3650], windowOpacity: [0.2, 1], readOnlyAboveMB: [1, 50], diskCheckSeconds: [5, 3600], recentlyClosedKept: [0, 200], androidLockAfterMinutes: [0, 1440],
};
// Strings that become file or folder names: letters, digits, dot, dash, underscore and "/" between parts.
const NAMEISH = { scratchFolder: /^[\w.-]+(\/[\w.-]+)*$/, scratchExtension: /^[A-Za-z0-9]{1,10}$/, androidInbox: /^[\w .-]+(\/[\w .-]+)*$/ };
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

export class Settings {
  constructor(backend) {
    this.backend = backend;
    this.values = { ...DEFAULTS };
    this.listeners = new Set();
    this.mtime = null;
    this.timer = null;
  }

  get path() {
    const root = this.backend.notesRoot;
    return root == null ? null : join(root, appDirOf(this.backend), SETTINGS_FILE);
  }

  get(k) { return this.values[k]; }
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
      const next = sanitize(JSON.parse(new TextDecoder().decode(bytes)));
      const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(this.values[k]));
      this.values = next;
      if (changed.length) this.emit(changed);
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

  set(patch) {
    const next = sanitize({ ...this.values, ...patch });
    const changed = Object.keys(patch).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(this.values[k]));
    if (!changed.length) return;
    this.values = next;
    this.emit(changed);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 300);
  }

  async save() {
    const p = this.path;
    if (!p) return;
    clearTimeout(this.timer);
    const body = JSON.stringify(this.values, null, 2) + '\n';
    try {
      await this.backend.mkdirAll(join(this.backend.notesRoot, appDirOf(this.backend)));
      const r = await this.backend.write(p, new TextEncoder().encode(body), null);
      this.mtime = r.mtime;
    } catch (e) {
      console.warn('settings: not saved —', e?.message || e);
    }
  }
}
