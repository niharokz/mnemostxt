// Text compare (Compare window, ui/compareView.js): the parts that need no
// screen. Comparison rules, the diff the side-by-side view draws, copying a
// difference from one side to the other, the summary and a unified-diff
// (patch) export.
import { diff as charDiff, Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';
import { diffIndices } from './diff.js';

// What counts as "the same line".
//   ws: 'none' | 'trailing' | 'ends' (leading and trailing) | 'all'
export const DEFAULT_RULES = Object.freeze({ case: false, ws: 'none', blank: false });
export const WS_RULES = [['none', 'Compare whitespace'], ['trailing', 'Ignore trailing'], ['ends', 'Ignore leading and trailing'], ['all', 'Ignore all whitespace']];

export const rulesActive = (r) => !!r && (r.case || (r.ws && r.ws !== 'none') || r.blank);

export function normalizeLine(line, r = DEFAULT_RULES) {
  let s = line;
  if (r.ws === 'all') s = s.replace(/\s+/g, '');
  else if (r.ws === 'ends') s = s.trim();
  else if (r.ws === 'trailing') s = s.replace(/\s+$/, '');
  if (r.case) s = s.toLowerCase();
  return s;
}

// Lines and the offset each one starts at ("\n" separated, as in the editor).
function lineTable(text) {
  const lines = text.split('\n');
  const starts = new Array(lines.length);
  let pos = 0;
  for (let i = 0; i < lines.length; i++) { starts[i] = pos; pos += lines[i].length + 1; }
  return { lines, starts, at: (i) => (i < lines.length ? starts[i] : text.length) };
}

// Changed line runs: [{ a0, a1, b0, b1 }] (line indices, end exclusive).
export function lineRuns(aText, bText, rules = DEFAULT_RULES) {
  const A = aText.split('\n'), B = bText.split('\n');
  const ops = diffIndices(A.map((l) => normalizeLine(l, rules)), B.map((l) => normalizeLine(l, rules)));
  const runs = [];
  let cur = null, ai = 0, bi = 0;
  for (const o of ops) {
    if (o.op === ' ') {
      if (cur) { runs.push(cur); cur = null; }
      ai = o.a + 1; bi = o.b + 1;
      continue;
    }
    if (!cur) cur = { a0: ai, a1: ai, b0: bi, b1: bi };
    if (o.op === '-') { cur.a1 = o.a + 1; ai = o.a + 1; } else { cur.b1 = o.b + 1; bi = o.b + 1; }
  }
  if (cur) runs.push(cur);
  if (!rules.blank) return runs;
  // "ignore blank lines": a run that only adds or removes empty lines is no difference
  const blank = (arr, i0, i1) => arr.slice(i0, i1).every((l) => !l.trim());
  return runs.filter((r) => !(blank(A, r.a0, r.a1) && blank(B, r.b0, r.b1)));
}

// The diff the merge view draws when rules are on (DiffConfig.override): lines
// that are equal under the rules are no change; inside a changed run the
// characters are compared exactly, so the view still marks what differs.
export function ruleDiff(aText, bText, rules = DEFAULT_RULES) {
  const ta = lineTable(aText), tb = lineTable(bText);
  const out = [];
  for (const r of lineRuns(aText, bText, rules)) {
    const fa = ta.at(r.a0), fb = tb.at(r.b0);
    const sa = aText.slice(fa, ta.at(r.a1)), sb = bText.slice(fb, tb.at(r.b1));
    for (const c of charDiff(sa, sb)) out.push(Object.assign(Object.create(Object.getPrototypeOf(c)), { fromA: c.fromA + fa, toA: c.toA + fa, fromB: c.fromB + fb, toB: c.toB + fb }));
  }
  return out;
}

// Differences as the merge view groups them (chunks of whole lines).
export function diffConfig(rules = DEFAULT_RULES) {
  return rulesActive(rules) ? { override: (x, y) => ruleDiff(x, y, rules) } : { scanLimit: 5000, timeout: 2000 };
}
export function chunksOf(aText, bText, rules = DEFAULT_RULES) {
  return Chunk.build(Text.of(aText.split('\n')), Text.of(bText.split('\n')), diffConfig(rules));
}

// What to change in the target document to copy one chunk across.
// dir 'a-to-b': make B's lines of this chunk equal A's; 'b-to-a' the reverse.
// docA/docB: CodeMirror Text. → { from, to, insert } for the target side.
export function copyChunkChange(chunk, docA, docB, dir = 'a-to-b') {
  const [src, dst] = dir === 'a-to-b' ? [docA, docB] : [docB, docA];
  const [sFrom, sTo, dFrom, dTo] = dir === 'a-to-b' ? [chunk.fromA, chunk.toA, chunk.fromB, chunk.toB] : [chunk.fromB, chunk.toB, chunk.fromA, chunk.toA];
  let insert = src.sliceString(sFrom, Math.min(sTo, src.length));
  const srcHasNl = sTo <= src.length && sTo > sFrom; // the copied lines end with a line break
  let from = Math.min(dFrom, dst.length), to = Math.min(dTo, dst.length);
  const dstHasNl = dTo <= dst.length && dTo > dFrom;
  if (dFrom > dst.length || (dFrom === dTo && dFrom === dst.length && dst.length > 0 && !srcHasNl)) {
    // inserting after the target's last line, which has no line break
    if (insert) insert = '\n' + insert.replace(/\n$/, '');
    from = to = dst.length;
  } else if (dFrom === dTo) {
    // inserting whole lines before a target line: they need their line break
    if (insert && !insert.endsWith('\n')) insert += '\n';
  } else if (srcHasNl && !dstHasNl) {
    insert = insert.replace(/\n$/, '');
  } else if (!srcHasNl && dstHasNl && insert) {
    insert += '\n';
  } else if (!insert && !dstHasNl && from > 0) {
    from -= 1; // removing the target's last lines: take the line break before them too
  }
  return { from, to, insert };
}

// { blocks, added, removed, changed } in lines, for the status line.
export function summary(aText, bText, rules = DEFAULT_RULES) {
  let added = 0, removed = 0, changed = 0;
  const runs = lineRuns(aText, bText, rules);
  for (const r of runs) {
    const na = r.a1 - r.a0, nb = r.b1 - r.b0;
    const both = Math.min(na, nb);
    changed += both; removed += na - both; added += nb - both;
  }
  return { blocks: runs.length, added, removed, changed };
}

// A unified diff (what `diff -u` writes, and `git apply` / `patch` read).
// Labels name the two sides; rules decide which lines count as changed.
export function unifiedDiff(aText, bText, { from = 'a', to = 'b', context = 3, rules = DEFAULT_RULES } = {}) {
  const split = (t) => {
    if (t === '') return { lines: [], noEol: false };
    const lines = t.split('\n');
    if (lines[lines.length - 1] === '') { lines.pop(); return { lines, noEol: false }; }
    return { lines, noEol: true };
  };
  const A = split(aText), B = split(bText);
  const keyA = A.lines.map((l) => normalizeLine(l, rules)), keyB = B.lines.map((l) => normalizeLine(l, rules));
  // a last line without a line break only matches another one (as in diff -u)
  if (A.noEol) keyA[keyA.length - 1] += '\0';
  if (B.noEol) keyB[keyB.length - 1] += '\0';
  const ops = diffIndices(keyA, keyB);
  if (!ops.some((o) => o.op !== ' ')) return '';
  const out = [`--- ${from}`, `+++ ${to}`];
  const changedAt = ops.map((o) => o.op !== ' ');
  let i = 0;
  while (i < ops.length) {
    if (!changedAt[i]) { i++; continue; }
    let start = Math.max(0, i - context), end = i;
    // extend while the next change is within 2 × context
    for (;;) {
      while (end < ops.length && changedAt[end]) end++;
      let next = end;
      while (next < ops.length && !changedAt[next]) next++;
      if (next < ops.length && next - end <= 2 * context) { end = next; continue; }
      break;
    }
    const stop = Math.min(ops.length, end + context);
    const part = ops.slice(start, stop);
    let aStart = null, bStart = null, aLen = 0, bLen = 0;
    for (const o of part) {
      if (o.op !== '+') { if (aStart == null) aStart = o.a; aLen++; }
      if (o.op !== '-') { if (bStart == null) bStart = o.b; bLen++; }
    }
    const aBefore = ops.slice(0, start).filter((o) => o.op !== '+').length;
    const bBefore = ops.slice(0, start).filter((o) => o.op !== '-').length;
    const range = (s, len, before) => (len === 0 ? `${before},0` : len === 1 ? `${s + 1}` : `${s + 1},${len}`);
    out.push(`@@ -${range(aStart ?? aBefore, aLen, aBefore)} +${range(bStart ?? bBefore, bLen, bBefore)} @@`);
    for (const o of part) {
      if (o.op === ' ') { out.push(' ' + A.lines[o.a]); if (A.noEol && o.a === A.lines.length - 1) out.push('\\ No newline at end of file'); }
      else if (o.op === '-') { out.push('-' + A.lines[o.a]); if (A.noEol && o.a === A.lines.length - 1) out.push('\\ No newline at end of file'); }
      else { out.push('+' + B.lines[o.b]); if (B.noEol && o.b === B.lines.length - 1) out.push('\\ No newline at end of file'); }
    }
    i = stop;
  }
  return out.join('\n') + '\n';
}
