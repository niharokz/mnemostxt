// Links between notes: [[note]], [[note|shown text]], [[note#heading]], and
// #tags. Pure helpers shared by the preview, the editor and the commands.
import { basename, dirname, extname, stem } from './paths.js';

const WIKI = /\[\[([^\[\]\n|#]*)(?:#([^\[\]\n|]*))?(?:\|([^\[\]\n]*))?\]\]/g;

// [{ target, heading, label, from, to }] for every [[link]] in text.
export function wikiLinks(text) {
  const out = [];
  for (const m of text.matchAll(WIKI)) {
    const target = m[1].trim();
    const heading = (m[2] || '').trim();
    if (!target && !heading) continue;
    out.push({ target, heading, label: (m[3] || '').trim() || target || heading, from: m.index, to: m.index + m[0].length });
  }
  return out;
}

// The [[link]] the cursor (offset in line) is inside, or null.
export function wikiLinkAt(line, offset) {
  return wikiLinks(line).find((l) => offset >= l.from && offset <= l.to) || null;
}

// What the user is typing after "[[" (for completion), or null.
export function wikiPrefix(before) {
  const m = /\[\[([^\[\]\n|#]*)$/.exec(before);
  return m ? { from: before.length - m[1].length, text: m[1] } : null;
}

// Picks the file a link means. files: [{ path, rel }] (rel inside the notes
// folder). A name with a folder matches the end of rel; a bare name matches
// the file stem, preferring a note next to `from`, then the shortest path.
export function resolveWiki(target, files, from = '') {
  const want = target.trim().replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  if (!want) return null;
  const hasExt = extname(want) !== '';
  const key = (f) => (hasExt ? f.rel : f.rel.replace(/\.[^./]+$/, '')).toLowerCase();
  let hits = files.filter((f) => { const k = key(f); return k === want || k.endsWith('/' + want); });
  if (!hits.length && !want.includes('/')) hits = files.filter((f) => stem(basename(f.rel)).toLowerCase() === want);
  if (!hits.length) return null;
  const md = (f) => (/\.(md|markdown|mkd|mdown)$/i.test(f.rel) ? 0 : 1);
  const near = (f) => (from && dirname(f.path) === dirname(from) ? 0 : 1);
  return [...hits].sort((a, b) => near(a) - near(b) || md(a) - md(b) || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel))[0];
}

// A regex (as text) that finds links to a note, for Find in files.
export function backlinkPattern(path) {
  const name = stem(basename(path));
  return `\\[\\[([^\\]|#]*/)?${escapeRe(name)}(\\.md)?\\s*([|#][^\\]]*)?\\]\\]`;
}

// No lookahead: the Go and Rust search engines (RE2-style) do not support it.
export const tagPattern = (tag) => `(^|[\\s(,;])#${escapeRe(tag.replace(/^#/, ''))}([^\\w/-]|$)`;

// The #tag at offset in line ("#" then letters, digits, _ - /; not a heading).
export function tagAt(line, offset) {
  for (const m of line.matchAll(/(^|[\s(,;])#([A-Za-z_][\w/-]*)/g)) {
    const from = m.index + m[1].length;
    if (offset >= from && offset <= from + 1 + m[2].length) return m[2];
  }
  return null;
}

export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Markdown headings: [{ level, text, line }] (line numbers from 1); code blocks are skipped.
export function headings(text) {
  const out = [];
  let fence = null;
  text.split('\n').forEach((l, i) => {
    const f = /^\s{0,3}(```+|~~~+)/.exec(l);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return; }
    if (fence) return;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (m && m[2]) out.push({ level: m[1].length, text: m[2], line: i + 1 });
  });
  return out;
}

// Fuzzy match for the file switcher: every letter of q in order. Returns a
// score (higher is better) or -1. Runs of letters, word starts and matches in
// the file name count for more than scattered letters in the folders.
export function fuzzyScore(q, s) {
  const a = q.toLowerCase(), b = s.toLowerCase();
  if (!a) return 0;
  const nameAt = b.lastIndexOf('/') + 1;
  let score = 0, j = 0, run = 0;
  for (let i = 0; i < a.length; i++) {
    const c = a[i];
    if (c === ' ') continue;
    const k = b.indexOf(c, j);
    if (k < 0) return -1;
    run = k === j && i > 0 ? run + 1 : 0;
    score += 1 + run * 2 + (k >= nameAt ? 2 : 0) + (k === nameAt || /[\/_\-. ]/.test(b[k - 1] || '/') ? 3 : 0);
    j = k + 1;
  }
  return score - b.length / 200;
}

// Words in a note (for the status bar): front matter and code fences count too; it is a rough figure.
export const countWords = (text) => (text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []).length;

// "2026-11-17" for a daily note (local time).
export function isoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
