// Preferences: a form over the one settings.json, in sections. Every change
// saves at once (it is the same file on every device). "Open settings.json"
// edits it raw; anything not shown here can be set there too.
//
// Two things are per device and live next to the notes folder path instead
// (desktop and Android): this device's name (used in scratch file names) and
// the app folder.
import { sheet, toast, alert } from './dialogs.js';
import { h } from './dom.js';
import { allThemes, resolveTheme, themeIdFor, COLOR_GROUPS, COLOR_LABELS, hexOrNull, BUILTIN } from '../core/themes.js';
import { appDirOf, DEFAULT_APP_DIR } from '../core/settings.js';
import { normalizeCombo } from '../core/keys.js';

const SECTIONS = [
  ['appearance', 'Appearance'],
  ['editor', 'Editor'],
  ['saving', 'Saving'],
  ['files', 'Files'],
  ['keys', 'Keyboard'],
  ['device', 'This device'],
];

export function showSettings(app, ui, first = 'appearance') {
  const s = app.settings;
  const be = app.backend;
  const content = h('div.set-content');
  const nav = h('nav.set-nav');
  let current = first;

  // ── small controls ───────────────────────────────────────
  const seg = (key, options) => {
    const box = h('div.seg', { role: 'group' });
    const draw = () => box.replaceChildren(...options.map(([val, label]) => h('button', { type: 'button', 'aria-pressed': String(s.get(key) === val), onclick: () => { s.set({ [key]: val }); draw(); } }, label)));
    draw();
    return box;
  };
  const num = (key, min, max, step = 1) => h('input', { type: 'number', min, max, step, value: s.get(key), oninput: (e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= min && n <= max) s.set({ [key]: n }); } });
  const text = (key, { placeholder = '', pattern } = {}) => h('input', {
    value: s.get(key), placeholder, spellcheck: 'false', autocapitalize: 'off',
    onchange: (e) => { const v = e.target.value.trim(); if (pattern && !pattern.test(v)) { toast('Not a valid value', { error: true }); e.target.value = s.get(key); return; } s.set({ [key]: v }); },
  });
  const sw = (key, label, hint, after) => h('label.sw', {},
    h('input', { type: 'checkbox', checked: !!s.get(key), onchange: (e) => { s.set({ [key]: e.target.checked }); after?.(e.target.checked); } }),
    h('span', {}, label, hint ? h('small', {}, hint) : null));
  const row = (label, control, hint) => h('div.set-row', {}, h('div', {}, h('div.set-l', {}, label), hint ? h('small', {}, hint) : null), control);
  const select = (key, options) => h('select', { onchange: (e) => s.set({ [key]: e.target.value }) },
    options.map(([v, l]) => h('option', { value: v, selected: s.get(key) === v }, l)));

  // ── sections ─────────────────────────────────────────────
  const themeOptions = () => Object.entries(allThemes(s.get('themes'))).map(([id, t]) => [id, (t.label || id) + (t.custom ? ' (yours)' : '')]);

  const sections = {
    appearance: () => [
      row('Theme', select('theme', [...themeOptions(), ['system', 'Follow system']])),
      s.get('theme') === 'system' ? row('…when the system is dark', select('themeDark', themeOptions())) : null,
      s.get('theme') === 'system' ? row('…when the system is light', select('themeLight', themeOptions())) : null,
      themeEditor(),
      be.kind === 'desktop' ? row('Window opacity', opacitySlider(), 'Below 100% the window background is see-through. Linux needs a compositor (picom, KWin, Mutter); shared by all desktops.') : null,
      row('Font size', num(app.mobile ? 'mobileFontSize' : 'fontSize', 8, 40), app.mobile ? 'On phones' : 'On desktop and web'),
      row('Font', text('fontFamily', { placeholder: 'JetBrains Mono' }), 'Any installed monospace font; empty = JetBrains Mono'),
      row('Line height', num('lineHeight', 1, 3, 0.05)),
      sw('lineNumbers', 'Line numbers'),
      sw('highlightActiveLine', 'Highlight current line'),
      sw('showWhitespace', 'Show whitespace'),
      sw('wordWrap', 'Word wrap'),
      app.mobile ? null : sw('minimap', 'Minimap'),
    ],
    editor: () => [
      row('Tab width', num('tabSize', 1, 16)),
      sw('indentWithTabs', 'Indent with tabs'),
      sw('autoCloseBrackets', 'Auto-close brackets and quotes'),
      row('New file line endings', seg('newFileEol', [['LF', 'LF'], ['CRLF', 'CRLF']])),
      sw('trimTrailingWhitespaceOnSave', 'Trim trailing whitespace on save'),
      sw('insertFinalNewlineOnSave', 'End files with a newline on save'),
      sw('markdownPreviewOnOpen', 'Open markdown preview with .md files'),
    ],
    saving: () => [
      row('Autosave', seg('autosave', [['notes', 'Notes folder'], ['all', 'All files'], ['off', 'Off']]), 'Unsaved edits are always kept and restored on restart'),
      row('Autosave delay (ms)', num('autosaveDelayMs', 200, 60000, 100)),
      row('Keep unsaved edits after (ms)', num('backupDelayMs', 200, 10000, 100), 'How soon edits are copied for restore after a crash or restart'),
      row('Scratch folder', text('scratchFolder', { pattern: /^[\w.-]+(\/[\w.-]+)*$/ }), `New tabs are kept in ${be.notesName}/${appDirOf(be)}/<this> until you save them somewhere`),
      row('Scratch file extension', text('scratchExtension', { pattern: /^[A-Za-z0-9]{1,10}$/ }), 'scratch_<device>_<date-time>.<extension>; picking a language changes it'),
    ],
    files: () => [
      be.setNotesRoot
        ? row('Notes folder', h('button', { type: 'button', onclick: async () => { close(); await app.chooseNotesRoot(); } }, 'Change…'), be.notesRoot)
        : row('Notes folder', h('span.muted', {}, be.notesName), 'Set on the server (MNEMOSTXT_NOTES)'),
      sw('showHidden', 'Show hidden items'),
      h('label.f', {}, h('span', {}, 'Hidden names (one per line)'),
        h('textarea', { rows: 3, spellcheck: 'false', onchange: (e) => s.set({ hidden: e.target.value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) }) }, s.get('hidden').join('\n'))),
      sw('confirmDelete', 'Confirm before moving to trash'),
      row('Keep trash for (days)', num('trashDays', 1, 3650), 'Settings → Empty trash removes older items'),
      row('Open read-only above (MB)', num('readOnlyAboveMB', 1, 50)),
      row('Check open files for changes every (s)', num('diskCheckSeconds', 5, 3600)),
      row('Recently closed files kept', num('recentlyClosedKept', 0, 200)),
    ],
    keys: () => keyEditor(),
    device: () => deviceSection(),
  };

  // ── themes: copy a theme, then change its colours ────────
  function themeEditor() {
    const custom = s.get('themes') || {};
    const id = themeIdFor(s.values);
    const isOwn = Object.prototype.hasOwnProperty.call(custom, id);
    const box = h('div.theme-ed');
    const copy = () => {
      const base = resolveTheme(id, custom);
      let n = 1;
      while (custom[`my-theme-${n}`] || BUILTIN[`my-theme-${n}`]) n++;
      const newId = `my-theme-${n}`;
      s.set({ themes: { ...custom, [newId]: { label: `My theme ${n}`, base: id, mode: base.mode } }, theme: newId });
      render('appearance');
    };
    if (!isOwn) {
      box.append(h('div.row', {}, h('span.muted.grow', {}, 'Built-in themes cannot be changed. Make a copy to edit its colours.'), h('button', { type: 'button', onclick: copy }, 'Copy and edit')));
      return box;
    }
    const t = custom[id];
    const resolved = resolveTheme(id, custom);
    const put = (patch) => s.set({ themes: { ...s.get('themes'), [id]: { ...s.get('themes')[id], ...patch } } });
    const unset = (k) => { const next = { ...s.get('themes')[id] }; delete next[k]; s.set({ themes: { ...s.get('themes'), [id]: next } }); };
    box.append(
      h('div.row', {},
        h('input.grow', { value: t.label || id, 'aria-label': 'Theme name', onchange: (e) => put({ label: e.target.value.trim() || id }) }),
        h('select', { 'aria-label': 'Light or dark', onchange: (e) => put({ mode: e.target.value }) },
          [['dark', 'Dark'], ['light', 'Light']].map(([v, l]) => h('option', { value: v, selected: resolved.mode === v }, l))),
        h('button', { type: 'button', onclick: copy }, 'Copy'),
        h('button.danger', { type: 'button', onclick: () => { const next = { ...s.get('themes') }; delete next[id]; s.set({ themes: next, theme: t.base && allThemes(next)[t.base] ? t.base : 'nss-dark' }); render('appearance'); } }, 'Delete')),
      h('small.muted', {}, `Based on ${allThemes(custom)[t.base]?.label || t.base || 'nss dark'}. Colours you have not changed follow it. Stored in settings.json → "themes" → "${id}".`),
      ...COLOR_GROUPS.map(([group, keys]) => h('details.colors', { open: group === 'Syntax' },
        h('summary', {}, group),
        h('div.color-grid', {}, keys.map((k) => {
          const own = typeof t[k] === 'string';
          const hex = hexOrNull(resolved[k]);
          return h('label.color', { class: own ? 'own' : '', title: own ? `${k}: ${t[k]} (click × to follow the base theme)` : `${k}: ${resolved[k]} (from the base theme)` },
            h('input', { type: 'color', value: hex || '#888888', oninput: (e) => put({ [k]: e.target.value }) }),
            h('span', {}, COLOR_LABELS[k] || k),
            own ? h('button.ghost.icon.sm', { type: 'button', 'aria-label': 'Reset', onclick: (e) => { e.preventDefault(); unset(k); render('appearance'); } }, '×') : null);
        })))),
    );
    return box;
  }

  function opacitySlider() {
    const out = h('span.muted', {}, Math.round(s.get('windowOpacity') * 100) + '%');
    const input = h('input', { type: 'range', min: 20, max: 100, step: 1, value: Math.round(s.get('windowOpacity') * 100),
      oninput: (e) => { s.set({ windowOpacity: Number(e.target.value) / 100 }); out.textContent = e.target.value + '%'; } });
    return h('div.row', {}, input, out);
  }

  // ── key bindings: type keys like "Ctrl+Shift+D, F5" ─────
  function keyEditor() {
    const filter = h('input', { type: 'search', placeholder: 'Filter commands', spellcheck: 'false' });
    const list = h('div.key-list');
    const draw = () => {
      const q = filter.value.trim().toLowerCase();
      const cmds = ui.commands.filter((c) => !c.theme && (!q || c.label.toLowerCase().includes(q) || c.id.includes(q) || c.keys.some((k) => k.toLowerCase().includes(q))));
      list.replaceChildren(...cmds.map((c) => {
        const input = h('input.mono', { value: c.keys.join(', '), placeholder: 'none', spellcheck: 'false', title: 'Separate keys with commas. Press Enter to save.' });
        const save = () => {
          const parts = input.value.split(',').map((x) => x.trim()).filter(Boolean);
          let keys;
          try { keys = parts.map(normalizeCombo); } catch { toast('Not a key combination', { error: true }); return; }
          const map = { ...s.get('keybindings') };
          if (keys.join() === c.defaultKeys.join()) delete map[c.id]; else map[c.id] = keys;
          s.set({ keybindings: map });
          const clash = ui.commands.filter((o) => o !== c && o.keys.some((k) => keys.includes(k)));
          if (clash.length) toast(`Also used by: ${clash.map((o) => o.label).join(', ')}`);
          draw();
        };
        input.addEventListener('change', save);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
        return h('div.key-row', { class: c.remapped ? 'own' : '' },
          h('div', {}, h('div', {}, c.label), h('small.muted.mono', {}, c.id)),
          input,
          c.remapped ? h('button.ghost.icon.sm', { type: 'button', title: `Back to ${c.defaultKeys.join(', ') || 'none'}`, onclick: () => { const map = { ...s.get('keybindings') }; delete map[c.id]; s.set({ keybindings: map }); draw(); } }, '×') : h('span'));
      }));
    };
    filter.addEventListener('input', draw);
    draw();
    return [h('p.muted', {}, 'Notepad++ keys by default. Type new keys (e.g. Ctrl+Shift+D, F5); leave empty to remove. Saved in settings.json → "keybindings", for every device.'), filter, list];
  }

  // ── per-device settings ──────────────────────────────────
  function deviceSection() {
    const out = [];
    if (be.setDeviceConfig) {
      const name = h('input', { value: be.deviceName || '', spellcheck: 'false', autocapitalize: 'off' });
      const appDir = h('input', { value: appDirOf(be), spellcheck: 'false', autocapitalize: 'off', placeholder: DEFAULT_APP_DIR });
      out.push(
        h('p.muted', {}, 'These two are kept on this device only (next to the notes folder path).'),
        row('Device name', name, 'Shown in scratch file names (scratch_<device>_…) and the state folder'),
        row('App folder', appDir, `Inside the notes folder. Holds settings.json, trash, scratch and state. Use the same on every device (default ${DEFAULT_APP_DIR}).`),
        h('div.row', {}, h('span.grow'), h('button.primary', { type: 'button', onclick: async () => {
          try {
            await be.setDeviceConfig({ deviceName: name.value.trim(), appDir: appDir.value.trim() || DEFAULT_APP_DIR });
            await app.settings.load();
            app.applyLook();
            app.emit('roots');
            toast('Saved for this device');
          } catch (e) { alert('Not saved', e.message); }
        } }, 'Save device settings')));
    } else if (be.kind === 'web') {
      out.push(row('App folder', h('span.muted', {}, appDirOf(be)), 'Set on the server (MNEMOSTXT_APP_DIR)'));
    }
    if (be.kind === 'desktop' && be.setTray) {
      out.push(h('h3', {}, 'Desktop'),
        sw('keepInTray', 'Keep running in the tray', 'Closing the window hides it; files then open instantly. Quit from the tray icon or File → Exit. Shared by all desktops; Linux needs libayatana-appindicator3-1.'),
        h('p.muted', {}, be.platform === 'windows'
          ? 'Open with: right-click a .txt or .md file → Open with → mnemostxt (the installer registers it).'
          : 'From a terminal: mnemostxt file.txt, or add  alias m=mnemostxt  to ~/.bashrc and use  m file.txt.'));
    }
    if (be.kind === 'android' && be.android) {
      const a = be.android;
      const access = h('span.muted', {}, '…');
      a.hasAllFilesAccess().then((ok) => { access.textContent = ok ? 'Allowed' : 'Not allowed'; access.className = ok ? 'ok' : 'bad'; });
      out.push(h('h3', {}, 'Android'),
        row('All files access', h('div.row', {}, access, h('button', { type: 'button', onclick: () => a.openAllFilesSettings() }, 'Open system settings')), 'Needed to read and write your notes folder in shared storage'),
        row('Share to mnemostxt saves in', text('androidInbox', { pattern: /^[\w .-]+(\/[\w .-]+)*$/ }), `Inside ${be.notesName}. Shared text becomes <date>_<time>.md; shared files keep their names.`),
        sw('androidLock', 'Lock with fingerprint, face or screen lock', 'Uses the phone\'s own lock; nothing is stored by mnemostxt', async (on) => {
          if (on && !(await a.lockAvailable())) { s.set({ androidLock: false }); alert('No screen lock', 'Set a screen lock (PIN, pattern or password) in the phone settings first.'); }
        }),
        row('Lock after (minutes in background)', num('androidLockAfterMinutes', 0, 1440), '0 = every time you come back'),
        row('App permissions', h('button', { type: 'button', onclick: () => a.openAppSettings() }, 'Open app info')),
        h('p.muted', {}, 'Widgets: long-press the home screen → Widgets → mnemostxt. Recent files (2×2, 3×2, 4×2), Pinned note (2×2, 4×2) and Quick capture (4×1); long-press a widget (or tap its title) for its theme, opacity, text size, font and folder or note.'));
    }
    out.push(h('p.muted.set-foot', {}, `Settings: ${be.notesName}/${appDirOf(be)}/settings.json · mnemostxt ${be.version}`));
    return out;
  }

  // ── frame ────────────────────────────────────────────────
  function render(which = current) {
    current = which;
    nav.replaceChildren(...SECTIONS.map(([id, label]) => h('button.ghost', { type: 'button', class: id === current ? 'on' : '', onclick: () => render(id) }, label)));
    const scroll = content.scrollTop;
    content.replaceChildren(...[sections[current]()].flat(Infinity).filter(Boolean));
    if (which === current) content.scrollTop = scroll;
  }
  // a new theme shows (or hides) its colour editor; colour edits themselves do not re-render
  const off = s.onChange((keys) => { if (keys.includes('theme') && current === 'appearance') render(); });
  render(first);

  let closeFn = null;
  const close = () => closeFn?.();
  const p = sheet({
    title: 'Preferences',
    body: h('div.settings', {}, nav, content),
    wide: true,
    onClose: off,
    actions: [
      { label: 'Open settings.json', run: () => { app.openSettingsFile(); } },
      { label: 'Done', primary: true },
    ],
  });
  closeFn = () => document.querySelector('dialog.sheet[open]')?.done?.();
  return p;
}
