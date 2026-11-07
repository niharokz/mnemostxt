// Backend for the desktop (Linux, Windows) and Android builds: the Rust side of
// the Tauri app (app/src/*.rs) does the file work; see ARCHITECTURE.md.
// Desktop file bytes travel raw (read_raw / write_raw); Android, or a web view
// that cannot send raw bytes, uses base64 (read_file / write_file).
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { fromBase64, toBase64 } from '../core/encoding.js';
import { fromRust } from './errors.js';

const call = async (cmd, args, options) => {
  try {
    return await invoke(cmd, args, options);
  } catch (e) {
    throw fromRust(e);
  }
};

// read_raw answers with an ArrayBuffer (some IPC fallbacks give a plain array).
function unframe(r) {
  const u8 = r instanceof ArrayBuffer ? new Uint8Array(r) : ArrayBuffer.isView(r) ? new Uint8Array(r.buffer, r.byteOffset, r.byteLength) : Uint8Array.from(r);
  const mtime = Number(new DataView(u8.buffer, u8.byteOffset, 8).getBigInt64(0, true));
  const bytes = u8.subarray(8);
  return { bytes, mtime, size: bytes.length };
}

export async function createTauriBackend() {
  const info = await call('app_info');
  const mobile = info.platform === 'android';
  let raw = !mobile; // falls back to base64 for good after the first refusal
  let dialog = null;
  const dlg = async () => (dialog ??= await import('@tauri-apps/plugin-dialog'));

  const be = {
    kind: mobile ? 'android' : 'desktop',
    platform: info.platform,
    version: info.version,
    home: info.home,
    notesRoot: info.notes_dir, // null until chosen on first run
    defaultNotesRoot: info.default_notes_dir,
    notesName: 'notes',
    appDir: info.app_dir,
    deviceName: info.device_name,
    startupFiles: info.args || [],
    canOpenAnywhere: !mobile, // desktop opens any file; Android stays in the notes folder

    async setNotesRoot(path) {
      be.notesRoot = await call('set_notes_dir', { path });
      return be.notesRoot;
    },
    async setDeviceConfig({ deviceName, appDir }) {
      await call('set_device_config', { deviceName: deviceName ?? null, appDir: appDir ?? null });
      const i = await call('app_info');
      be.deviceName = i.device_name;
      be.appDir = i.app_dir;
    },
    list: (path) => call('list_dir', { path }),
    async read(path) {
      if (raw) {
        const r = await call('read_raw', { path }); // real errors (NOT_FOUND…) surface as usual
        try { return unframe(r); } catch { raw = false; } // an odd reply: use base64 from now on
      }
      const r = await call('read_file', { path });
      return { bytes: fromBase64(r.data), mtime: r.mtime, size: r.size };
    },
    async write(path, bytes, expectedMtime) {
      if (raw) {
        try {
          return await call('write_raw', bytes, { headers: { 'x-path': encodeURIComponent(path), 'x-expect': expectedMtime == null ? '' : String(expectedMtime) } });
        } catch (e) { if (e.code !== 'RAW') throw e; raw = false; }
      }
      return call('write_file', { path, data: toBase64(bytes), expectedMtime: expectedMtime ?? null });
    },
    remove: (path) => call('remove_file', { path }),
    stat: (path) => call('stat_path', { path }),
    mkdirAll: (path) => call('mkdir_all', { path }),
    createFile: (path) => call('create_file', { path }),
    rename: (from, to) => call('rename_path', { from, to }),
    trash: (path) => call('trash_path', { path }),
    trashPurge: (days) => call('trash_purge', { days }),
    search: (roots, query, opts) => call('search', { roots, query, regex: !!opts.regex, caseSensitive: !!opts.caseSensitive, hidden: opts.hidden || [], max: opts.max || 2000 }),

    // 0.0.1's hot-exit storage in the app's data folder; core/store.js reads it
    // once, then keeps everything in the notes folder's app folder
    loadSession: async () => { const s = await call('session_load'); return s ? JSON.parse(s) : null; },
    saveSession: (obj) => call('session_save', { json: JSON.stringify(obj) }),
    backupWrite: (id, text) => call('backup_write', { id, text }),
    backupRead: (id) => call('backup_read', { id }),
    backupDelete: (id) => call('backup_delete', { id }),
    backupList: () => call('backup_list'),

    async pickFiles() {
      const r = await (await dlg()).open({ multiple: true, directory: false });
      return r == null ? [] : (Array.isArray(r) ? r : [r]).map(norm);
    },
    async pickFolder(title) {
      const r = await (await dlg()).open({ directory: true, multiple: false, title });
      return r ? norm(r) : null;
    },
    async pickSavePath(defaultPath) {
      const r = await (await dlg()).save({ defaultPath });
      return r ? norm(r) : null;
    },
    onOpenFiles: (fn) => listen('open-files', (e) => fn((e.payload || []).map(norm))),
    onDropPaths: (fn) => getCurrentWebview().onDragDropEvent((e) => { if (e.payload.type === 'drop') fn(e.payload.paths.map(norm)); }),
    onCloseRequested: (fn) => getCurrentWindow().onCloseRequested(fn),
    onQuitRequested: (fn) => listen('quit-requested', () => fn()),
    hide: () => getCurrentWindow().hide(),
    setTray: mobile ? null : (enabled) => call('tray_set', { enabled }),
    setWindowTheme: mobile ? null : (mode) => getCurrentWindow().setTheme(mode === 'light' ? 'light' : 'dark').catch(() => {}),
    setTitle: (t) => getCurrentWindow().setTitle(t).catch(() => {}),
    async toggleFullscreen() {
      const w = getCurrentWindow();
      await w.setFullscreen(!(await w.isFullscreen()));
    },
    quit: () => call('app_exit'),
  };
  if (mobile) {
    const { androidBridge } = await import('./android.js');
    be.android = androidBridge();
    // first start: name this device after the phone model
    if (!info.device_name_set && be.android?.deviceModel) {
      const model = be.android.deviceModel();
      if (model) await be.setDeviceConfig({ deviceName: model }).catch(() => {});
    }
    if (be.android?.pickFolder) be.pickFolder = () => be.android.pickFolder();
  }
  return be;
}

const norm = (p) => String(p).replace(/\\/g, '/');
