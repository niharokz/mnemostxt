// Compare (Linux, Windows, web): two texts side by side, Beyond Compare style.
// Lines line up, changed lines are tinted and the changed words inside them
// marked. Both sides can be edited, a difference copied either way, each side
// saved; rules decide what counts as a difference; the result can be saved as
// a patch. Built on @codemirror/merge; the text logic is core/compare.js.
//
// openCompare(app, { left, right }) — each side one of:
//   { path }            a file, read from disk
//   { tab: doc }        an open tab: saving puts the text back into the tab
//   { saved: doc }      what the tab's file holds on disk now (read-only)
//   { text, label }     loose text (the clipboard); saving asks for a file
import { MergeView } from '@codemirror/merge';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars } from '@codemirror/view';
import { history, historyField, historyKeymap, standardKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { editorTheme } from '../editor/theme.js';
import { detect } from '../core/languages.js';
import { decode, encode, looksBinary } from '../core/encoding.js';
import { DEFAULT_RULES, WS_RULES, diffConfig, copyChunkChange, summary, unifiedDiff, rulesActive } from '../core/compare.js';
import { basename, dirname, join, pretty, relative, validName, isInside } from '../core/paths.js';
import { h, icon } from './dom.js';
import { toast, confirm, prompt, contextMenu, holdDialog } from './dialogs.js';
import { pick } from './picker.js';

const SIDES = ['a', 'b'];
const NAME = { a: 'Left', b: 'Right' };
let current = null; // one Compare window at a time

export async function openCompare(app, { left = null, right = null } = {}) {
  if (current) {
    if (!(await current.close())) return;
  }
  const cmp = new CompareWindow(app);
  current = cmp;
  await cmp.start(left, right);
}

class CompareWindow {
  constructor(app) {
    this.app = app;
    this.be = app.backend;
    const saved = app.settings.get('compareOptions') || {};
    this.opt = {
      rules: { ...DEFAULT_RULES, ...(saved.rules || {}) },
      filter: saved.filter === 'diffs' ? 'diffs' : 'all',
      context: Number.isInteger(saved.context) ? saved.context : 3,
      wrap: !!saved.wrap,
    };
    this.sides = { a: empty(), b: empty() };
    this.mv = null;
    this.focus = 'a';
    this.c = { a: { lang: new Compartment(), wrap: new Compartment(), ro: new Compartment() }, b: { lang: new Compartment(), wrap: new Compartment(), ro: new Compartment() } };
  }

  // ── window ───────────────────────────────────────────────
  async start(left, right) {
    const d = h('dialog.compare', { 'aria-label': 'Compare' });
    this.dialog = d;
    this.heads = { a: h('div.cmp-side'), b: h('div.cmp-side') };
    this.host = h('div.cmp-merge');
    this.map = h('div.cmp-map', { title: 'Differences: click to go there' });
    this.status = h('div.cmp-status');
    this.toolbar = h('div.cmp-bar');
    d.append(
      this.toolbar,
      h('div.cmp-heads', {}, this.heads.a, h('button.ghost.icon.cmp-swap', { type: 'button', title: 'Swap sides', 'aria-label': 'Swap sides', onclick: () => this.swap() }, '⇄'), this.heads.b),
      h('div.cmp-body', {}, this.host, this.map),
      this.status,
    );
    d.addEventListener('keydown', (e) => this.onKey(e));
    d.addEventListener('cancel', (e) => { e.preventDefault(); this.close(); });
    document.body.append(d);
    this.release = holdDialog();
    d.showModal();
    this.drawBar();
    await Promise.all([this.load('a', left), this.load('b', right)]);
    this.build();
    this.view('a')?.focus();
  }

  async close() {
    const dirty = SIDES.filter((s) => this.dirty(s));
    if (dirty.length) {
      const names = dirty.map((s) => this.sides[s].label).join(' and ');
      const v = await confirm('Unsaved changes', `${names} ${dirty.length > 1 ? 'have' : 'has'} changes made here. Save them?`, { ok: 'Save', cancel: 'Cancel', third: 'Discard' });
      if (v === false) return false;
      if (v === true) for (const s of dirty) if (!(await this.save(s))) return false;
    }
    this.saveOptions();
    this.mv?.destroy();
    this.dialog.close();
    this.dialog.remove();
    this.release?.();
    if (current === this) current = null;
    return true;
  }

  saveOptions() {
    const { rules, filter, context, wrap } = this.opt;
    const next = { rules, filter, context, wrap };
    if (JSON.stringify(next) !== JSON.stringify(this.app.settings.get('compareOptions'))) this.app.settings.set({ compareOptions: next });
  }

  // ── sides ────────────────────────────────────────────────
  async load(s, spec) {
    const app = this.app;
    const side = empty();
    if (!spec) { this.sides[s] = side; return; }
    try {
      if (spec.tab) {
        const d = spec.tab;
        Object.assign(side, { tab: d, path: d.path || null, label: app.displayName(d) + (app.dirty(d) ? ' (unsaved)' : ''), text: app.textOf ? app.textOf(d) : d.state.doc.toString(), encoding: d.encoding || 'UTF-8', eol: d.eol || 'LF', readOnly: !!d.readOnly, mtime: d.mtime });
      } else if (spec.path || spec.saved) {
        const path = spec.path || spec.saved.path;
        const r = await this.be.read(path);
        if (looksBinary(r.bytes)) throw new Error(`${basename(path)} is not a text file`);
        const t = decode(r.bytes, spec.saved?.encoding || null);
        Object.assign(side, { path, label: basename(path) + (spec.saved ? ' (on disk)' : ''), text: t.text.replace(/\r\n?/g, '\n'), encoding: t.encoding, eol: t.eol || 'LF', mtime: r.mtime, readOnly: !!spec.saved });
      } else {
        Object.assign(side, { label: spec.label || 'Text', text: String(spec.text ?? '').replace(/\r\n?/g, '\n'), encoding: 'UTF-8', eol: 'LF' });
      }
    } catch (e) {
      toast(e.message, { error: true, ms: 5000 });
    }
    side.lang = detect(side.path || side.label, side.text.slice(0, side.text.indexOf('\n') >>> 0));
    this.sides[s] = side;
  }

  view(s) { return this.mv ? this.mv[s] : null; }
  other(s) { return s === 'a' ? 'b' : 'a'; }
  text(s) { return this.view(s)?.state.doc.toString() ?? this.sides[s].text; }
  dirty(s) { const v = this.view(s); return !!v && !!this.sides[s].saved && !v.state.doc.eq(this.sides[s].saved); }

  // The merge view. Rebuilt when rules or the filter change; sides not in
  // `fresh` keep their text, cursor and undo history (`keep` can hand in
  // snapshots, e.g. swapped). The scroll position stays.
  build(fresh = SIDES, keep = null) {
    const snap = (v) => ({ doc: v.state.doc, selection: v.state.selection, history: v.state.field(historyField, false) });
    keep = keep || (this.mv ? Object.fromEntries(SIDES.filter((s) => !fresh.includes(s)).map((s) => [s, snap(this.mv[s])])) : {});
    const scroll = this.mv?.dom.scrollTop || 0;
    this.mv?.destroy();
    const cfg = (s) => ({
      doc: keep[s] ? keep[s].doc : this.sides[s].text,
      selection: keep[s] ? keep[s].selection : undefined,
      extensions: [keep[s]?.history ? historyField.init(() => keep[s].history) : [], this.extensions(s)],
    });
    this.mv = new MergeView({
      a: cfg('a'),
      b: cfg('b'),
      parent: this.host,
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: this.opt.filter === 'diffs' ? { margin: this.opt.context, minSize: 4 } : undefined,
      diffConfig: diffConfig(this.opt.rules),
    });
    for (const s of SIDES) {
      if (!keep[s]) this.sides[s].saved = this.mv[s].state.doc;
      this.loadLanguage(s);
    }
    this.mv.dom.scrollTop = scroll;
    this.mv.dom.addEventListener('scroll', () => this.drawViewport(), { passive: true });
    this.refresh();
  }

  extensions(s) {
    const set = this.app.settings.values;
    const c = this.c[s];
    return [
      lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), drawSelection(), highlightActiveLine(), bracketMatching(),
      highlightSelectionMatches(), search({ top: true }),
      keymap.of([...searchKeymap, ...historyKeymap, indentWithTab, ...standardKeymap]),
      EditorState.tabSize.of(set.tabSize), indentUnit.of(set.indentWithTabs ? '\t' : ' '.repeat(set.tabSize)),
      c.lang.of([]),
      c.wrap.of(this.opt.wrap ? EditorView.lineWrapping : []),
      c.ro.of(this.readOnlyExt(s)),
      editorTheme,
      EditorView.updateListener.of((u) => {
        if (u.focusChanged && u.view.hasFocus) { this.focus = s; this.drawHeads(); }
        if (u.docChanged) { this.drawHeads(); this.later(); } else if (u.selectionSet) this.drawStatus();
      }),
    ];
  }

  readOnlyExt(s) {
    const ro = !!this.sides[s].readOnly;
    return [EditorState.readOnly.of(ro), EditorView.editable.of(!ro)];
  }

  async loadLanguage(s) {
    const desc = this.sides[s].lang;
    if (!desc) return;
    try {
      const support = desc.support || (await desc.load());
      this.view(s)?.dispatch({ effects: this.c[s].lang.reconfigure(support) });
    } catch { /* plain text then */ }
  }

  later() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 250);
  }

  refresh() {
    this.drawHeads();
    this.drawMap();
    this.drawStatus();
  }

  // ── differences ──────────────────────────────────────────
  chunks() { return this.mv?.chunks || []; }
  pos(c, s, end = false) { return s === 'a' ? (end ? c.endA : c.fromA) : (end ? c.endB : c.fromB); }

  // The difference at (or else after) the cursor of the side last used.
  currentIndex() {
    const s = this.focus, v = this.view(s);
    if (!v) return -1;
    const head = v.state.selection.main.head;
    return this.chunks().findIndex((c) => head >= this.pos(c, s) && head <= this.pos(c, s, true));
  }

  // Next / previous difference from the cursor; past the last one it starts
  // again at the first (and says so).
  go(dir) {
    const chunks = this.chunks();
    if (!this.mv || !chunks.length) { toast('No differences'); return; }
    const s = this.focus, head = this.view(s).state.selection.main.head;
    const cur = this.currentIndex();
    let i;
    if (dir > 0) i = cur >= 0 ? cur + 1 : chunks.findIndex((c) => this.pos(c, s) > head);
    else if (cur >= 0) i = cur - 1;
    else { i = -1; chunks.forEach((c, k) => { if (this.pos(c, s, true) < head) i = k; }); }
    if (i < 0 || i >= chunks.length) {
      i = dir > 0 ? 0 : chunks.length - 1;
      if (chunks.length > 1 || cur < 0) toast(dir > 0 ? 'Back to the first difference' : 'Back to the last difference');
    }
    this.goTo(i);
  }

  goTo(i) {
    const c = this.chunks()[i];
    if (!c) return;
    const v = this.view(this.focus);
    const at = this.pos(c, this.focus);
    v.dispatch({ selection: { anchor: at }, scrollIntoView: true });
    this.centre(v);
    v.focus();
    this.drawStatus();
  }

  centre(v) {
    const head = v.state.selection.main.head;
    v.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) });
  }

  // Copies the difference at the cursor across (dir 'a-to-b' = to the right).
  copy(dir) {
    const to = dir === 'a-to-b' ? 'b' : 'a';
    if (this.sides[to].readOnly) { toast(`${this.sides[to].label} is read-only`); return; }
    const chunks = this.chunks();
    if (!chunks.length) { toast('No differences'); return; }
    let i = this.currentIndex();
    if (i < 0) {
      const head = this.view(this.focus).state.selection.main.head;
      i = chunks.findIndex((c) => this.pos(c, this.focus) >= head);
      if (i < 0) { toast('Put the cursor on a difference first'); return; }
    }
    const ch = copyChunkChange(chunks[i], this.mv.a.state.doc, this.mv.b.state.doc, dir);
    this.view(to).dispatch({ changes: ch, userEvent: 'input.copy' });
    this.drawStatus();
  }

  copyAll(dir) {
    const [from, to] = dir === 'a-to-b' ? ['a', 'b'] : ['b', 'a'];
    if (this.sides[to].readOnly) { toast(`${this.sides[to].label} is read-only`); return; }
    const v = this.view(to);
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: this.view(from).state.doc }, userEvent: 'input.copy' });
  }

  // ── saving and loading ───────────────────────────────────
  async save(s) {
    const side = this.sides[s], v = this.view(s);
    if (!v || side.readOnly) return true;
    if (!this.dirty(s)) { toast(`${side.label} has no changes to save`); return true; }
    const app = this.app;
    const text = v.state.doc.toString();
    try {
      if (side.tab && app.docs.includes(side.tab)) {
        const d = side.tab;
        const tr = { changes: { from: 0, to: d.state.doc.length, insert: text } };
        if (app.active === d) { app.view.dispatch(tr); d.state = app.view.state; } else d.state = d.state.update(tr).state;
        app.emit('docs');
        if (!(await app.save(d))) return false;
        side.mtime = d.mtime;
        side.path = d.path;
      } else {
        let path = side.path;
        if (!path) path = await this.askPath(side);
        if (!path) return false;
        const open = app.findDoc(path);
        if (open && app.dirty(open) && !(await confirm('Open with unsaved edits', `${basename(path)} is open in a tab with unsaved edits. Saving here replaces the file; the tab keeps its edits.`, { ok: 'Save anyway', danger: true }))) return false;
        const bytes = encode(text, side.encoding, side.eol);
        let r;
        try {
          r = await this.be.write(path, bytes, side.path === path ? side.mtime : null);
        } catch (e) {
          if (e.code !== 'CONFLICT') throw e;
          if (!(await confirm('Changed on disk', `${basename(path)} was changed by another program since it was loaded here.`, { ok: 'Overwrite', danger: true }))) return false;
          r = await this.be.write(path, bytes, null);
        }
        app.store?.addVersion?.(path, bytes).catch(() => {});
        Object.assign(side, { path, mtime: r.mtime, label: basename(path) });
        if (open && !app.dirty(open)) await app.reload(open, { force: true });
      }
      side.saved = v.state.doc;
      toast(`Saved ${side.label}`);
      this.drawHeads();
      return true;
    } catch (e) {
      toast(`Not saved: ${e.message}`, { error: true, ms: 6000 });
      return false;
    }
  }

  async askPath(side) {
    const be = this.be;
    const name = (side.label || 'compare').replace(/[^\w.-]+/g, '-') + '.txt';
    if (be.pickSavePath && be.canOpenAnywhere) return be.pickSavePath(join(be.notesRoot ?? be.home ?? '', name));
    if (be.notesRoot == null) return null;
    const rel = await prompt('Save as', { label: `Path inside ${be.notesName}`, value: name, ok: 'Save', selectStem: true });
    const clean = rel?.trim().replace(/^\/+/, '');
    if (!clean || !clean.split('/').every(validName)) return null;
    return join(be.notesRoot, clean);
  }

  async reloadSide(s) {
    const side = this.sides[s];
    if (!side.path && !side.tab) return;
    if (this.dirty(s) && !(await confirm('Reload?', `Your changes to ${side.label} made here will be lost.`, { ok: 'Reload', danger: true }))) return;
    await this.replaceSide(s, side.tab ? { tab: side.tab } : side.readOnly ? { saved: { path: side.path } } : { path: side.path });
  }

  // Loads something else into one side (the other keeps its edits and history).
  async replaceSide(s, spec) {
    if (this.dirty(s) && !(await confirm('Replace this side?', `Your changes to ${this.sides[s].label} made here will be lost.`, { ok: 'Replace', danger: true }))) return;
    await this.load(s, spec);
    this.build([s]);
  }

  swap() {
    if (!this.mv) return;
    const snap = (v) => ({ doc: v.state.doc, selection: v.state.selection, history: v.state.field(historyField, false) });
    const keep = { a: snap(this.mv.b), b: snap(this.mv.a) };
    [this.sides.a, this.sides.b] = [this.sides.b, this.sides.a];
    this.build([], keep);
  }

  // What can go into a side: a file, an open tab, the clipboard.
  sideMenu(s, x, y) {
    const app = this.app, be = this.be;
    const tabs = app.docs.filter((d) => d.kind === 'text');
    const items = [];
    if (be.pickFiles && be.canOpenAnywhere) items.push({ label: 'Open file…', run: async () => { const [p] = await be.pickFiles(); if (p) this.replaceSide(s, { path: p }); } });
    if (be.notesRoot != null) items.push({ label: `File in ${be.notesName}…`, run: () => this.pickNote(s) });
    if (tabs.length) {
      items.push('-');
      for (const d of tabs.slice(0, 15)) items.push({ label: `Tab: ${app.displayName(d)}${app.dirty(d) ? ' •' : ''}`, run: () => this.replaceSide(s, { tab: d }) });
    }
    items.push('-', { label: 'Paste from clipboard', run: async () => {
      let t = '';
      try { t = await navigator.clipboard.readText(); } catch { toast('The clipboard cannot be read here', { error: true }); return; }
      this.replaceSide(s, { text: t, label: 'Clipboard' });
    } });
    items.push({ label: 'Empty', run: () => this.replaceSide(s, { text: '', label: 'Empty' }) });
    if (this.sides[s].path || this.sides[s].tab) items.push('-', { label: 'Reload', run: () => this.reloadSide(s) });
    if (this.sides[s].path) items.push({ label: 'Open in a tab', run: async () => { if (await this.close()) app.open(this.sides[s].path); } });
    contextMenu(x, y, items);
  }

  // Opens a side's ▾ menu under its header (after "Compare with…").
  askSide(s) {
    const b = this.heads[s].querySelector('.cmp-pick')?.getBoundingClientRect();
    if (b) this.sideMenu(s, b.left, b.bottom + 4);
  }

  async pickNote(s) {
    const app = this.app;
    const files = await app.index.files();
    const path = await pick({ title: `${NAME[s]} side`, placeholder: 'Type part of a name or folder', items: files.map((f) => ({ label: f.name, detail: dirname(f.rel), value: f.path })), empty: 'No file matches' });
    if (path) this.replaceSide(s, { path });
  }

  // ── export ───────────────────────────────────────────────
  patch() {
    const label = (s) => {
      const side = this.sides[s];
      if (!side.path) return side.label;
      return this.be.notesRoot != null && isInside(side.path, this.be.notesRoot) ? relative(side.path, this.be.notesRoot) : side.path;
    };
    return unifiedDiff(this.text('a'), this.text('b'), { from: label('a'), to: label('b'), context: 3, rules: this.opt.rules });
  }

  async copyPatch() {
    const p = this.patch();
    if (!p) { toast('No differences'); return; }
    try { await navigator.clipboard.writeText(p); toast('Patch copied'); } catch { toast('The clipboard cannot be written here', { error: true }); }
  }

  async savePatch() {
    const p = this.patch();
    if (!p) { toast('No differences'); return; }
    const a = this.sides.a, b = this.sides.b;
    const name = `${(a.label || 'left').replace(/[^\w.-]+/g, '-')}_vs_${(b.label || 'right').replace(/[^\w.-]+/g, '-')}.diff`;
    const path = await this.askPath({ label: name.replace(/\.diff$/, '') }).then((x) => (x ? x.replace(/\.txt$/, '.diff') : x));
    if (!path) return;
    try { await this.be.write(path, new TextEncoder().encode(p), null); toast(`Saved ${basename(path)}`); } catch (e) { toast(`Not saved: ${e.message}`, { error: true }); }
  }

  // ── options ──────────────────────────────────────────────
  setRules(patch) {
    this.opt.rules = { ...this.opt.rules, ...patch };
    this.build([]);
    this.drawBar();
  }

  setFilter(filter, context = this.opt.context) {
    this.opt.filter = filter;
    this.opt.context = context;
    this.build([]);
    this.drawBar();
  }

  setWrap(on) {
    this.opt.wrap = on;
    for (const s of SIDES) this.view(s)?.dispatch({ effects: this.c[s].wrap.reconfigure(on ? EditorView.lineWrapping : []) });
    this.drawBar();
  }

  rulesMenu(x, y) {
    const r = this.opt.rules;
    contextMenu(x, y, [
      { label: `${r.case ? '✓ ' : ''}Ignore case`, run: () => this.setRules({ case: !r.case }) },
      { label: `${r.blank ? '✓ ' : ''}Ignore blank lines`, run: () => this.setRules({ blank: !r.blank }) },
      '-',
      ...WS_RULES.map(([v, l]) => ({ label: `${r.ws === v ? '● ' : ''}${l}`, run: () => this.setRules({ ws: v }) })),
      '-',
      { label: 'Compare everything', run: () => this.setRules({ ...DEFAULT_RULES }) },
    ]);
  }

  viewMenu(x, y) {
    const o = this.opt;
    contextMenu(x, y, [
      { label: `${o.filter === 'all' ? '● ' : ''}Show all lines`, run: () => this.setFilter('all') },
      ...[0, 1, 3, 5, 10].map((n) => ({ label: `${o.filter === 'diffs' && o.context === n ? '● ' : ''}Differences only, ${n} line${n === 1 ? '' : 's'} around`, run: () => this.setFilter('diffs', n) })),
      '-',
      { label: `${o.wrap ? '✓ ' : ''}Word wrap`, run: () => this.setWrap(!o.wrap) },
    ]);
  }

  moreMenu(x, y) {
    contextMenu(x, y, [
      { label: 'Copy all to right', run: () => this.copyAll('a-to-b') },
      { label: 'Copy all to left', run: () => this.copyAll('b-to-a') },
      '-',
      { label: 'Copy as patch (unified diff)', run: () => this.copyPatch() },
      { label: 'Save as patch…', run: () => this.savePatch() },
      '-',
      { label: 'Recompare', keys: 'F5', run: () => this.build([]) },
      { label: 'Swap sides', run: () => this.swap() },
    ]);
  }

  // ── drawing ──────────────────────────────────────────────
  drawBar() {
    const btn = (label, title, run, iconName) => h('button.ghost', { type: 'button', title, onclick: (e) => run(e) }, iconName ? icon(iconName) : null, label);
    const at = (fn) => (e) => { const r = e.currentTarget.getBoundingClientRect(); fn(r.left, r.bottom + 4); };
    const r = this.opt.rules;
    this.toolbar.replaceChildren(
      h('strong.cmp-title', {}, 'Compare'),
      btn('◀ Prev', 'Previous difference (Alt+Up, Shift+F8)', () => this.go(-1)),
      btn('Next ▶', 'Next difference (Alt+Down, F8)', () => this.go(1)),
      h('span.cmp-sep'),
      btn('Copy →', 'Copy this difference to the right (Alt+Right)', () => this.copy('a-to-b')),
      btn('← Copy', 'Copy this difference to the left (Alt+Left)', () => this.copy('b-to-a')),
      h('span.cmp-sep'),
      btn(rulesActive(r) ? 'Rules •' : 'Rules', 'What counts as a difference', at((x, y) => this.rulesMenu(x, y))),
      btn(this.opt.filter === 'diffs' ? 'Differences only' : 'All lines', 'Show all lines or only the differences', at((x, y) => this.viewMenu(x, y))),
      btn('More', 'Copy all, patch, swap', at((x, y) => this.moreMenu(x, y))),
      h('span.grow'),
      btn('Close', 'Close (Esc)', () => this.close()),
    );
  }

  drawHeads() {
    for (const s of SIDES) {
      const side = this.sides[s];
      const dirty = this.dirty(s);
      const where = side.path ? pretty(dirname(side.path), this.be.home) : side.tab ? 'open tab' : '';
      const lines = this.view(s)?.state.doc.lines ?? 0;
      this.heads[s].classList.toggle('focus', this.focus === s);
      this.heads[s].replaceChildren(...[
        h('button.ghost.cmp-pick', { type: 'button', title: 'Choose what this side shows', onclick: (e) => { const b = e.currentTarget.getBoundingClientRect(); this.sideMenu(s, b.left, b.bottom + 4); } },
          h('span.cmp-name', {}, (dirty ? '● ' : '') + (side.label || 'Choose…')), icon('chevronDown')),
        h('span.muted.cmp-where', { title: side.path || '' }, where),
        h('span.grow'),
        h('span.muted.cmp-meta', {}, [side.readOnly ? 'read-only' : null, side.encoding, side.eol, `${lines} line${lines === 1 ? '' : 's'}`].filter(Boolean).join(' · ')),
        side.readOnly ? null : h('button.ghost', { type: 'button', disabled: !dirty, title: `Save ${NAME[s].toLowerCase()} (Ctrl+S when the cursor is here)`, onclick: () => this.save(s) }, icon('save'), 'Save'),
      ].filter(Boolean));
    }
  }

  drawStatus() {
    const n = this.chunks().length;
    const a = this.text('a'), b = this.text('b');
    let msg;
    if (!n) {
      if (a === b) msg = this.sides.a.eol !== this.sides.b.eol ? `Same text; line endings differ (${this.sides.a.eol} and ${this.sides.b.eol})` : 'The two sides are identical';
      else msg = 'No differences under the current rules';
    } else {
      const i = this.currentIndex();
      const st = summary(a, b, this.opt.rules);
      const parts = [st.changed && `${st.changed} changed`, st.added && `${st.added} only right`, st.removed && `${st.removed} only left`].filter(Boolean).join(', ');
      msg = `${i >= 0 ? `Difference ${i + 1} of ${n}` : `${n} difference${n === 1 ? '' : 's'}`} · ${parts} line${st.changed + st.added + st.removed === 1 ? '' : 's'}`;
    }
    const enc = this.sides.a.encoding !== this.sides.b.encoding && this.sides.a.text && this.sides.b.text ? ` · encodings differ (${this.sides.a.encoding}, ${this.sides.b.encoding})` : '';
    const rules = rulesActive(this.opt.rules) ? ' · rules on' : '';
    this.status.replaceChildren(h('span', {}, msg + enc + rules), h('span.grow'), h('span.muted', {}, 'Alt+↑↓ differences · Alt+←→ copy · Ctrl+S save · Esc close'));
  }

  // The bar on the right: one mark per difference, where it is in the file.
  drawMap() {
    const chunks = this.chunks();
    const v = this.view('a');
    if (!v) return;
    const total = Math.max(1, v.state.doc.lines, this.view('b').state.doc.lines);
    const lineOf = (c) => v.state.doc.lineAt(Math.min(c.fromA, v.state.doc.length)).number;
    this.map.replaceChildren(...chunks.map((c, i) => {
      const kind = c.fromA === c.toA ? 'add' : c.fromB === c.toB ? 'del' : 'chg';
      const top = ((lineOf(c) - 1) / total) * 100;
      const lines = Math.max(1, v.state.doc.lineAt(Math.min(c.endA, v.state.doc.length)).number - lineOf(c) + 1);
      return h('button.cmp-mark', { type: 'button', class: kind, title: `Difference ${i + 1}`, style: { top: top + '%', height: `max(3px, ${(lines / total) * 100}%)` }, onclick: () => this.goTo(i) });
    }), this.vp = h('div.cmp-vp'));
    this.drawViewport();
  }

  drawViewport() {
    if (!this.vp || !this.mv) return;
    const d = this.mv.dom;
    const h0 = d.scrollHeight || 1;
    this.vp.style.top = (d.scrollTop / h0) * 100 + '%';
    this.vp.style.height = (d.clientHeight / h0) * 100 + '%';
  }

  // ── keys ─────────────────────────────────────────────────
  onKey(e) {
    const k = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', e.key].filter(Boolean).join('+');
    const run = {
      'Alt+ArrowDown': () => this.go(1), F8: () => this.go(1),
      'Alt+ArrowUp': () => this.go(-1), 'Shift+F8': () => this.go(-1),
      'Alt+ArrowRight': () => this.copy('a-to-b'), 'Alt+ArrowLeft': () => this.copy('b-to-a'),
      'Ctrl+s': () => this.save(this.focus), 'Ctrl+S': () => this.save(this.focus),
      'Ctrl+Shift+s': () => SIDES.reduce((p, s) => p.then(() => this.save(s)), Promise.resolve()),
      'Ctrl+Shift+S': () => SIDES.reduce((p, s) => p.then(() => this.save(s)), Promise.resolve()),
      F5: () => this.build([]),
      'Ctrl+w': () => this.close(), 'Ctrl+W': () => this.close(),
    }[k];
    if (run) { e.preventDefault(); run(); }
    // nothing in here reaches the app's own shortcuts (Ctrl+W closing a tab behind)
    e.stopPropagation();
  }
}

