// A list of every file in the notes folder, for Go to file, [[link]]
// completion and resolving links. Built when first needed (one listing per
// folder, a few at a time), kept for a few minutes, and dropped when the
// sidebar reports a change.
import { join, relative } from './paths.js';
import { appDirOf } from './settings.js';

const MAX_FILES = 30000;
const MAX_DIRS = 6000;
const TTL = 5 * 60 * 1000;

export class FileIndex {
  constructor(backend, settings) {
    this.backend = backend;
    this.settings = settings;
    this.list = null;
    this.at = 0;
    this.pending = null;
  }

  invalidate() { this.list = null; }

  // → [{ path, rel, name }], rel inside the notes folder
  files() {
    if (this.list && Date.now() - this.at < TTL) return Promise.resolve(this.list);
    this.pending ||= this.build().then((l) => { this.list = l; this.at = Date.now(); return l; }).finally(() => { this.pending = null; });
    return this.pending;
  }

  async build() {
    const root = this.backend.notesRoot;
    if (root == null) return [];
    const hidden = new Set(this.settings.get('hidden'));
    const skip = join(root, appDirOf(this.backend));
    const out = [];
    const queue = [root];
    let dirs = 0;
    const worker = async () => {
      while (queue.length && out.length < MAX_FILES && dirs < MAX_DIRS) {
        const dir = queue.shift();
        dirs++;
        let items;
        try { items = await this.backend.list(dir); } catch { continue; }
        for (const it of items) {
          if (hidden.has(it.name)) continue;
          const path = join(dir, it.name);
          if (it.dir) { if (path !== skip) queue.push(path); } else out.push({ path, rel: relative(path, root), name: it.name });
        }
      }
    };
    // a few listings at a time; a worker that finds the queue empty waits for the others
    const run = async () => { await Promise.all(Array.from({ length: 6 }, worker)); if (queue.length && out.length < MAX_FILES && dirs < MAX_DIRS) await run(); };
    await run();
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
  }
}
