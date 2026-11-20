// Text compare core (src/core/compare.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Text } from '@codemirror/state';
import { normalizeLine, lineRuns, ruleDiff, chunksOf, copyChunkChange, summary, unifiedDiff, rulesActive } from '../src/core/compare.js';

const T = (s) => Text.of(s.split('\n'));
const apply = (doc, { from, to, insert }) => doc.sliceString(0, from) + insert + doc.sliceString(to);

test('compare rules: what counts as the same line', () => {
  assert.equal(normalizeLine('  Foo bar  ', { ws: 'none' }), '  Foo bar  ');
  assert.equal(normalizeLine('  Foo bar  ', { ws: 'trailing' }), '  Foo bar');
  assert.equal(normalizeLine('  Foo bar  ', { ws: 'ends' }), 'Foo bar');
  assert.equal(normalizeLine('  Foo  bar  ', { ws: 'all' }), 'Foobar');
  assert.equal(normalizeLine('Foo', { case: true, ws: 'none' }), 'foo');
  assert.equal(rulesActive({ case: false, ws: 'none', blank: false }), false);
  assert.equal(rulesActive({ case: false, ws: 'trailing', blank: false }), true);
});

test('compare: changed runs, with and without rules', () => {
  assert.deepEqual(lineRuns('a\nb\nc', 'a\nB\nc'), [{ a0: 1, a1: 2, b0: 1, b1: 2 }]);
  assert.deepEqual(lineRuns('a\nb\nc', 'a\nB\nc', { case: true, ws: 'none' }), []);
  assert.deepEqual(lineRuns('a \nb', 'a\nb', { ws: 'trailing' }), []);
  assert.deepEqual(lineRuns('a\n\nb', 'a\nb', { ws: 'none', blank: true }), []);
  assert.equal(lineRuns('a\n\nb', 'a\nb').length, 1);
  assert.deepEqual(lineRuns('x', 'x'), []);
});

test('compare: the view diff ignores what the rules ignore', () => {
  const a = 'one\ntwo  \nthree\n', b = 'one\ntwo\nTHREE\nfour\n';
  assert.equal(chunksOf(a, b).length, 1);
  const ruled = chunksOf(a, b, { case: true, ws: 'trailing', blank: false });
  assert.equal(ruled.length, 1);
  assert.equal(T(b).sliceString(ruled[0].fromB, ruled[0].toB), 'four\n'); // only the new line is left
  for (const c of ruleDiff(a, b, { case: true, ws: 'trailing' })) assert.ok(c.fromA <= c.toA && c.fromB <= c.toB);
  assert.deepEqual(chunksOf('same\ntext', 'same\ntext'), []);
});

test('compare: copying every difference across makes the sides equal', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const words = ['alpha', 'beta', '', 'gamma', 'delta', '  x', 'Alpha'];
  const make = () => {
    const n = rnd(8);
    const lines = Array.from({ length: n }, () => words[rnd(words.length)]);
    return lines.join('\n') + (rnd(2) ? '\n' : '');
  };
  for (let i = 0; i < 400; i++) {
    const a = make(), b = make();
    for (const dir of ['a-to-b', 'b-to-a']) {
      let docA = T(a), docB = T(b);
      // one difference at a time, last first, as the user clicks them
      for (let guard = 0; guard < 100; guard++) {
        const chunks = chunksOf(docA.toString(), docB.toString());
        if (!chunks.length) break;
        const ch = copyChunkChange(chunks[chunks.length - 1], docA, docB, dir);
        if (dir === 'a-to-b') docB = T(apply(docB, ch)); else docA = T(apply(docA, ch));
      }
      assert.equal(docA.toString(), docB.toString(), `${dir}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
  }
});

test('compare: summary counts lines', () => {
  assert.deepEqual(summary('a\nb\nc', 'a\nB\nc\nd'), { blocks: 2, added: 1, removed: 0, changed: 1 });
  assert.deepEqual(summary('a', 'a'), { blocks: 0, added: 0, removed: 0, changed: 0 });
});

// a small unified-diff applier, to check that the patch reproduces the right side
function applyUnified(text, patch) {
  const src = text === '' ? [] : text.replace(/\n$/, '').split('\n');
  const srcNoEol = text !== '' && !text.endsWith('\n');
  const fromSrc = (i) => ({ text: src[i], noEol: srcNoEol && i === src.length - 1 });
  const lines = patch.split('\n');
  const out = [];
  let pos = 0, i = 2;
  while (i < lines.length && lines[i]) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(lines[i]);
    assert.ok(m, 'hunk header: ' + lines[i]);
    const aStart = Number(m[1]), aLen = m[2] == null ? 1 : Number(m[2]);
    const from = aLen === 0 ? aStart : aStart - 1;
    while (pos < from) out.push(fromSrc(pos++));
    i++;
    while (i < lines.length && lines[i] && !lines[i].startsWith('@@')) {
      const l = lines[i];
      const marked = lines[i + 1] === '\\ No newline at end of file';
      if (l[0] === ' ') { assert.equal(src[pos], l.slice(1)); out.push({ text: src[pos++], noEol: marked }); }
      else if (l[0] === '-') { assert.equal(src[pos], l.slice(1)); pos++; }
      else if (l[0] === '+') out.push({ text: l.slice(1), noEol: marked });
      i += marked ? 2 : 1;
    }
  }
  while (pos < src.length) out.push(fromSrc(pos++));
  if (!out.length) return '';
  return out.map((o) => o.text).join('\n') + (out[out.length - 1].noEol ? '' : '\n');
}

test('compare: the unified diff turns the left side into the right one', () => {
  assert.equal(unifiedDiff('a\n', 'a\n'), '');
  assert.equal(unifiedDiff('a\nb\nc\n', 'a\nB\nc\n', { from: 'x', to: 'y' }), '--- x\n+++ y\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n');
  assert.equal(unifiedDiff('a\n', 'a'), '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+a\n\\ No newline at end of file\n');
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const make = () => {
    const n = rnd(30);
    return Array.from({ length: n }, () => 'l' + rnd(6)).join('\n') + (n && rnd(3) ? '\n' : '');
  };
  for (let k = 0; k < 300; k++) {
    const a = make(), b = make();
    const p = unifiedDiff(a, b, { context: rnd(4) });
    if (!p) { assert.equal(a, b); continue; }
    assert.equal(applyUnified(a, p), b, JSON.stringify({ a, b, p }));
  }
});