function empty() {
  return { path: null, tab: null, label: '', text: '', encoding: 'UTF-8', eol: 'LF', mtime: null, readOnly: false, saved: null, lang: null };
}

export const compareOpen = () => !!current;

// Compare → Compare files…: two files from the file dialog (desktop), or an
// empty window whose sides are chosen from their ▾ menus.
export async function compareFiles(app) {
  const be = app.backend;
  let paths = [];
  if (be.pickFiles && be.canOpenAnywhere) paths = await be.pickFiles();
  await openCompare(app, { left: paths[0] ? { path: paths[0] } : null, right: paths[1] ? { path: paths[1] } : null });
  if (paths.length === 1) current?.askSide('b');
  if (paths.length > 2) toast('Comparing the first two files');
}

// This tab against something else, chosen from the right side's menu.
export async function compareWith(app, d = app.active) {
  if (d?.kind !== 'text') return;
  await openCompare(app, { left: { tab: d } });
  current?.askSide('b');
}

export async function compareWithClipboard(app, d = app.active) {
  if (d?.kind !== 'text') return;
  let text;
  try { text = await navigator.clipboard.readText(); } catch { toast('The clipboard cannot be read here', { error: true }); return; }
  await openCompare(app, { left: { tab: d }, right: { text, label: 'Clipboard' } });
}

// The file as saved on disk (left, read-only) against the tab's edits (right).
export async function compareWithSaved(app, d = app.active) {
  if (d?.kind !== 'text' || !d.path) return;
  await openCompare(app, { left: { saved: d }, right: { tab: d } });
}
