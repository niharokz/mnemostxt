// Line diff for the compare views (sync conflicts, file history, Compare).
// Myers' algorithm on lines; the common start and end are skipped first, so two
// versions of a long note that differ in a few places compare quickly.

const MAX_D = 4000; // edits beyond this: the files are shown as wholly different

// → [{ op: ' ' | '-' | '+', text }]: lines of a, with what b removes or adds.
export function diffLines(aText, bText) {
  const a = aText.split('\n'), b = bText.split('\n');
  return diffIndices(a, b).map((o) => ({ op: o.op, text: o.op === '+' ? b[o.b] : a[o.a] }));
}

// The same on two arrays (of anything compared with ===), with positions:
// [{ op: ' ' | '-' | '+', a, b }]; a is the index in a ('-' and ' '),
// b the index in b ('+' and ' ').
export function diffIndices(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const out = [];
  for (let i = 0; i < start; i++) out.push({ op: ' ', a: i, b: i });
  for (const o of myers(a.slice(start, endA), b.slice(start, endB))) {
    out.push({ op: o.op, a: o.a == null ? null : o.a + start, b: o.b == null ? null : o.b + start });
  }
  for (let i = 0; i < a.length - endA; i++) out.push({ op: ' ', a: endA + i, b: endB + i });
  return out;
}

function myers(a, b) {
  const n = a.length, m = b.length;
  const del = (x) => ({ op: '-', a: x, b: null });
  const add = (y) => ({ op: '+', a: null, b: y });
  if (!n) return b.map((_, y) => add(y));
  if (!m) return a.map((_, x) => del(x));
  const max = Math.min(n + m, MAX_D);
  const off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) return [...a.map((_, x) => del(x)), ...b.map((_, y) => add(y))];
  const out = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const pv = trace[d];
    const k = x - y;
    const pk = k === -d || (k !== d && pv[off + k - 1] < pv[off + k + 1]) ? k + 1 : k - 1;
    const px = pv[off + pk], py = px - pk;
    while (x > px && y > py) { x--; y--; out.push({ op: ' ', a: x, b: y }); }
    if (x === px) { y--; out.push(add(y)); } else { x--; out.push(del(x)); }
  }
  while (x > 0 && y > 0) { x--; y--; out.push({ op: ' ', a: x, b: y }); }
  return out.reverse();
}

// { added, removed } line counts.
export function diffStat(rows) {
  let added = 0, removed = 0;
  for (const r of rows) { if (r.op === '+') added++; else if (r.op === '-') removed++; }
  return { added, removed };
}

// Keeps changed lines with `context` unchanged lines around them; a gap
// becomes { op: '…', text: 'n unchanged lines' }.
export function hunks(rows, context = 3) {
  const keep = new Uint8Array(rows.length);
  rows.forEach((r, i) => { if (r.op !== ' ') for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep[j] = 1; });
  const out = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    if (keep[i]) { if (skipped) { out.push({ op: '…', text: `${skipped} unchanged line${skipped > 1 ? 's' : ''}` }); skipped = 0; } out.push(r); } else skipped++;
  });
  if (skipped) out.push({ op: '…', text: `${skipped} unchanged line${skipped > 1 ? 's' : ''}` });
  return out;
}
