// Compares two versions of a note line by line (sync conflicts, File →
// History): removed lines in red, added lines in green, unchanged stretches
// folded away. actions: sheet buttons [{ label, value, primary?, danger? }].
import { diffLines, diffStat, hunks } from '../core/diff.js';
import { sheet } from './dialogs.js';
import { h } from './dom.js';

export function showDiff({ title, fromLabel, toLabel, from, to, actions = [] }) {
  const rows = diffLines(from, to);
  const { added, removed } = diffStat(rows);
  const same = !added && !removed;
  let all = false;
  const body = h('div.diff-body');
  const draw = () => {
    const list = all ? rows : hunks(rows);
    body.replaceChildren(...list.slice(0, 5000).map((r) => h('div.diff-row', { class: r.op === '+' ? 'add' : r.op === '-' ? 'del' : r.op === '…' ? 'gap' : '' },
      h('span.diff-op', {}, r.op === ' ' ? '' : r.op), h('span.diff-t', {}, r.text || ' '))));
    if (list.length > 5000) body.append(h('p.muted', {}, 'Too many lines to show them all.'));
  };
  draw();
  const toggle = h('button.ghost', { type: 'button', onclick: () => { all = !all; toggle.textContent = all ? 'Changes only' : 'Whole file'; draw(); } }, 'Whole file');
  return sheet({
    title,
    wide: true,
    body: h('div.diff', {},
      h('div.diff-head', {},
        h('span.diff-legend', {}, h('span.del', {}, `− ${fromLabel}`), ' ', h('span.add', {}, `+ ${toLabel}`)),
        h('span.grow'),
        h('span.muted', {}, same ? 'No differences' : `${added} added · ${removed} removed`),
        same ? null : toggle),
      same ? h('p.muted', {}, 'Both versions have the same text.') : body),
    actions: [{ label: 'Close', value: undefined }, ...actions],
  });
}
