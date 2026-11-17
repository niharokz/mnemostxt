// MnemoTXT web: lets the installed app open without a connection (it then
// says it is offline) and loads faster. Only the app's own files are cached;
// notes and everything under /api/ always come from the server, so nothing
// you write is ever stored in the browser.
const SHELL = 'mnemostxt-shell-v1';
const ASSETS = 'mnemostxt-assets-v1';
const MAX_ASSETS = 80;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './manifest.webmanifest', './icon.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mnemostxt-') && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(k);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // the page itself: the server first (it may have a new version), the cached copy offline
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok && url.pathname === new URL('./', self.registration.scope).pathname) caches.open(SHELL).then((c) => c.put('./', res.clone()));
      return res;
    }).catch(() => caches.match('./')));
    return;
  }
  // built files have a hash in their name: once cached, always right
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.open(ASSETS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { await c.put(req, res.clone()); trim(c); }
      return res;
    }));
  }
});
