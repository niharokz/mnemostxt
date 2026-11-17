// Markdown preview: a side panel next to the editor (Ctrl+Shift+M). The clean
// View (ui/reader.js) renders through fill() too. Rendered with
// marked and sanitised with DOMPurify; images next to the note load through the
// backend, links to other notes open them ([[wiki links]] too), web links open
// in the browser. A note is untrusted text (it may come from another device or
// a shared file): scripts, styles, forms and frames never reach the page.
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { dirname, join, extname } from '../core/paths.js';
import { isMarkdown } from '../core/languages.js';
import { h, debounce } from './dom.js';

marked.setOptions({ gfm: true, breaks: false });

// [[note]], [[note|text]], [[note#heading]] → a link the click handler resolves
const WIKI = /^\[\[([^\[\]\n|#]*)(?:#([^\[\]\n|]*))?(?:\|([^\[\]\n]*))?\]\]/;
marked.use({
  extensions: [{
    name: 'wikilink',
    level: 'inline',
    start: (src) => { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = WIKI.exec(src);
      const target = m ? m[1].trim() : '';
      const heading = m ? (m[2] || '').trim() : '';
      if (!m || (!target && !heading)) return undefined;
      return { type: 'wikilink', raw: m[0], target, heading, label: (m[3] || '').trim() || target || heading };
    },
    renderer: (t) => `<a class="wikilink" href="#" data-wiki="${escapeHtml(t.target)}" data-heading="${escapeHtml(t.heading)}">${escapeHtml(t.label)}</a>`,
  }],
});

// What rendered markdown may contain. Task-list checkboxes are the only inputs.
const PURIFY = {
  ADD_ATTR: ['target'],
  FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'dialog', 'audio', 'video', 'source'],
  FORBID_ATTR: ['style', 'srcset', 'ping', 'formaction', 'action', 'autofocus', 'contenteditable', 'name', 'form'],
};
export const renderMarkdown = (text) => DOMPurify.sanitize(marked.parse(text), PURIFY);

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp' };

export class Preview {
  constructor(app, openExternal) {
    this.app = app;
    this.openExternal = openExternal;
    this.urls = new Map(); // path -> blob URL
    this.body = h('article.md');
    this.el = h('aside.preview', { 'aria-label': 'Markdown preview' }, this.body);
    this.update = debounce(() => this.render(), 180);
    app.on('content', () => this.app.ui.preview && this.update());
    app.on('active', () => this.app.ui.preview && this.render());
    app.on('preview', () => this.render());
    this.body.addEventListener('click', (e) => this.onClick(e, this.body));
  }

  get visible() {
    const d = this.app.active;
    return this.app.ui.preview && d?.kind === 'text' && !d.view && isMarkdown(d.path || d.untitled || '');
  }

  stripFrontMatter(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!m) return { meta: null, body: text };
    return { meta: m[1], body: text.slice(m[0].length) };
  }

  render() {
    this.el.hidden = !this.visible;
    document.body.classList.toggle('has-preview', !this.el.hidden);
    if (this.el.hidden) return;
    this.fill(this.body, this.app.active);
  }

  // Renders document d as markdown into target (front matter shown as a block).
  fill(target, d) {
    const { meta, body } = this.stripFrontMatter(this.app.textOf(d));
    target.innerHTML = (meta ? `<pre class="fm">${escapeHtml(meta)}</pre>` : '') + renderMarkdown(body);
    for (const input of target.querySelectorAll('input')) { if (input.type === 'checkbox') input.disabled = true; else input.remove(); }
    for (const a of target.querySelectorAll('a[href^="http"]')) a.rel = 'noopener noreferrer';
    this.loadImages(d, target);
  }

  async loadImages(d, target) {
    const base = d.path ? dirname(d.path) : this.app.backend.notesRoot;
    for (const img of target.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (/^(https?:|data:|blob:)/i.test(src) || base == null) continue;
      const path = src.startsWith('/') && this.app.backend.notesRoot != null ? join(this.app.backend.notesRoot, src) : join(base, decodeURIComponent(src));
      img.removeAttribute('src');
      try {
        if (!this.urls.has(path)) {
          const r = await this.app.backend.read(path);
          this.urls.set(path, URL.createObjectURL(new Blob([r.bytes], { type: MIME[extname(path)] || 'application/octet-stream' })));
        }
        img.src = this.urls.get(path);
      } catch {
        img.alt = `[missing image: ${src}]`;
        img.classList.add('missing');
      }
    }
  }

  onClick(e, root) {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    e.preventDefault();
    const reading = root !== this.body; // the clean View: linked notes open in it too
    if (a.dataset.wiki != null) { this.app.openWiki(a.dataset.wiki, a.dataset.heading || '', { view: reading }); return; }
    if (/^(https?:|mailto:)/i.test(href)) { this.openExternal(href); return; }
    if (href.startsWith('#')) { root.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView(); return; }
    const d = this.app.active;
    const target = decodeURIComponent(href.split('#')[0]);
    if (!target) return;
    const base = d?.path ? dirname(d.path) : this.app.backend.notesRoot;
    if (base == null) return;
    this.app.open(target.startsWith('/') ? join(this.app.backend.notesRoot, target) : join(base, target)).then((doc) => {
      if (reading && doc?.kind === 'text' && isMarkdown(doc.path || '')) this.app.setView(doc, true);
    });
  }
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
