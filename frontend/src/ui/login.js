// Web sign-in card, laid out like Natlas and Arthik: brand, user, password,
// the demo box (only when the server offers a demo account, MNEMOSTXT_DEMO_USER)
// and a link back to the About page. The server limits failed attempts per
// address and bans repeat offenders.
import { h, logo } from './dom.js';
import { APP_NAME } from '../core/brand.js';

export function showLogin(backend) {
  const user = h('input', { name: 'user', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true });
  const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  // only when the server asks for an authenticator code (MNEMOSTXT_TOTP_SECRET)
  const code = backend.totp ? h('input', { name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9 ]*', maxlength: 7, placeholder: '6 digits', spellcheck: 'false' }) : null;
  const err = h('p.err', { role: 'alert' });
  const btn = h('button.primary.block', { type: 'submit' }, 'Sign in');
  const demo = backend.demoUser;

  const submit = async (u, p, c = '') => {
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    err.textContent = '';
    try {
      await backend.login(u, p, c);
      location.reload();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = 'Sign in';
      (code && code.value ? code : pass).select();
    }
  };

  const form = h('form.card.login', { onsubmit: (e) => { e.preventDefault(); submit(user.value, pass.value, code?.value || ''); } },
    h('div.login-brand', {}, logo(30), h('span.brand', {}, APP_NAME)),
    h('label.f', {}, h('span', {}, 'Username'), user),
    h('label.f', {}, h('span', {}, 'Password'), pass),
    code ? h('label.f', {}, h('span', {}, 'Authenticator code'), code) : null,
    btn, err,
    demo ? h('div.demo-box', {},
      h('b', {}, 'Try the demo'), ' (read-only, sample notes)', h('br'),
      'user ', h('code', {}, demo.user), ' · password ', h('code', {}, demo.password),
      h('div', {}, h('button', { type: 'button', onclick: () => submit(demo.user, demo.password) }, 'Open the demo'))) : null,
    h('p.login-foot', {}, h('a', { href: '/' }, `← About ${APP_NAME}`)));
  document.body.className = 'login';
  document.body.replaceChildren(h('main.center', {}, form));
  user.focus();
}
