// [[link]] completion in markdown: after "[[" the list offers the notes of the
// notes folder (set by the app with setWikiProvider). Elsewhere it falls back
// to completing any word of the document.
import { completeAnyWord } from '@codemirror/autocomplete';
import { wikiPrefix } from '../core/wiki.js';

let provider = null; // () => Promise<[{ label, detail }]>
export const setWikiProvider = (fn) => { provider = fn; };

// Inserts the note name and closes the link unless "]]" is already there.
function apply(view, completion, from, to) {
  const after = view.state.sliceDoc(to, to + 2);
  const insert = completion.label + (after === ']]' ? '' : ']]');
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + completion.label.length + 2 }, userEvent: 'input.complete' });
}

export function wikiOrWord(context) {
  const line = context.state.doc.lineAt(context.pos);
  const pre = provider && wikiPrefix(line.text.slice(0, context.pos - line.from));
  if (!pre) return completeAnyWord(context);
  return provider().then((notes) => ({
    from: line.from + pre.from,
    options: notes.map((n) => ({ label: n.label, detail: n.detail, type: 'text', apply })),
    validFor: /^[^[\]\n|#]*$/,
  }));
}
