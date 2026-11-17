// Find in files (Ctrl+Shift+F): searches every folder in the sidebar and lists
// matches grouped by file; clicking one opens the file at that line.
// "Replace all" changes every match in the files found: open files are edited
// in their tabs (undo works there), the others are rewritten on disk.
import { relative } from '../core/paths.js';
import { h, icon } from './dom.js';
import { confirm, toast } from './dialogs.js';

export class SearchPanel {
  constructor(app) {
    this.app = app;
    this.input = h('input', { type: 'search', placeholder: 'Find in files', spellcheck: 'false', autocapitalize: 'off', enterkeyhint: 'search' });
    this.regex = h('input', { type: 'checkbox' });
    this.cs = h('input', { type: 'checkbox' });
    this.replaceInput = h('input', { type: 'text', placeholder: 'Replace with', spellcheck: 'false', autocapitalize: 'off' });
    this.replaceBtn = h('button', { type: 'button', disabled: true, title: 'Replace every match in the files found', onclick: () => this.replaceAll() }, 'Replace all');
    this.replaceRow = h('div.sr-replace', { hidden: !!app.backend.readOnly }, this.replaceInput, this.replaceBtn);
    this.hits = [];
    this.info = h('div.sr-info.muted');
    this.results = h('div.sr-list');
    this.el = h('div.search-panel', {},
      h('form.sr-form', { onsubmit: (e) => { e.preventDefault(); this.run(); } },
        this.input,
        h('div.sr-opts', {}, h('label', {}, this.cs, 'Match case'), h('label', {}, this.regex, 'Regex')),
        this.replaceRow),
      this.info, this.results);
    this.seq = 0;
  }

  focus(text) {
    if (text) this.input.value = text;
    this.input.focus();
    this.input.select();
  }

  // Runs a search from a command (backlinks, tags).
  query(q, { regex = false, caseSensitive = false } = {}) {
    this.input.value = q;
    this.regex.checked = regex;
    this.cs.checked = caseSensitive;
    return this.run();
  }

  // The pattern as JavaScript sees it (the search itself runs in the backend).
  pattern() {
    const src = this.regex.checked ? this.input.value : this.input.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(src, this.cs.checked ? 'gm' : 'gim');
  }

  async replaceAll() {
    const app = this.app;
    const paths = [...new Set(this.hits.map((m) => m.path))];
    if (!paths.length || app.backend.readOnly) return;
    const q = this.input.value;
    const to = this.replaceInput.value;
    let re;
    try { re = this.pattern(); } catch (e) { toast('Invalid regex: ' + e.message, { error: true }); return; }
    // in regex mode "$1" means a group; otherwise the text is taken as it is
    const repl = this.regex.checked ? to : () => to;
    if (!(await confirm('Replace in files?', `Replace every "${q}" with "${to}" in ${paths.length} file${paths.length > 1 ? 's' : ''}? Files that are open change in their tabs (Ctrl+Z undoes it there); the others are rewritten on disk.`, { ok: 'Replace all', danger: true }))) return;
    this.replaceBtn.disabled = true;
    let files = 0, count = 0, failed = 0;
    for (const path of paths) {
      try {
        const n = await app.replaceInFile(path, re, repl);
        if (n) { files++; count += n; }
      } catch (e) { failed++; console.warn('replace failed', path, e); }
    }
    toast(`Replaced ${count} match${count === 1 ? '' : 'es'} in ${files} file${files === 1 ? '' : 's'}` + (failed ? ` · ${failed} could not be changed` : ''), { error: failed > 0, ms: 5000 });
    await this.run();
  }

  async run() {
    const q = this.input.value;
    if (!q) return;
    if (this.regex.checked) { try { new RegExp(q); } catch (e) { this.info.textContent = 'Invalid regex: ' + e.message; return; } }
    const seq = ++this.seq;
    this.info.textContent = 'Searching…';
    this.results.replaceChildren();
    this.hits = [];
    this.replaceBtn.disabled = true;
    const roots = this.app.roots.map((r) => r.path);
    let hits;
    try {
      hits = await this.app.backend.search(roots, q, { regex: this.regex.checked, caseSensitive: this.cs.checked, hidden: this.app.settings.get('hidden'), max: 2000 });
    } catch (e) {
      if (seq === this.seq) this.info.textContent = e.message;
      return;
    }
    if (seq !== this.seq) return;
    this.hits = hits;
    this.replaceBtn.disabled = !hits.length;
    const byFile = new Map();
    for (const m of hits) { if (!byFile.has(m.path)) byFile.set(m.path, []); byFile.get(m.path).push(m); }
    this.info.textContent = hits.length ? `${hits.length}${hits.length >= 2000 ? '+' : ''} matches in ${byFile.size} files` : 'No matches';
    const rootOf = (p) => this.app.roots.find((r) => relative(p, r.path) != null);
    const frag = document.createDocumentFragment();
    for (const [path, list] of byFile) {
      const r = rootOf(path);
      const rel = r ? `${r.name}/${relative(path, r.path)}` : path;
      const group = h('details.sr-file', { open: true }, h('summary', { title: path }, icon('fileText'), h('span.ellipsis', {}, rel), h('span.badge', {}, list.length)));
      for (const m of list) {
        group.append(h('button.sr-hit', { onclick: () => { this.app.open(path, { line: m.line, col: m.col }); if (this.app.mobile) this.app.emit('drawer', false); } },
          h('span.sr-ln', {}, m.line), h('span.sr-text', {}, m.text.trim())));
      }
      frag.append(group);
    }
    this.results.replaceChildren(frag);
  }
}
