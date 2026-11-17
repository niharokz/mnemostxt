// mnemostxt — start-up: pick the backend, sign in (web), choose the notes folder
// (first run), load the shared settings, restore the last session, build the UI.
// Kept short on purpose: the window shows the restored tabs as soon as possible.
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './styles/nss-app.css';
import './styles/app.css';
import { createBackend } from './backend/index.js';
import { Settings } from './core/settings.js';
import { App } from './ui/app.js';
import { Shell } from './ui/shell.js';
import { showLogin } from './ui/login.js';
import { h } from './ui/dom.js';
import { APP_NAME } from './core/brand.js';

// Web: the installed app opens offline and can be a share target (public/sw.js).
function registerWorker(backend) {
  if (backend.kind !== 'web' || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('service worker', e));
}

// What another app shared (the manifest's share_target), or a shortcut
// (?open=daily); the address is cleaned afterwards so a reload does not repeat it.
async function handleLaunchParams(app) {
  const q = new URLSearchParams(location.search);
  const title = q.get('share_title') || '', text = q.get('share_text') || '', url = q.get('share_url') || '';
  const open = q.get('open');
  if (!title && !text && !url && !open) return;
  history.replaceState(null, '', location.pathname);
  if (open === 'daily') { await app.dailyNote(); return; }
  const body = [title && `# ${title}`, text, url && !text.includes(url) ? url : ''].filter(Boolean).join('\n\n');
  if (body) app.newDoc({ text: body + '\n' });
}

// Anything that breaks start-up is shown, never a blank window.
function fatal(e) {
  console.error(e);
  const msg = e ? `${e.message || e}\n\n${e.stack || ''}` : 'unknown error';
  document.body.className = 'app boot';
  document.body.replaceChildren(h('main.center', {}, h('div.card', { style: { maxWidth: '640px' } },
    h('h2', {}, `${APP_NAME} could not start`),
    h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', color: 'var(--nss-bad)' } }, msg),
    h('button', { onclick: () => location.reload() }, 'Try again'))));
}

async function start() {
  let backend;
  try {
    backend = await createBackend();
  } catch (e) {
    document.body.replaceChildren(h('main.center', {}, h('div.card', {}, h('h2', {}, `${APP_NAME} cannot start`), h('p.muted', {}, e?.message || String(e)))));
    return;
  }
  registerWorker(backend);
  if (backend.kind === 'web' && !backend.signedIn) { showLogin(backend); return; }

  const settings = new Settings(backend);
  const app = new App(backend, settings);
  window.mnemostxt = app; // handy in the devtools console

  if (backend.notesRoot == null && backend.setNotesRoot) {
    document.body.className = 'app boot';
    await app.chooseNotesRoot(true);
  }
  await settings.load(); // before the session: it says where scratch and state live
  app.applyLook();
  app.syncDevice();
  await app.loadSession();

  const shell = new Shell(app);
  await shell.tree.renderAll();
  await app.restore();
  if (backend.startupFiles?.length) await shell.openPaths(backend.startupFiles);
  await handleLaunchParams(app);
  if (!app.docs.length) app.emit('active', null);
  document.body.classList.add('ready');
}

start().catch(fatal);
