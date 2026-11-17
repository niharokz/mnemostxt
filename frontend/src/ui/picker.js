// A quick-pick list: type to filter, arrows and Enter to choose (Go to file,
// Go to heading, History). items: [{ label, detail?, value }]; `score(q, item)`
// ranks them (a number, below 0 = hidden); resolves with the chosen value.
import { sheet } from './dialogs.js';
import { h } from './dom.js';

export function pick({ title, items, placeholder = 'Type to filter', score, empty = 'Nothing found', limit = 100 }) {
  const input = h('input', { type: 'search', placeholder, autofocus: true, spellcheck: 'false', autocapitalize: 'off' });
  const list = h('div.pick-list', { role: 'listbox' });
  const rank = score || ((q, it) => (`${it.label} ${it.detail || ''}`.toLowerCase().includes(q.toLowerCase()) ? 1 : -1));
  let shown = [], at = 0, chosen;
  const done = (v) => { chosen = v; list.closest('dialog')?.done(v); };
  const mark = () => {
    [...list.children].forEach((el, i) => el.classList.toggle('on', i === at));
    list.children[at]?.scrollIntoView({ block: 'nearest' });
  };
  const draw = () => {
    const q = input.value.trim();
    shown = q
      ? items.map((it) => [rank(q, it), it]).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, it]) => it)
      : items.slice(0, limit);
    at = 0;
    list.replaceChildren(...(shown.length
      ? shown.map((it, i) => h('button.pick', { type: 'button', role: 'option', onclick: () => done(it.value), onpointermove: () => { if (at !== i) { at = i; mark(); } } },
        h('span.pick-l', {}, it.label), it.detail ? h('span.pick-d.muted', {}, it.detail) : null))
      : [h('p.muted', {}, empty)]));
    mark();
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) { at = (at + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; mark(); }
    } else if (e.key === 'Enter') { e.preventDefault(); if (shown[at]) done(shown[at].value); }
  });
  draw();
  return sheet({ title, body: h('div.picker', {}, input, list) }).then(() => chosen);
}
