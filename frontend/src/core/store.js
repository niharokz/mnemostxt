// Where the app keeps its own working files, all inside the app folder of the
// notes folder (default logs/mnemostxt), so nothing lives elsewhere and
// Syncthing carries it along:
//
//   settings.json                  shared settings (core/settings.js)
//   trash/                         notes moved to trash
//   scratch/scratch_<device>_<date-time>.txt
//                                  new tabs that were never saved; shared, so a
//                                  scratch started on the laptop opens on the phone
//   state/<device>/session.json    this device's open tabs and layout (hot exit)
//   state/<device>/backups/<id>.txt
//                                  unsaved edits of open files, restored on start
//
// The web app keeps session and backups in the browser (localStorage) instead:
// they belong to that browser, not to the server.
import { join, isInside } from './paths.js';
import { appDirOf } from './settings.js';

const ID_RE = /^[a-z0-9]{1,64}$/;

// "Nihar's ThinkPad" -> "Nihars-ThinkPad"; used in file names.
export function deviceSlug(name) {
  const s = String(name || '').normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/_/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s.slice(0, 40) || 'device';
}

// 2026-11-07 14:03:09 -> "20261107-140309" (local time)
export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export class Store {
  constructor(backend, settings) {
    this.backend = backend;
    this.settings = settings;
    // the web app (and the in-memory demo) use the backend's own session storage
    this.files = backend.kind !== 'web' && !backend.demo && typeof backend.remove === 'function';
  }

  get device() { return deviceSlug(this.backend.deviceName || this.backend.platform); }
  get appDir() { return this.backend.notesRoot == null ? null : join(this.backend.notesRoot, appDirOf(this.backend)); }
  get stateDir() { return this.appDir && join(this.appDir, 'state', this.device); }
  get scratchDir() { return this.appDir && join(this.appDir, this.settings.get('scratchFolder')); }
  get usable() { return this.files && this.appDir != null; }

  isScratch(path) { return !!path && this.scratchDir != null && isInside(path, this.scratchDir); }

  // A fresh scratch file name for this device.
  async newScratchPath(ext = this.settings.get('scratchExtension')) {
    const dir = this.scratchDir;
    if (!dir) return null;
    const base = `scratch_${this.device}_${stamp()}`;
    for (let i = 0; i < 100; i++) {
      const p = join(dir, `${base}${i ? '-' + (i + 1) : ''}.${ext}`);
      if (!(await this.backend.stat(p).catch(() => null))) return p;
    }
    return join(dir, `${base}-${Date.now()}.${ext}`);
  }

  // ── session ──────────────────────────────────────────────
  async loadSession() {
    if (!this.usable) return this.backend.loadSession();
    const p = join(this.stateDir, 'session.json');
    try {
      if (await this.backend.stat(p)) {
        const { bytes } = await this.backend.read(p);
        return JSON.parse(new TextDecoder().decode(bytes));
      }
    } catch (e) { console.warn('session unreadable', e); }
    // first start of 0.0.2: take over the session kept by 0.0.1 in the app's data folder
    const old = await this.backend.loadSession?.().catch(() => null);
    if (old) this.legacy = true;
    return old;
  }

  async saveSession(obj) {
    if (!this.usable) return this.backend.saveSession(obj);
    await this.backend.mkdirAll(this.stateDir);
    await this.backend.write(join(this.stateDir, 'session.json'), new TextEncoder().encode(JSON.stringify(obj)), null);
  }

  // ── backups of unsaved edits ─────────────────────────────
  backupPath(id) {
    if (!ID_RE.test(id)) throw new Error('bad backup id');
    return join(this.stateDir, 'backups', id + '.txt');
  }

  async backupWrite(id, text) {
    if (!this.usable) return this.backend.backupWrite(id, text);
    await this.backend.mkdirAll(join(this.stateDir, 'backups'));
    await this.backend.write(this.backupPath(id), new TextEncoder().encode(text), null);
  }

  async backupRead(id) {
    if (!this.usable) return this.backend.backupRead(id);
    const p = this.backupPath(id);
    if (await this.backend.stat(p).catch(() => null)) return new TextDecoder().decode((await this.backend.read(p)).bytes);
    return this.legacy ? this.backend.backupRead?.(id) ?? null : null;
  }

  async backupDelete(id) {
    if (!this.usable) return this.backend.backupDelete(id);
    const p = this.backupPath(id);
    if (await this.backend.stat(p).catch(() => null)) await this.backend.remove(p);
    if (this.legacy) await this.backend.backupDelete?.(id).catch(() => {});
  }

  async backupList() {
    if (!this.usable) return this.backend.backupList();
    const dir = join(this.stateDir, 'backups');
    const items = (await this.backend.stat(dir).catch(() => null)) ? await this.backend.list(dir).catch(() => []) : [];
    const ids = items.filter((i) => !i.dir && i.name.endsWith('.txt')).map((i) => i.name.slice(0, -4)).filter((id) => ID_RE.test(id));
    if (this.legacy) for (const id of await this.backend.backupList?.().catch(() => []) || []) if (!ids.includes(id)) ids.push(id);
    return ids;
  }

  // After the first restore, everything lives in the app folder.
  async finishMigration() {
    if (!this.legacy) return;
    for (const id of (await this.backend.backupList?.().catch(() => [])) || []) await this.backend.backupDelete?.(id).catch(() => {});
    this.legacy = false;
  }
}
