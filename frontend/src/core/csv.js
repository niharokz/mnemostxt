// CSV / TSV for the clean View (ui/reader.js): RFC 4180 quoting ("a, b",
// "say ""hi""", line breaks inside quotes), CRLF or LF, and a guess at the
// delimiter: tab for .tsv/.tab, otherwise whichever of , ; | or tab splits the
// first lines most consistently.
import { extname } from './paths.js';

export const TABLE_EXTS = ['.csv', '.tsv', '.tab'];
export const isTable = (path) => TABLE_EXTS.includes(extname(path || '').toLowerCase());

export function detectDelimiter(path, text) {
  const ext = extname(path || '').toLowerCase();
  if (ext === '.tsv' || ext === '.tab') return '\t';
  const lines = text.split(/\r?\n/, 6).filter((l) => l.trim());
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => parse(l, d)[0]?.length ?? 1);
    if (!counts.length || counts[0] < 2) continue;
    const same = counts.filter((c) => c === counts[0]).length;
    const score = same * 100 + counts[0];
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

// → rows (arrays of strings). A trailing empty line is not a row.
export function parse(text, delim = ',') {
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // BOM
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === delim) { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Numbers sort as numbers ("1,234.5", "-3", "12%"), the rest as text.
export function asNumber(s) {
  const t = String(s).trim().replace(/,(?=\d{3}\b)/g, '').replace(/%$/, '');
  return t !== '' && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : null;
}

// Like parse(), but every field keeps where it sits in the text:
// rows of { text, from, to } (to is exclusive; quotes included). Lets one
// cell be edited without touching the rest of the file.
export function parseRanges(text, delim = ',') {
  const rows = [];
  let row = [], field = '', i = 0, quoted = false, from = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) { i = 1; from = 1; }
  const push = (to) => { row.push({ text: field, from, to }); field = ''; };
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === delim) { push(i); i++; from = i; continue; }
    if (c === '\r' || c === '\n') {
      push(i); rows.push(row); row = [];
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      from = i;
      continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length || from < n) { push(n); rows.push(row); }
  return rows;
}

// A value as it is written in the file: quoted when it must be.
export function quoteField(value, delim = ',') {
  const v = String(value);
  return v.includes(delim) || /["\r\n]/.test(v) || /^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
