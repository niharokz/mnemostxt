// The app controller: open documents, the one editor view, saving, autosave,
// hot exit (session + backups of unsaved edits, core/store.js), scratch files
// for new tabs, disk-change detection, encrypted notes, note history, links
// between notes and the daily note.
// UI pieces (menu, tree, tabs, status bar, panels) talk to it, never to each other.
import { EditorView } from '@codemirror/view';
import { EditorSelection, Text } from '@codemirror/state';
import { createState, reconfigure, setLanguage, setUpdateHandler } from '../editor/extensions.js';
import { trimTrailingChanges } from '../editor/lineops.js';
import { decode, encode, looksBinary, ansiLossy } from '../core/encoding.js';
import { detect, byNameOf, PLAIN, isMarkdown } from '../core/languages.js';
import { basename, dirname, extname, join, isInside, pretty, relative, validName } from '../core/paths.js';
import { trashDirOf } from '../core/settings.js';
import { Store } from '../core/store.js';
import { resolveTheme, themeIdFor, applyTheme } from '../core/themes.js';
import { FileIndex } from '../core/fileindex.js';
import { isEncrypted, newLock, encryptBytes, decryptBytes, cryptoAvailable } from '../core/crypto.js';
import { resolveWiki, wikiLinkAt, tagAt, headings, backlinkPattern, tagPattern, countWords, isoDate } from '../core/wiki.js';
import { setWikiProvider } from '../editor/wikilinks.js';
import { startCompletion } from '@codemirror/autocomplete';
import { showDiff } from './diffView.js';
import { pick } from './picker.js';
import { confirm, prompt, sheet, toast, alert } from './dialogs.js';
import { debounce, h } from './dom.js';
import { APP_NAME } from '../core/brand.js';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif', '.svg']);
const MAX_OPEN = 50 * 1024 * 1024; // refuse beyond this (the Rust side and the server agree)

