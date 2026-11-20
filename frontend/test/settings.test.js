// Per-platform settings (src/core/settings.js, 0.1.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Settings, effective, sanitize, DEFAULTS } from '../src/core/settings.js';

const fake = (platform, files = new Map()) => {
  return {
    platform, notesRoot: '/n', appDir: 'logs/mnemostxt', files,
    stat: async (p) => (files.has(p) ? { mtime: 1 } : null),
    read: async (p) => ({ bytes: new TextEncoder().encode(files.get(p)), mtime: 1 }),
    mkdirAll: async () => {},
    write: async (p, bytes) => { files.set(p, new TextDecoder().decode(bytes)); return { mtime: 2 }; },
  };
};
const fileOf = (be) => JSON.parse(be.files.get('/n/logs/mnemostxt/settings.json'));

test('settings: platform overrides apply only there, wrong values fall back to the shared one', () => {
  const raw = sanitize({ fontSize: 13, windowOpacity: 0.9, platforms: { linux: { windowOpacity: 0.7, fontSize: 'big' }, windows: { fontSize: 16 } } });
  assert.equal(effective(raw, 'linux').windowOpacity, 0.7);
  assert.equal(effective(raw, 'linux').fontSize, 13, 'a wrong override is ignored, the shared value applies');
  assert.equal(effective(raw, 'windows').fontSize, 16);
  assert.equal(effective(raw, 'android').windowOpacity, 0.9);
  assert.equal(effective(raw, 'linux').platforms.windows.fontSize, 16);
});

test('settings: per-platform keys and pinned keys stay on this platform', async () => {
  const be = fake('linux');
  const s = new Settings(be);
  s.set({ windowOpacity: 0.8, fontSize: 18 });
  assert.equal(s.get('windowOpacity'), 0.8);
  await s.save();
  let f = fileOf(be);
  assert.equal(f.windowOpacity, DEFAULTS.windowOpacity, 'opacity is not shared');
  assert.equal(f.platforms.linux.windowOpacity, 0.8);
  assert.equal(f.fontSize, 18, 'font size is shared');

  s.pin('theme');
  s.set({ theme: 'charcoal' });
  await s.save();
  f = fileOf(be);
  assert.equal(f.theme, DEFAULTS.theme);
  assert.equal(f.platforms.linux.theme, 'charcoal');
  assert.equal(s.pinned('theme'), true);

  // another device (Android) reads the same file
  const be2 = fake('android', be.files);
  const s2 = new Settings(be2);
  await s2.load();
  assert.equal(s2.get('theme'), DEFAULTS.theme);
  assert.equal(s2.get('windowOpacity'), DEFAULTS.windowOpacity);
  assert.equal(s2.get('fontSize'), 18);

  s.pin('theme', false);
  assert.equal(s.get('theme'), DEFAULTS.theme, 'unpinned: the shared value again');
  s.pin('windowOpacity', false); // per-platform keys cannot be unpinned
  assert.equal(s.get('windowOpacity'), 0.8);
  await s.save();
  assert.equal(fileOf(be).platforms.linux.theme, undefined);
});

test('settings: no empty platforms section is written', async () => {
  const be = fake('web');
  const s = new Settings(be);
  s.set({ fontSize: 15 });
  await s.save();
  assert.equal('platforms' in fileOf(be), false);
});
