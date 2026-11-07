// The Android side of the app (app/android/MainActivity.kt) adds a small
// JavaScript interface, window.MnemostxtAndroid, for what a web view cannot do
// alone: the system folder picker, the phone's lock (fingerprint, face, screen
// lock), the storage permission screen and the settings the share target needs.
// Answers that take a while (the picker) come back through window.__mnemostxtCb.

export function androidBridge() {
  const n = window.MnemostxtAndroid;
  if (!n) return null;
  const pending = new Map();
  let seq = 0;
  window.__mnemostxtCb = (id, value) => {
    const done = pending.get(id);
    pending.delete(id);
    done?.(value);
  };
  const later = (start) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); start(id); });
  return {
    deviceModel: () => String(n.deviceModel() || ''),
    hasAllFilesAccess: async () => !!n.hasAllFilesAccess(),
    openAllFilesSettings: () => n.openAllFilesSettings(),
    openAppSettings: () => n.openAppSettings(),
    lockAvailable: async () => !!n.lockAvailable(),
    // notes folder, inbox, lock: kept by the Android side for the share screen
    // and for locking before the web view has loaded
    configure: (cfg) => n.configure(JSON.stringify(cfg)),
    // the system picker, answered with a real path (/storage/emulated/0/notes) or null
    pickFolder: () => later((id) => n.pickFolder(id)).then((v) => v || null),
  };
}