const lf = (t) => t.replace(/\r\n?/g, '\n'); // the editor's line endings
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export class App {
  constructor(backend, settings) {
    this.backend = backend;
    this.settings = settings;
    this.store = new Store(backend, settings);
    this.docs = [];
    this.active = null;
    this.extraRoots = []; // folders opened next to the notes folder (desktop)
    this.closed = []; // recently closed paths, for Ctrl+Shift+T
    this.ui = { menuCollapsed: false, sidebar: true, sidebarWidth: 270, sidebarView: 'files', preview: false, previewWidth: 46, zoom: 0, expanded: [] };
    this.listeners = new Map();
    this.mobile = matchMedia('(max-width: 759px)').matches || backend.kind === 'android';
    this.untitledCounter = 0;

    this.saveSession = debounce(() => this.writeSession(), 600);
    this.autosaveTimers = new Map();
    this.backupTimers = new Map();

    this.index = new FileIndex(backend, settings); // every file of the notes folder, built when first needed
    this.on('tree-changed', () => this.index.invalidate());
    setWikiProvider(() => this.noteNames());
    setUpdateHandler((u) => this.onEditorUpdate(u));
    this.view = new EditorView({ parent: h('div.editor-host') });
    settings.onChange((keys) => this.onSettings(keys));
    matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (this.settings.get('theme') === 'system') this.applyLook(); });
  }

  // ── events ───────────────────────────────────────────────
  on(ev, fn) { if (!this.listeners.has(ev)) this.listeners.set(ev, new Set()); this.listeners.get(ev).add(fn); }
  emit(ev, arg) { for (const fn of this.listeners.get(ev) || []) fn(arg); }

  // ── queries ──────────────────────────────────────────────
  get roots() {
    const out = [];
    if (this.backend.notesRoot != null) out.push({ path: this.backend.notesRoot, name: this.backend.notesName || basename(this.backend.notesRoot) || 'notes', pinned: true });
    for (const p of this.extraRoots) if (!out.some((r) => r.path === p)) out.push({ path: p, name: basename(p) || p });
    return out;
  }
  dirty(doc) { return !!doc && doc.kind === 'text' && !doc.state.doc.eq(doc.savedDoc); }
  displayName(doc) { return doc.untitled || basename(doc.path); }
  isScratch(doc) { return !!doc?.path && this.store.isScratch(doc.path); }
  displayDir(doc) {
    if (!doc.path) return '';
    const d = dirname(doc.path);
    if (this.backend.kind === 'web') return d ? `${this.backend.notesName}/${d}` : this.backend.notesName;
    return pretty(d, this.backend.home);
  }
  inNotes(path) { return this.backend.notesRoot != null && path != null && isInside(path, this.backend.notesRoot); }
  get settingsPath() { return this.settings.path; }
  findDoc(path) { return this.docs.find((d) => d.path && d.path === path); }
  fontSize() { return (this.mobile ? this.settings.get('mobileFontSize') : this.settings.get('fontSize')) + this.ui.zoom; }

  // ── settings ─────────────────────────────────────────────
  onSettings(keys) {
    this.applyLook();
    const lookOnly = ['theme', 'themeDark', 'themeLight', 'themes', 'windowOpacity', 'fontSize', 'mobileFontSize', 'fontFamily', 'lineHeight'];
    if (keys.some((k) => !lookOnly.includes(k))) {
      for (const d of this.docs) d.configStale = true;
      if (this.active?.kind === 'text') this.reconfigureActive();
    }
    this.syncDevice(keys);
    this.emit('settings', keys);
  }

  // Hands shared settings to the platform: the tray (desktop) and the share
  // target and lock (Android). keys = what changed (all on start).
  syncDevice(keys = null) {
    const be = this.backend;
    const s = this.settings.values;
    const has = (...k) => !keys || k.some((x) => keys.includes(x));
    if (be.setTray && has('keepInTray')) be.setTray(s.keepInTray).catch((e) => { if (s.keepInTray) toast(`Tray: ${e.message}`, { error: true, ms: 6000 }); });
    if (be.android && has('androidInbox', 'androidLock', 'androidLockAfterMinutes', 'androidSecure')) {
      try {
        be.android.configure({ notesDir: be.notesRoot, appDir: be.appDir, inbox: s.androidInbox, lock: s.androidLock, lockAfterMinutes: s.androidLockAfterMinutes, secure: s.androidSecure });
      } catch (e) { console.warn('android configure', e); }
    }
  }

  applyLook() {
    const s = this.settings.values;
    const root = document.documentElement;
    const theme = resolveTheme(themeIdFor(s), s.themes);
    applyTheme(root, theme, this.backend.kind === 'desktop' ? s.windowOpacity : 1);
    this.backend.setWindowTheme?.(theme.mode);
    root.style.setProperty('--ed-font-size', this.fontSize() + 'px');
    if (s.fontFamily) root.style.setProperty('--ed-font', `${JSON.stringify(s.fontFamily)}, "JetBrains Mono", var(--nss-mono)`); else root.style.removeProperty('--ed-font');
    root.style.setProperty('--ed-line-height', String(s.lineHeight));
    this.view.requestMeasure();
  }

  reconfigureActive() {
    const d = this.active;
    this.view.dispatch({ effects: reconfigure(this.settings.values, d) });
    d.state = this.view.state;
    d.configStale = false;
  }

  // ── editor updates ───────────────────────────────────────
  onEditorUpdate(u) {
    const d = this.active;
    if (!d || d.kind !== 'text' || u.view !== this.view) return;
    d.state = u.state;
    if (u.docChanged) {
      const wasDirty = d.wasDirty;
      d.wasDirty = this.dirty(d);
      if (wasDirty !== d.wasDirty) this.emit('docs');
      if (!d.path && !d.readOnly) this.startScratch(d);
      this.scheduleAutosave(d);
      this.scheduleBackup(d);
      d.words = null;
      this.emit('content', d);
      // typing "[[" in markdown offers the notes to link to
      if (u.transactions.some((t) => t.isUserEvent('input.type')) && isMarkdown(d.path || d.untitled || '')) {
        const head = u.state.selection.main.head;
        if (u.state.sliceDoc(Math.max(0, head - 2), head) === '[[') setTimeout(() => { if (this.active === d) startCompletion(this.view); }, 0);
      }
    }
    if (u.docChanged || u.selectionSet) {
      this.emit('cursor', d);
      this.saveSession();
      // typewriter mode: the line being typed stays in the middle of the window
      if (this.settings.get('typewriter') && u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete') || t.isUserEvent('select'))) {
        requestAnimationFrame(() => { if (this.active === d) this.view.dispatch({ effects: EditorView.scrollIntoView(this.view.state.selection.main.head, { y: 'center' }) }); });
      }
    }
  }

  // Words in a text document (status bar); counted once per change.
  wordsOf(d) {
    if (d.words == null) d.words = d.state.doc.length > 2_000_000 ? -1 : countWords(this.textOf(d));
    return d.words;
  }

  // One undoable change to a text document, active or not.
  edit(d, changes, userEvent = 'input') {
    if (d?.kind !== 'text' || d.readOnly) return false;
    const spec = { changes, userEvent };
    if (this.active === d) this.view.dispatch(spec);
    else { d.state = d.state.update(spec).state; d.wasDirty = this.dirty(d); d.words = null; this.scheduleAutosave(d); this.scheduleBackup(d); this.emit('docs'); }
    return true;
  }

  // Replaces the whole text, touching only the part that differs.
  replaceText(d, text, userEvent = 'input.replace') {
    const old = this.textOf(d);
    if (old === text) return false;
    let a = 0;
    const max = Math.min(old.length, text.length);
    while (a < max && old.charCodeAt(a) === text.charCodeAt(a)) a++;
    let b = 0;
    while (b < max - a && old.charCodeAt(old.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++;
    return this.edit(d, { from: a, to: old.length - b, insert: text.slice(a, text.length - b) }, userEvent);
  }

  // ── opening ──────────────────────────────────────────────
  newDoc({ text = '', focus = true } = {}) {
    this.untitledCounter++;
    const d = this.makeTextDoc({ path: null, untitled: `new ${this.untitledCounter}`, text, encoding: 'UTF-8', eol: this.settings.get('newFileEol') });
    this.docs.splice(this.active ? this.docs.indexOf(this.active) + 1 : this.docs.length, 0, d);
    this.activate(d, { focus });
    return d;
  }

  // A new tab becomes a scratch file (app folder/scratch/) on its first edit,
  // and is then saved automatically like a note. Save as… moves it out.
  async startScratch(d) {
    if (d.scratchPending || d.path || this.backend.readOnly || this.backend.notesRoot == null || !d.state.doc.length) return;
    d.scratchPending = true;
    try {
      const path = await this.store.newScratchPath();
      if (!path || d.path || !this.docs.includes(d)) return;
      await this.backend.mkdirAll(dirname(path));
      await this.backend.createFile(path);
      d.path = path;
      d.mtime = (await this.backend.stat(path))?.mtime ?? null;
      this.scheduleAutosave(d);
      this.emit('docs');
      this.emit('tree-changed', dirname(path));
      this.saveSession();
    } catch (e) {
      console.warn('scratch file not created', e);
    } finally { d.scratchPending = false; }
  }

  makeTextDoc({ path, untitled, text, encoding, eol, mtime = null, lang = null, readOnly = false, id = uid() }) {
    const d = { id, path, untitled, kind: 'text', encoding, eol: eol || 'LF', mtime, readOnly, langName: lang, conflict: null, scroll: null, mobile: this.mobile };
    d.state = createState(text, this.settings.values, d, null);
    d.savedDoc = d.state.doc;
    d.wasDirty = false;
    this.loadLanguage(d, lang);
    return d;
  }

  async loadLanguage(d, name = d.langName) {
    const desc = name ? byNameOf(name) : detect(d.path || d.untitled, d.state.doc.line(1).text);
    d.langName = desc ? desc.name : PLAIN;
    if (!desc) return this.applyLanguage(d, null);
    try {
      const support = desc.support || (await desc.load());
      this.applyLanguage(d, support);
    } catch (e) {
      console.warn('language load failed', desc.name, e);
    }
    this.emit('cursor', d);
  }

  applyLanguage(d, support) {
    if (this.active === d) { this.view.dispatch({ effects: setLanguage(support) }); d.state = this.view.state; } else d.state = d.state.update({ effects: setLanguage(support) }).state;
  }

  async setLanguageName(name) {
    const d = this.active;
    if (d?.kind !== 'text') return;
    d.langName = name;
    d.langNameManual = true;
    await this.loadLanguage(d, name === PLAIN ? null : name);
    if (name === PLAIN) { d.langName = PLAIN; this.applyLanguage(d, null); }
    // a scratch file takes the language's extension, so it opens the same way elsewhere
    const ext = byNameOf(name)?.extensions?.[0];
    if (this.isScratch(d) && ext && extname(d.path) !== '.' + ext) {
      const to = d.path.replace(/\.[^./]*$/, '') + '.' + ext;
      if (!(await this.backend.stat(to).catch(() => null))) await this.movePath(d.path, to, { keepLanguage: true });
    }
    this.emit('cursor', d);
    this.emit('docs');
    this.saveSession();
  }

  // Opens a file (or focuses it when already open). Options: line, col, focus, force (encoding).
  async open(path, opts = {}) {
    const existing = this.findDoc(path);
    if (existing && !opts.reload) {
      this.activate(existing, opts);
      if (opts.line) this.gotoLine(opts.line, opts.col);
      return existing;
    }
    let st;
    try {
      st = await this.backend.stat(path);
    } catch (e) { toast(`Cannot open ${basename(path)}: ${e.message}`, { error: true }); return null; }
    if (!st) { toast(`${basename(path)} no longer exists`, { error: true }); return null; }
    if (st.dir) { this.addRoot(path); return null; }
    if (st.size > MAX_OPEN) { alert('File too large', `${basename(path)} is ${(st.size / 1048576).toFixed(0)} MB. ${APP_NAME} opens files up to 50 MB.`); return null; }
    let r;
    try { r = await this.backend.read(path); } catch (e) { toast(`Cannot read ${basename(path)}: ${e.message}`, { error: true }); return null; }
    const doc = this.docFromBytes(path, r, opts);
    if (existing) { // reload in place
      const i = this.docs.indexOf(existing);
      this.docs[i] = doc;
      doc.id = existing.id;
      if (this.active === existing) this.active = null;
    } else {
      const at = this.active ? this.docs.indexOf(this.active) + 1 : this.docs.length;
      this.docs.splice(at, 0, doc);
    }
    if (opts.focus !== false || !this.active) this.activate(doc, opts);
    if (opts.line) this.gotoLine(opts.line, opts.col);
    this.emit('docs');
    this.checkConflictCopies(doc);
    if (isMarkdown(path) && this.settings.get('markdownPreviewOnOpen') && !this.mobile) this.setPreview(true);
    this.saveSession();
    if (doc.kind === 'locked' && opts.focus !== false && !opts.locked) return this.unlock(doc, opts); // asks for the passphrase
    return doc;
  }

  docFromBytes(path, r, opts = {}) {
    const ext = extname(path);
    // an encrypted note stays locked until its passphrase is given (unlock())
    if (!opts.plain && isEncrypted(r.bytes)) return { id: uid(), path, kind: 'locked', bytes: r.bytes, mtime: r.mtime, size: r.size };
    if (!opts.asText && IMAGE_EXT.has(ext)) return { id: uid(), path, kind: 'image', bytes: r.bytes, mtime: r.mtime, size: r.size };
    if (!opts.asText && ext === '.pdf') return { id: uid(), path, kind: 'pdf', bytes: r.bytes, mtime: r.mtime, size: r.size };
    if (!opts.asText && !opts.encoding && looksBinary(r.bytes)) return { id: uid(), path, kind: 'binary', bytes: r.bytes, mtime: r.mtime, size: r.size };
    const { text, encoding, eol } = decode(r.bytes, opts.encoding || null);
    const big = r.size > this.settings.get('readOnlyAboveMB') * 1048576;
    const readOnly = big || (this.backend.readOnly ?? false);
    const d = this.makeTextDoc({ path, text, encoding, eol: eol || this.settings.get('newFileEol'), mtime: r.mtime, lang: opts.lang || null, readOnly });
    if (big) toast('Large file: opened read-only');
    return d;
  }

  async openAsText(doc) {
    const r = { bytes: doc.bytes, mtime: doc.mtime, size: doc.size };
    const d = this.docFromBytes(doc.path, r, { asText: true });
    d.id = doc.id;
    this.docs[this.docs.indexOf(doc)] = d;
    this.active = null;
    this.activate(d);
    this.emit('docs');
  }

  // ── encrypted notes (core/crypto.js) ─────────────────────
  // The passphrase is asked for once per note and app start; the last one
  // that worked is tried first for the next note. Nothing is written down.
  async askPassphrase(title, note = '') {
    const v = await prompt(title, { label: 'Passphrase', type: 'password', ok: 'Unlock', note });
    return v || null;
  }

  // bytes of an encrypted file → plain bytes, asking for the passphrase when
  // the kept key does not fit. Returns null when the user gives up.
  async decrypt(bytes, lock, name) {
    const fail = (e) => { if (e.code !== 'WRONG') toast(e.message, { error: true }); return e.code === 'WRONG'; };
    // first what is already known: this note's key, else the last passphrase that worked
    const known = lock ? { lock } : this.lastPass != null ? { passphrase: this.lastPass } : null;
    if (known) { try { return await decryptBytes(bytes, known); } catch (e) { if (!fail(e)) return null; } }
    for (let i = 0; ; i++) {
      const pass = await this.askPassphrase(`Unlock ${name}`, i ? 'That passphrase did not fit. Try again.' : 'This note is encrypted.');
      if (pass == null) return null;
      try {
        const r = await decryptBytes(bytes, { passphrase: pass });
        this.lastPass = pass;
        return r;
      } catch (e) { if (!fail(e)) return null; }
    }
  }

  // Turns a locked tab into an editable one.
  async unlock(doc, opts = {}) {
    if (doc?.kind !== 'locked') return doc;
    if (!cryptoAvailable()) { alert('Cannot unlock here', 'This browser does not offer encryption on this address (it needs https or localhost).'); return doc; }
    const r = await this.decrypt(doc.bytes, null, basename(doc.path));
    const i = this.docs.indexOf(doc);
    if (!r || i < 0) return doc;
    const d = this.docFromBytes(doc.path, { bytes: r.plain, mtime: doc.mtime, size: r.plain.length }, { plain: true, asText: true });
    d.id = doc.id;
    d.crypto = r.lock;
    d.conflictCopies = doc.conflictCopies;
    this.docs[i] = d;
    if (this.active === doc) { this.active = null; this.activate(d, opts); } else this.emit('docs');
    if (opts.line) this.gotoLine(opts.line, opts.col);
    this.store.backupDelete(d.id).catch(() => {});
    this.saveSession();
    return d;
  }

  // Encrypts the active note with a new passphrase (or changes it).
  async encryptDoc(d = this.active) {
    if (d?.kind !== 'text' || d.readOnly) return;
    if (!cryptoAvailable()) { alert('Cannot encrypt here', 'This browser does not offer encryption on this address (it needs https or localhost).'); return; }
    if (!d.path || this.isScratch(d)) { if (!(await this.saveAs(d))) return; }
    const one = await prompt(d.crypto ? 'New passphrase' : 'Encrypt this note', { label: 'Passphrase', type: 'password', ok: 'Next', note: 'There is no way to recover a forgotten passphrase: the note would be lost. Search and the widgets cannot read encrypted notes.' });
    if (!one) return;
    const two = await prompt('Repeat the passphrase', { label: 'Passphrase', type: 'password', ok: 'Encrypt' });
    if (two == null) return;
    if (one !== two) { toast('The two passphrases differ', { error: true }); return; }
    d.crypto = await newLock(one);
    this.lastPass = one;
    this.store.backupDelete(d.id).catch(() => {});
    // earlier versions were kept as plain text: remove them
    for (const v of await this.store.versions(d.path).catch(() => [])) await this.backend.remove(v.path).catch(() => {});
    this.store.lastVersion.delete(d.path);
    d.savedDoc = Text.of(['\u0000changed']); // the bytes on disk differ now
    this.markChanged(d);
    if (await this.save(d, { auto: true })) toast('Encrypted. Keep the passphrase safe.', { ms: 4000 });
  }

  async removeEncryption(d = this.active) {
    if (d?.kind !== 'text' || !d.crypto) return;
    if (!(await confirm('Remove encryption?', `${this.displayName(d)} will be saved as plain text again.`, { ok: 'Remove encryption', danger: true }))) return;
    d.crypto = null;
    d.savedDoc = Text.of(['\u0000changed']);
    this.markChanged(d);
    await this.save(d, { auto: true });
  }

  // Locks every unlocked note again and forgets the passphrase.
  async lockAll() {
    this.lastPass = null;
    let n = 0;
    for (const d of [...this.docs]) {
      if (d.kind !== 'text' || !d.crypto || !d.path) continue;
      if (this.dirty(d) && !(await this.save(d, { auto: true }))) continue;
      await this.open(d.path, { reload: true, locked: true, focus: this.active === d });
      n++;
    }
    toast(n ? `Locked ${n} note${n > 1 ? 's' : ''}` : 'No unlocked notes');
  }

  activate(doc, { focus = true } = {}) {
    if (!doc) return;
    const prev = this.active;
    if (prev && prev.kind === 'text' && prev !== doc) {
      prev.state = this.view.state;
      prev.scroll = { top: this.view.scrollDOM.scrollTop, left: this.view.scrollDOM.scrollLeft };
    }
    this.active = doc;
    if (doc.kind === 'text') {
      if (prev !== doc || this.view.state !== doc.state) this.view.setState(doc.state);
      if (doc.configStale) this.reconfigureActive();
      if (doc.scroll) { const s = doc.scroll; requestAnimationFrame(() => { this.view.scrollDOM.scrollTop = s.top; this.view.scrollDOM.scrollLeft = s.left; }); }
      if (focus && !this.mobile) requestAnimationFrame(() => this.view.focus());
    }
    this.emit('active', doc);
    this.emit('cursor', doc);
    this.updateTitle();
    this.saveSession();
  }

  gotoLine(line, col = 1) {
    const d = this.active;
    if (d?.kind !== 'text') return;
    const doc = this.view.state.doc;
    const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
    const pos = Math.min(l.to, l.from + Math.max(0, col - 1));
    this.view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    this.view.focus();
  }

  nextTab(dir) {
    if (!this.docs.length) return;
    const i = this.docs.indexOf(this.active);
    this.activate(this.docs[(i + dir + this.docs.length) % this.docs.length]);
  }

  moveTab(from, to) {
    const [d] = this.docs.splice(from, 1);
    this.docs.splice(to, 0, d);
    this.emit('docs');
    this.saveSession();
  }

  updateTitle() {
    const d = this.active;
    const t = d ? `${this.dirty(d) ? '● ' : ''}${this.displayName(d)}${d.path ? ' — ' + this.displayDir(d) : ''} — ${APP_NAME}` : APP_NAME;
    this.backend.setTitle?.(t);
  }

  // ── saving ───────────────────────────────────────────────
  textOf(d) {
    if (this.active === d) d.state = this.view.state;
    return d.state.doc.toString();
  }

  // Applies save-time cleanups as a normal (undoable) edit.
  tidyBeforeSave(d) {
    const s = this.settings.values;
    const changes = [];
    if (s.trimTrailingWhitespaceOnSave) changes.push(...trimTrailingChanges(d.state));
    if (s.insertFinalNewlineOnSave && d.state.doc.length && !d.state.doc.sliceString(d.state.doc.length - 1).endsWith('\n')) changes.push({ from: d.state.doc.length, insert: '\n' });
    if (!changes.length) return;
    const spec = { changes, userEvent: 'input.tidy' };
    if (this.active === d) { this.view.dispatch(spec); d.state = this.view.state; } else d.state = d.state.update(spec).state;
  }

  async save(d = this.active, { auto = false, overwrite = false } = {}) {
    if (!d || d.kind !== 'text' || d.readOnly) return false;
    if (!d.path) return auto ? false : this.saveAs(d);
    if (!auto && this.isScratch(d)) return this.saveAs(d);
    if (!auto) this.tidyBeforeSave(d);
    const snapshot = d.state.doc;
    if (d.encoding === 'ANSI' && ansiLossy(snapshot.toString()) && !auto) {
      if (!(await confirm('Characters will be lost', 'This file is ANSI, which cannot hold some characters you typed (they become "?"). Convert it to UTF-8 instead?', { ok: 'Convert to UTF-8', cancel: 'Save as ANSI' }))) { /* keep ANSI */ } else d.encoding = 'UTF-8';
    }
    d.saving = true;
    this.emit('saving', d);
    try {
      let bytes = encode(snapshot.toString(), d.encoding, d.eol);
      if (d.crypto) bytes = await encryptBytes(bytes, d.crypto);
      const r = await this.backend.write(d.path, bytes, overwrite ? null : d.mtime);
      this.store.addVersion(d.path, bytes).catch((e) => console.warn('history', e)); // File → History
      d.mtime = r.mtime;
      d.savedDoc = snapshot;
      d.conflict = null;
      d.wasDirty = this.dirty(d);
      this.store.backupDelete(d.id).catch(() => {});
      if (d.path === this.settingsPath) await this.settings.load();
      this.emit('saved', d);
      return true;
    } catch (e) {
      if (e.code === 'CONFLICT') {
        d.conflict = 'changed';
        this.emit('conflict', d);
        if (!auto) return this.resolveConflict(d);
        return false;
      }
      toast(`Not saved: ${e.message}`, { error: true });
      this.emit('save-failed', d);
      return false;
    } finally {
      d.saving = false;
      this.emit('docs');
      this.updateTitle();
    }
  }

  async resolveConflict(d) {
    const v = await confirm('Changed on disk', `${this.displayName(d)} was changed by another program or device since you opened it.`, { ok: 'Overwrite', cancel: 'Cancel', third: 'Reload theirs', danger: true });
    if (v === true) return this.save(d, { overwrite: true });
    if (v === 'third') { await this.reload(d, { force: true }); return false; }
    return false;
  }

  async saveAs(d = this.active) {
    if (!d || d.kind !== 'text') return false;
    const scratch = this.isScratch(d) ? d.path : null;
    const name = d.path && !scratch ? basename(d.path) : (d.untitled || 'untitled').replace(/\s+/g, '-') + (scratch ? extname(scratch) : '.txt');
    let target;
    if (this.backend.pickSavePath && this.backend.canOpenAnywhere) {
      const base = d.path && !scratch ? dirname(d.path) : this.backend.notesRoot ?? this.backend.home;
      target = await this.backend.pickSavePath(join(base, name));
    } else {
      const rel = await prompt('Save as', { label: `Path inside ${this.backend.notesName}`, value: d.path && !scratch ? relative(d.path, this.backend.notesRoot) : name, ok: 'Save', selectStem: true });
      if (!rel) return false;
      const clean = rel.trim().replace(/^\/+/, '');
      if (!clean.split('/').every(validName)) { toast('That is not a valid file name', { error: true }); return false; }
      target = join(this.backend.notesRoot, clean);
    }
    if (!target) return false;
    const st = await this.backend.stat(target).catch(() => null);
    if (st && !(await confirm('Replace file?', `${basename(target)} already exists. Replace it?`, { ok: 'Replace', danger: true }))) return false;
    const other = this.findDoc(target);
    if (other && other !== d) this.closeDoc(other, { force: true });
    await this.backend.mkdirAll(dirname(target)).catch(() => {});
    const oldPath = d.path;
    d.path = target;
    d.untitled = null;
    d.mtime = null;
    const oldUntitled = d.untitled;
    const ok = await this.save(d, { overwrite: true });
    if (!ok) { d.path = oldPath; d.untitled = oldUntitled; return false; }
    if (scratch && scratch !== target) { await this.backend.remove(scratch).catch(() => {}); this.emit('tree-changed', dirname(scratch)); }
    if (!oldPath || scratch) this.loadLanguage(d, null);
    this.emit('docs');
    this.emit('tree-changed', dirname(target));
    this.saveSession();
    return true;
  }

  async saveAll() {
    for (const d of this.docs) if (this.dirty(d)) await this.save(d);
  }

  scheduleAutosave(d) {
    const mode = this.settings.get('autosave');
    if (!d.path || d.readOnly) return;
    if (!this.isScratch(d)) { // scratch files are always saved: they are the backup
      if (mode === 'off') return;
      if (mode === 'notes' && !this.inNotes(d.path)) return;
    }
    clearTimeout(this.autosaveTimers.get(d.id));
    this.autosaveTimers.set(d.id, setTimeout(() => {
      if (this.dirty(d) && this.docs.includes(d) && !d.conflict && !d.saving) this.save(d, { auto: true });
    }, this.settings.get('autosaveDelayMs')));
  }

  scheduleBackup(d) {
    clearTimeout(this.backupTimers.get(d.id));
    if (d.crypto) return; // an encrypted note's text is never copied anywhere in plain
    this.backupTimers.set(d.id, setTimeout(() => this.backupNow(d), this.settings.get('backupDelayMs')));
  }

  backupNow(d) {
    clearTimeout(this.backupTimers.get(d.id));
    if (!this.docs.includes(d) || d.kind !== 'text' || d.crypto) return Promise.resolve();
    return (this.dirty(d) ? this.store.backupWrite(d.id, this.textOf(d)) : this.store.backupDelete(d.id)).catch(() => {});
  }

  // ── reload, encoding, line endings ───────────────────────
  async reload(d = this.active, { force = false, encoding = null } = {}) {
    if (!d?.path) return;
    if (!force && this.dirty(d) && !(await confirm('Reload from disk?', `Your unsaved changes to ${this.displayName(d)} will be lost.`, { ok: 'Reload', danger: true }))) return;
    let r;
    try { r = await this.backend.read(d.path); } catch (e) { toast(e.message, { error: true }); return; }
    if (d.kind !== 'text') { Object.assign(d, { bytes: r.bytes, mtime: r.mtime, size: r.size }); this.emit('active', d); return; }
    if (isEncrypted(r.bytes)) {
      if (!d.crypto) { await this.open(d.path, { reload: true, focus: this.active === d }); return; } // encrypted elsewhere: lock the tab
      const dec = await this.decrypt(r.bytes, d.crypto, this.displayName(d));
      if (!dec) return;
      d.crypto = dec.lock;
      r.bytes = dec.plain;
    } else if (d.crypto) d.crypto = null; // plain text on disk now
    const { text, encoding: enc, eol } = decode(r.bytes, encoding);
    const sel = d.state.selection.main.head;
    const spec = { changes: { from: 0, to: d.state.doc.length, insert: text }, selection: EditorSelection.cursor(Math.min(sel, text.length)), userEvent: 'reload' };
    if (this.active === d) { this.view.dispatch(spec); d.state = this.view.state; } else d.state = d.state.update(spec).state;
    Object.assign(d, { savedDoc: d.state.doc, mtime: r.mtime, encoding: enc, eol: eol || d.eol, conflict: null, wasDirty: false });
    this.store.backupDelete(d.id).catch(() => {});
    this.emit('docs');
    this.emit('cursor', d);
    this.emit('content', d);
    this.updateTitle();
  }

  // "Convert to" keeps the text and saves it in another encoding.
  convertEncoding(enc) {
    const d = this.active;
    if (d?.kind !== 'text' || d.encoding === enc) return;
    d.encoding = enc;
    d.savedDoc = Text.of(['\u0000changed']); // forces dirty: the bytes on disk differ now
    this.markChanged(d);
  }

  setEol(eol) {
    const d = this.active;
    if (d?.kind !== 'text' || d.eol === eol) return;
    d.eol = eol;
    d.savedDoc = Text.of(['\u0000changed']);
    this.markChanged(d);
  }

  markChanged(d) {
    d.wasDirty = true;
    this.emit('docs');
    this.emit('cursor', d);
    this.scheduleAutosave(d);
    this.scheduleBackup(d);
    this.updateTitle();
  }

  // ── closing ──────────────────────────────────────────────
  async closeDoc(d = this.active, { force = false } = {}) {
    if (!d) return true;
    const scratch = this.isScratch(d);
    if (scratch && d.kind === 'text' && !force) {
      // scratch tabs keep their file; an empty one is removed
      if (this.dirty(d)) await this.save(d, { auto: true });
      if (!d.state.doc.length) { await this.backend.remove(d.path).catch(() => {}); this.emit('tree-changed', dirname(d.path)); }
      else toast(`Kept in ${this.backend.notesName}/${relative(dirname(d.path), this.backend.notesRoot)}`, { ms: 2500 });
    } else if (!force && this.dirty(d)) {
      this.activate(d);
      const v = await confirm('Save changes?', `Save changes to ${this.displayName(d)} before closing?`, { ok: 'Save', cancel: 'Cancel', third: "Don't save" });
      if (v === false) return false;
      if (v === true && !(await this.save(d))) return false;
    }
    clearTimeout(this.autosaveTimers.get(d.id));
    clearTimeout(this.backupTimers.get(d.id));
    this.store.backupDelete(d.id).catch(() => {});
    if (d.path) { this.closed = [d.path, ...this.closed.filter((p) => p !== d.path)].slice(0, this.settings.get('recentlyClosedKept')); }
    const i = this.docs.indexOf(d);
    this.docs.splice(i, 1);
    if (this.active === d) {
      this.active = null;
      const next = this.docs[Math.min(i, this.docs.length - 1)];
      if (next) this.activate(next); else { this.emit('active', null); this.updateTitle(); }
    }
    this.emit('docs');
    this.saveSession();
    return true;
  }

  async closeMany(list) {
    for (const d of list) if (!(await this.closeDoc(d))) return false;
    return true;
  }
  closeAll() { return this.closeMany([...this.docs]); }
  closeOthers(keep = this.active) { return this.closeMany(this.docs.filter((d) => d !== keep)); }
  closeRight(of = this.active) { return this.closeMany(this.docs.slice(this.docs.indexOf(of) + 1)); }

  async reopenClosed() {
    while (this.closed.length) {
      const p = this.closed.shift();
      if (await this.open(p)) return;
    }
    toast('No recently closed files');
  }

  // ── files and folders ────────────────────────────────────
  addRoot(path) {
    if (this.roots.some((r) => r.path === path)) { this.emit('reveal', path); return; }
    this.extraRoots.push(path);
    this.emit('roots');
    this.saveSession();
  }

  removeRoot(path) {
    this.extraRoots = this.extraRoots.filter((p) => p !== path);
    this.emit('roots');
    this.saveSession();
  }

  async createIn(dir, kind) {
    const name = await prompt(kind === 'dir' ? 'New folder' : 'New file', { label: 'Name', value: kind === 'dir' ? '' : 'untitled.md', ok: 'Create', selectStem: true });
    if (!name) return;
    const parts = name.trim().split('/').filter(Boolean);
    if (!parts.length || !parts.every(validName)) { toast('That is not a valid name', { error: true }); return; }
    const path = join(dir, ...parts);
    try {
      if (kind === 'dir') await this.backend.mkdirAll(path);
      else { await this.backend.mkdirAll(dirname(path)); await this.backend.createFile(path); }
    } catch (e) {
      toast(e.code === 'EXISTS' ? `${parts.at(-1)} already exists` : e.message, { error: true });
      return;
    }
    this.emit('tree-changed', dirname(path));
    if (kind !== 'dir') await this.open(path);
    else this.emit('reveal', path);
  }

  async renamePath(path) {
    const name = await prompt('Rename', { label: 'New name', value: basename(path), ok: 'Rename', selectStem: true });
    if (!name || name === basename(path)) return;
    if (!validName(name)) { toast('That is not a valid name', { error: true }); return; }
    const to = join(dirname(path), name);
    await this.movePath(path, to);
  }

  async movePath(path, to, { keepLanguage = false } = {}) {
    try {
      await this.backend.rename(path, to);
    } catch (e) {
      toast(e.code === 'EXISTS' ? `${basename(to)} already exists there` : e.message, { error: true });
      return false;
    }
    for (const d of this.docs) {
      if (d.path && isInside(d.path, path)) {
        d.path = to + d.path.slice(path.length);
        const st = await this.backend.stat(d.path).catch(() => null);
        if (st) d.mtime = st.mtime;
        if (d.kind === 'text' && !keepLanguage) this.loadLanguage(d, null);
      }
    }
    this.emit('tree-changed', dirname(path));
    this.emit('tree-changed', dirname(to));
    this.emit('docs');
    this.updateTitle();
    this.saveSession();
    return true;
  }

  async trashPath(path) {
    const where = this.inNotes(path) ? `${this.backend.notesName}/${trashDirOf(this.backend)}` : 'the system trash';
    if (this.settings.get('confirmDelete') && !(await confirm('Move to trash?', `${basename(path)} goes to ${where}. You can restore it from there.`, { ok: 'Move to trash', danger: true }))) return;
    try {
      await this.backend.trash(path);
    } catch (e) { toast(e.message, { error: true }); return; }
    for (const d of [...this.docs]) if (d.path && isInside(d.path, path)) await this.closeDoc(d, { force: true });
    this.emit('tree-changed', dirname(path));
    toast(`Moved ${basename(path)} to trash`);
  }

  async emptyTrash() {
    const days = this.settings.get('trashDays');
    if (!(await confirm('Empty trash?', `Permanently delete items that have been in ${this.backend.notesName}/${trashDirOf(this.backend)} for more than ${days} days?`, { ok: 'Delete', danger: true }))) return;
    try {
      const r = await this.backend.trashPurge(days);
      toast(`Removed ${r.removed} item${r.removed === 1 ? '' : 's'} from trash`);
    } catch (e) { toast(e.message, { error: true }); }
  }

  // Syncthing leaves "name.sync-conflict-…" next to a note when two devices edit it.
  async checkConflictCopies(doc) {
    if (!doc.path) return;
    try {
      const items = await this.backend.list(dirname(doc.path));
      const stem = basename(doc.path).replace(/\.[^.]+$/, '');
      const copies = items.filter((i) => !i.dir && i.name.startsWith(stem + '.sync-conflict-')).map((i) => join(dirname(doc.path), i.name));
      doc.conflictCopies = copies;
      if (copies.length) this.emit('active', this.active);
    } catch { /* listing is best effort */ }
  }

  // What a sync-conflict copy holds, next to this note: keep mine, or take theirs.
  async compareConflict(d, copy) {
    if (d?.kind !== 'text') { this.open(copy); return; }
    let r;
    try { r = await this.backend.read(copy); } catch (e) { toast(e.message, { error: true }); return; }
    let bytes = r.bytes;
    if (isEncrypted(bytes)) { const dec = await this.decrypt(bytes, d.crypto, basename(copy)); if (!dec) return; bytes = dec.plain; }
    const theirs = lf(decode(bytes).text);
    const v = await showDiff({
      title: 'Sync conflict', fromLabel: this.displayName(d), toLabel: basename(copy), from: this.textOf(d), to: theirs,
      actions: [{ label: 'Open the copy', value: 'open' }, ...(d.readOnly ? [] : [{ label: 'Use theirs', value: 'theirs' }, { label: 'Keep mine', value: 'mine', primary: true }])],
    });
    if (v === 'open') { this.open(copy); return; }
    if (v !== 'mine' && v !== 'theirs') return;
    if (v === 'theirs') this.replaceText(d, theirs, 'input.conflict');
    try { await this.backend.trash(copy); } catch (e) { toast(e.message, { error: true }); return; }
    for (const o of [...this.docs]) if (o.path === copy) await this.closeDoc(o, { force: true });
    this.emit('tree-changed', dirname(copy));
    await this.checkConflictCopies(d);
    this.emit('docs');
    toast(v === 'mine' ? 'Kept your version; the copy is in the trash' : 'Took their version (Ctrl+Z undoes it); the copy is in the trash', { ms: 4500 });
  }

  // ── history: earlier versions of a note (core/store.js) ──
  async showHistory(d = this.active) {
    if (d?.kind !== 'text' || !d.path) return;
    const versions = await this.store.versions(d.path).catch(() => []);
    if (!versions.length) { toast(this.store.historyDir(d.path) ? 'No earlier versions yet: one is kept as the note is saved' : 'History is kept for notes in the notes folder'); return; }
    const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
    const chosen = await pick({ title: `History of ${this.displayName(d)}`, placeholder: 'Filter by date or device', items: versions.map((v) => ({ label: v.time.toLocaleString(), detail: `${v.device} · ${kb(v.size)}`, value: v })) });
    if (!chosen) return;
    let r;
    try { r = await this.backend.read(chosen.path); } catch (e) { toast(e.message, { error: true }); return; }
    let bytes = r.bytes;
    if (isEncrypted(bytes)) { const dec = await this.decrypt(bytes, d.crypto, this.displayName(d)); if (!dec) return; bytes = dec.plain; }
    const old = lf(decode(bytes).text);
    const v = await showDiff({
      title: `${this.displayName(d)} — ${chosen.time.toLocaleString()}`, fromLabel: 'now', toLabel: 'that version', from: this.textOf(d), to: old,
      actions: d.readOnly ? [] : [{ label: 'Restore this version', value: 'restore', primary: true }],
    });
    if (v === 'restore' && this.replaceText(d, old, 'input.restore')) toast('Restored (Ctrl+Z undoes it)');
  }

  // ── links between notes ──────────────────────────────────
  // Names offered after "[[": the file stem, or the path when two notes share a stem.
  async noteNames() {
    const files = (await this.index.files()).filter((f) => isMarkdown(f.rel));
    const count = new Map();
    const stemOf = (f) => basename(f.rel).replace(/\.[^.]+$/, '');
    for (const f of files) count.set(stemOf(f).toLowerCase(), (count.get(stemOf(f).toLowerCase()) || 0) + 1);
    return files.map((f) => ({ label: count.get(stemOf(f).toLowerCase()) > 1 ? f.rel.replace(/\.[^./]+$/, '') : stemOf(f), detail: dirname(f.rel) || '' }));
  }

  // Opens the note a [[link]] names; offers to create it when there is none.
  async openWiki(target, heading = '', { view = false } = {}) {
    const from = this.active?.path || '';
    if (!target) { if (heading) this.gotoHeading(heading); return null; }
    if (this.backend.notesRoot == null) return null;
    let hit = resolveWiki(target, await this.index.files(), from);
    if (!hit) {
      if (this.backend.readOnly) { toast(`No note called "${target}"`); return null; }
      const parts = (/\.[A-Za-z0-9]{1,8}$/.test(target) ? target : target + '.md').split('/').map((x) => x.trim()).filter(Boolean);
      if (!parts.length || !parts.every(validName)) { toast('That link is not a valid file name', { error: true }); return null; }
      const dir = !target.includes('/') && from && this.inNotes(from) && !this.isScratch(this.active) ? dirname(from) : this.backend.notesRoot;
      const path = join(dir, ...parts);
      if (!(await confirm('Create note?', `There is no note called "${target}" yet. Create ${relative(path, this.backend.notesRoot)}?`, { ok: 'Create' }))) return null;
      try {
        await this.backend.mkdirAll(dirname(path));
        await this.backend.createFile(path);
      } catch (e) { if (e.code !== 'EXISTS') { toast(e.message, { error: true }); return null; } }
      this.emit('tree-changed', dirname(path));
      hit = { path };
    }
    const d = await this.open(hit.path);
    if (d && view && d.kind === 'text' && isMarkdown(d.path)) this.setView(d, true);
    if (d && heading) this.gotoHeading(heading);
    return d;
  }

  gotoHeading(text) {
    const d = this.active;
    if (d?.kind !== 'text' || d.view) return;
    const want = text.trim().toLowerCase();
    const all = headings(this.textOf(d));
    const hit = all.find((x) => x.text.toLowerCase() === want) || all.find((x) => x.text.toLowerCase().includes(want));
    if (hit) this.gotoLine(hit.line);
  }

  // Alt+Enter: opens the [[link]], [text](link) or #tag under the cursor.
  async followLink() {
    const d = this.active;
    if (d?.kind !== 'text') return;
    const st = this.view.state;
    const line = st.doc.lineAt(st.selection.main.head);
    const off = st.selection.main.head - line.from;
    const wiki = wikiLinkAt(line.text, off);
    if (wiki) { await this.openWiki(wiki.target, wiki.heading); return; }
    for (const m of line.text.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)|<?(https?:\/\/[^\s<>)\]]+)>?/g)) {
      if (off < m.index || off > m.index + m[0].length) continue;
      const href = m[1] || m[2];
      if (/^(https?:|mailto:)/i.test(href)) { this.emit('open-external', href); return; }
      const target = decodeURIComponent(href.split('#')[0]);
      const base = d.path ? dirname(d.path) : this.backend.notesRoot;
      if (target && base != null) await this.open(target.startsWith('/') ? join(this.backend.notesRoot, target) : join(base, target));
      return;
    }
    const tag = tagAt(line.text, off);
    if (tag) { this.emit('search', { query: tagPattern(tag), regex: true }); return; }
    toast('No link under the cursor');
  }

  // Find in files for every note that links to this one.
  backlinks(d = this.active) {
    if (!d?.path) return;
    this.emit('search', { query: backlinkPattern(d.path), regex: true });
  }

  async findTag() {
    const d = this.active;
    let tag = null;
    if (d?.kind === 'text') { const st = this.view.state; const line = st.doc.lineAt(st.selection.main.head); tag = tagAt(line.text, st.selection.main.head - line.from); }
    tag ??= (await prompt('Find tag', { label: 'Tag', placeholder: 'work', ok: 'Find' }))?.trim().replace(/^#/, '');
    if (tag) this.emit('search', { query: tagPattern(tag), regex: true });
  }

  // Today's note: <notes>/<dailyFolder>/2026-11-17.md, made from the template when new.
  async dailyNote() {
    const root = this.backend.notesRoot;
    if (root == null) return;
    const date = isoDate();
    const path = join(root, this.settings.get('dailyFolder'), date + '.md');
    if (!(await this.backend.stat(path).catch(() => null))) {
      if (this.backend.readOnly) { toast('The demo is read-only'); return; }
      try {
        await this.backend.mkdirAll(dirname(path));
        await this.backend.write(path, encode(this.settings.get('dailyTemplate').replaceAll('{date}', date), 'UTF-8', this.settings.get('newFileEol')), null);
      } catch (e) { toast(e.message, { error: true }); return; }
      this.emit('tree-changed', dirname(path));
    }
    const d = await this.open(path);
    if (d?.kind === 'text') this.gotoLine(d.state.doc.lines);
  }

  // Find in files → Replace all, for one file. Open files change in their tab
  // (undoable); others are rewritten on disk, with the old text kept in History.
  async replaceInFile(path, re, repl) {
    const count = (text) => { let n = 0; for (const m of text.matchAll(re)) if (m[0] !== '') n++; return n; };
    const d = this.findDoc(path);
    if (d) {
      if (d.kind !== 'text' || d.readOnly) return 0;
      const text = this.textOf(d);
      const n = count(text);
      return n && this.replaceText(d, text.replace(re, repl), 'input.replace') ? n : 0;
    }
    const r = await this.backend.read(path);
    if (isEncrypted(r.bytes) || looksBinary(r.bytes)) return 0;
    const { text, encoding } = decode(r.bytes);
    const n = count(text);
    const next = n ? text.replace(re, repl) : text;
    if (next === text) return 0;
    await this.store.addVersion(path, r.bytes, { minutes: 0 }).catch(() => {});
    await this.backend.write(path, encode(next, encoding, 'LF'), r.mtime); // the text still has its own line endings
    return n;
  }

  // ── disk changes ─────────────────────────────────────────
  async checkDisk() {
    for (const d of [...this.docs]) {
      if (!d.path || d.saving) continue;
      const st = await this.backend.stat(d.path).catch(() => undefined);
      if (st === undefined) continue; // offline or error: try later
      if (st === null) {
        if (d.conflict !== 'deleted') { d.conflict = 'deleted'; this.emit('conflict', d); this.emit('docs'); }
        continue;
      }
      if (d.conflict === 'deleted') { d.conflict = null; this.emit('conflict', d); }
      if (d.mtime != null && st.mtime !== d.mtime) {
        if (!this.dirty(d)) await this.reload(d, { force: true });
        else if (d.conflict !== 'changed') { d.conflict = 'changed'; this.emit('conflict', d); this.emit('docs'); }
      }
    }
    await this.settings.refresh();
  }

  // ── clean View (markdown, CSV) instead of the editor ─────
  setView(d, on) {
    if (!d) return;
    d.view = !!on;
    this.emit('view', d);
    if (!on && d === this.active) this.view.focus();
    this.saveSession();
  }

  // ── preview panel ────────────────────────────────────────
  setPreview(on) {
    this.ui.preview = on;
    this.emit('preview', on);
    this.saveSession();
  }

  // ── hot exit ─────────────────────────────────────────────
  sessionData() {
    if (this.active?.kind === 'text') this.active.state = this.view.state;
    return {
      v: 1,
      tabs: this.docs.map((d) => ({
        id: d.id, path: d.path, untitled: d.untitled || null, kind: d.kind, lang: d.kind === 'text' && d.langName !== PLAIN && d.langNameManual ? d.langName : null,
        encoding: d.encoding || null, eol: d.eol || null, view: d.view || null, sel: d.kind === 'text' ? { a: d.state.selection.main.anchor, h: d.state.selection.main.head } : null,
      })),
      active: this.active?.id || null,
      roots: this.extraRoots,
      closed: this.closed,
      ui: this.ui,
      untitledCounter: this.untitledCounter,
    };
  }

  async writeSession() {
    try { await this.store.saveSession(this.sessionData()); } catch (e) { console.warn('session not saved', e); }
  }

  // Writes every pending backup and the session; called before the window closes.
  async flush() {
    this.saveSession.cancel();
    // encrypted notes have no plain backup: save them instead
    for (const d of this.docs) if (d.kind === 'text' && d.crypto && d.path && !d.readOnly && this.dirty(d) && !d.conflict) await this.save(d, { auto: true }).catch(() => {});
    await Promise.all(this.docs.filter((d) => d.kind === 'text').map((d) => this.backupNow(d)));
    await this.writeSession();
  }

  // Step 1 of restoring: layout and folders, before the UI is built.
  async loadSession() {
    const s = await this.store.loadSession().catch(() => null);
    if (s?.ui && typeof s.ui === 'object') Object.assign(this.ui, s.ui);
    if (Array.isArray(s?.roots)) this.extraRoots = s.roots.filter((p) => typeof p === 'string');
    if (Array.isArray(s?.closed)) this.closed = s.closed.slice(0, 200);
    this.untitledCounter = s?.untitledCounter || 0;
    this.session = s;
    return s;
  }

  // Step 2: reopen the tabs, with unsaved edits from their backups.
  async restore() {
    const s = this.session;
    const backups = new Set(await this.store.backupList().catch(() => []));
    let activeDoc = null;
    for (const t of s?.tabs || []) {
      const backup = backups.has(t.id) ? await this.store.backupRead(t.id).catch(() => null) : null;
      let d = null;
      if (t.path) {
        const st = await this.backend.stat(t.path).catch(() => null);
        if (st && !st.dir) {
          try {
            const r = await this.backend.read(t.path);
            d = this.docFromBytes(t.path, r, { encoding: t.kind === 'text' && t.encoding !== decode(r.bytes).encoding ? t.encoding : null, lang: t.lang, asText: t.kind === 'text' && backup != null });
          } catch { d = null; }
        } else if (backup != null) {
          d = this.makeTextDoc({ path: t.path, text: '', encoding: t.encoding || 'UTF-8', eol: t.eol, lang: t.lang });
          d.conflict = 'deleted';
        }
      } else if (backup != null) {
        d = this.makeTextDoc({ path: null, untitled: t.untitled || 'new', text: '', encoding: t.encoding || 'UTF-8', eol: t.eol, lang: t.lang });
      }
      if (!d) { backups.delete(t.id); continue; }
      d.id = t.id;
      if (t.untitled && t.path && this.store.isScratch(t.path)) d.untitled = t.untitled;
      if (t.lang) d.langNameManual = true;
      if (t.view) d.view = true;
      if (backup != null && d.kind === 'text') {
        d.state = d.state.update({ changes: { from: 0, to: d.state.doc.length, insert: backup } }).state;
        d.wasDirty = this.dirty(d);
      }
      if (t.sel && d.kind === 'text') {
        const len = d.state.doc.length;
        d.state = d.state.update({ selection: EditorSelection.range(Math.min(t.sel.a, len), Math.min(t.sel.h, len)) }).state;
      }
      backups.delete(t.id);
      this.docs.push(d);
      if (t.id === s.active) activeDoc = d;
    }
    for (const orphan of backups) this.store.backupDelete(orphan).catch(() => {});
    if (this.store.legacy) { // moved from 0.0.1's data folder: copy the backups over, then forget the old ones
      await Promise.all(this.docs.filter((d) => this.dirty(d)).map((d) => this.store.backupWrite(d.id, this.textOf(d)).catch(() => {})));
      await this.store.finishMigration();
      this.writeSession();
    }
    this.emit('docs');
    this.emit('roots');
    if (this.docs.length) this.activate(activeDoc || this.docs[0], { focus: true });
    else this.emit('active', null);
    for (const d of this.docs) if (d.kind === 'text' && d.path) this.checkConflictCopies(d);
  }

  // ── settings file ────────────────────────────────────────
  async openSettingsFile() {
    const p = this.settingsPath;
    if (!p) return;
    if (!(await this.backend.stat(p).catch(() => null))) await this.settings.save();
    const d = await this.open(p);
    if (d && d.langName !== 'JSON') this.setLanguageName('JSON');
  }

  async chooseNotesRoot(first = false) {
    const be = this.backend;
    if (!be.setNotesRoot) return;
    const input = h('input', { value: be.notesRoot || be.defaultNotesRoot || '', spellcheck: 'false', autocapitalize: 'off' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.closest('dialog')?.done(input.value); } });
    const browse = be.pickFolder && (be.kind === 'desktop' || be.kind === 'android')
      ? h('button', { type: 'button', onclick: async () => { const p = await be.pickFolder('Choose your notes folder'); if (p) input.value = p; } }, 'Browse…')
      : null;
    const body = h('div', {},
      h('p', {}, first
        ? 'mnemostxt keeps one folder always in the sidebar — your notes. Its settings live there too, in logs/mnemostxt/settings.json, so every device shares them.'
        : 'The notes folder is always in the sidebar and holds the shared settings file.'),
      h('label.f', {}, h('span', {}, 'Notes folder'), h('div.row', {}, input, browse)),
      be.kind === 'android' ? h('p.muted', {}, `Android: allow "All files access" for ${APP_NAME} when asked, so it can read a folder like /storage/emulated/0/notes. Browse… opens the system folder picker.`) : null);
    const v = await sheet({ title: first ? `Welcome to ${APP_NAME}` : 'Notes folder', body, actions: first ? [{ label: 'Use this folder', primary: true, run: () => input.value }] : [{ label: 'Cancel' }, { label: 'Use this folder', primary: true, run: () => input.value }] });
    const path = (v || '').trim();
    if (!path) { if (first && !be.notesRoot) return this.chooseNotesRoot(true); return; }
    try {
      await be.setNotesRoot(path);
    } catch (e) {
      await alert('Cannot use that folder', e.message);
      return this.chooseNotesRoot(first);
    }
    await this.settings.load();
    this.applyLook();
    this.syncDevice();
    this.emit('roots');
  }
}
