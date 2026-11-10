// The clean View of a markdown or CSV/TSV file (the View button, Ctrl+Shift+V):
// it takes the editor's place until you press Edit.
//  - Markdown: rendered like the preview, in a readable column.
//  - CSV / TSV: a table with a sticky header row, row numbers, numbers aligned
//    right, click a column to sort (again to reverse, a third time to undo),
//    and a filter box. Very large files show the first rows; "Show more" adds more.
// It always shows the editor's current text, saved or not. Double-click to edit.
import { h, debounce } from './dom.js';
import { isMarkdown } from '../core/languages.js';
import { isTable, detectDelimiter, parse, asNumber } from '../core/csv.js';

const PAGE = 1000; // table rows added at a time

export const canView = (d) => d?.kind === 'text' && (isMarkdown(d.path || d.untitled || '') || isTable(d.path || d.untitled || ''));

export class Reader {
  constructor(app, preview) {
    this.app = app;
    this.preview = preview;
    this.info = h('span.rd-info.muted');
    this.filter = h('input.rd-filter', { type: 'search', placeholder: 'Filter rows', spellcheck: 'false', autocapitalize: 'off', oninput: debounce(() => this.drawTable(), 150) });
    this.bar = h('div.rd-bar', {}, this.info, h('span.grow'), this.filter); // Edit is in the top bar
    this.body = h('div.rd-body');
    this.el = h('section.reader', { hidden: true, 'aria-label': 'View' }, this.bar, this.body);
    this.body.addEventListener('click', (e) => { if (this.mode === 'md') this.preview.onClick(e, this.body); });
    this.body.addEventListener('dblclick', (e) => { if (!e.target.closest('th, a, input, button')) app.setView(app.active, false); });
    const refresh = debounce(() => { if (!this.el.hidden) this.render(app.active); }, 250);
    app.on('content', refresh);
  }

  render(d) {
    if (!canView(d)) return;
    const name = d.path || d.untitled || '';
    if (isMarkdown(name)) {
      this.mode = 'md';
      this.filter.hidden = true;
      const article = h('article.md.rd-md');
      this.body.replaceChildren(article);
      this.preview.fill(article, d);
      const words = (this.app.textOf(d).match(/\S+/g) || []).length;
      this.info.textContent = `${words.toLocaleString()} words · ${Math.max(1, Math.round(words / 230))} min read`;
      return;
    }
    this.mode = 'table';
    this.filter.hidden = false;
    const text = this.app.textOf(d);
    const delim = detectDelimiter(name, text);
    const rows = parse(text, delim);
    this.head = rows[0] || [];
    this.rows = rows.slice(1).map((cells, i) => ({ n: i + 1, cells }));
    this.cols = Math.max(this.head.length, ...this.rows.slice(0, 5000).map((r) => r.cells.length), 0);
    // a column is numeric when (nearly) all its filled cells are numbers
    this.numeric = Array.from({ length: this.cols }, (_, c) => {
      const vals = this.rows.slice(0, 500).map((r) => r.cells[c]).filter((v) => v != null && v.trim() !== '');
      return vals.length > 0 && vals.filter((v) => asNumber(v) != null).length >= vals.length * 0.9;
    });
    if (this.docId !== d.id) { this.sort = null; this.filter.value = ''; this.docId = d.id; }
    this.delimName = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }[delim];
    this.drawTable();
  }

  drawTable(limit = PAGE) {
    const q = this.filter.value.trim().toLowerCase();
    let rows = q ? this.rows.filter((r) => r.cells.some((c) => c.toLowerCase().includes(q))) : this.rows;
    if (this.sort) {
      const { col, dir } = this.sort;
      const num = this.numeric[col];
      const key = (r) => (num ? asNumber(r.cells[col] ?? '') ?? -Infinity : (r.cells[col] ?? '').toLowerCase());
      rows = [...rows].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || a.n - b.n; });
    }
    this.info.textContent = `${this.rows.length.toLocaleString()} rows · ${this.cols} columns · ${this.delimName}-separated` + (q ? ` · ${rows.length.toLocaleString()} match` : '');
    const arrow = (c) => (this.sort?.col === c ? (this.sort.dir > 0 ? ' ▲' : ' ▼') : '');
    const th = Array.from({ length: this.cols }, (_, c) => h('th', {
      class: this.numeric[c] ? 'num' : '', title: 'Sort', onclick: () => {
        // ascending → descending → as in the file
        this.sort = this.sort?.col !== c ? { col: c, dir: 1 } : this.sort.dir > 0 ? { col: c, dir: -1 } : null;
        this.drawTable();
      },
    }, (this.head[c] ?? '') + arrow(c)));
    const shown = rows.slice(0, limit);
    const tbody = h('tbody', {}, shown.map((r) => h('tr', {}, h('td.rn', {}, r.n),
      Array.from({ length: this.cols }, (_, c) => {
        const v = r.cells[c] ?? '';
        return h('td', { class: this.numeric[c] ? 'num' : '', title: v.length > 40 ? v : null }, v);
      }))));
    const table = h('table.rd-table', {}, h('thead', {}, h('tr', {}, h('th.rn', {}, '#'), th)), tbody);
    const more = rows.length > limit
      ? h('div.rd-more', {}, h('span.muted', {}, `Showing ${limit.toLocaleString()} of ${rows.length.toLocaleString()} rows `),
        h('button', { type: 'button', onclick: () => this.drawTable(limit + PAGE * 5) }, 'Show more'))
      : null;
    const empty = !rows.length ? h('p.muted.rd-empty', {}, q ? 'No row matches.' : 'No rows.') : null;
    this.body.replaceChildren(...[h('div.rd-scroll', {}, table), more, empty].filter(Boolean));
  }
}
