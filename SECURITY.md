# Security

## Reporting

Please report security problems privately to the maintainer (GitLab profile
email), not in a public issue.

## How mnemostxt is built to be safe

**Desktop and Android apps**

- Work offline. The only network use is opening a link you click.
- Files are reached through the app's own commands (app/src), not a general
  file-system plugin; the window may only call those commands, the file
  dialogs and "open URL" (app/capabilities/default.json).
- Strict Content Security Policy: no remote scripts, no inline scripts, no
  plugins, frames or form posts.
- A note is untrusted text (it may arrive by sync or Share): rendered markdown
  goes through DOMPurify with scripts, styles, forms, frames, inline styles and
  event handlers removed.
- Credential stores are never read or written, whatever the window asks for
  (`app/src/guard.rs`): `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.docker`,
  password stores, browser profiles, keyrings, git and cloud tokens; system
  folders are read-only and `/etc/shadow`, `/proc`, `/sys` closed. Find in
  files never walks into them.
- Encrypted notes: AES-256-GCM, key from the passphrase with PBKDF2-SHA256
  (600 000 rounds), a fresh nonce on every save. The passphrase lives only in
  memory; unsaved edits and history of an encrypted note are never stored in
  plain text.
- Saves are atomic and refuse to overwrite a file that changed on disk.
- Unsaved edits are backed up in the app's own data folder, not next to your
  files.
- Android: no app data in Android backups or phone-to-phone transfers; Share
  accepts only content shared by another app (never `file://` links or the
  app's own files, which could copy private data into shared storage), up to
  200 MB a file; a widget can only open files inside the notes
  folder; optional `FLAG_SECURE` (hidden in Recents, no screenshots).

**Web app (server/)**

- One user, password as plain text or bcrypt hash, compared in constant time;
  the server warns at start about a plain password or a secret under 32
  characters.
- Optional second step: a 6-digit authenticator code (TOTP, RFC 6238,
  `MNEMOSTXT_TOTP_SECRET`); each code works once.
- Session cookie signed with HMAC-SHA256 from `MNEMOSTXT_SECRET` and the
  password (changing either signs out everywhere); `__Host-` cookie over HTTPS,
  HttpOnly, SameSite=Strict.
- Every change needs the `X-Mnemostxt` header and same-origin, which blocks
  cross-site forgery.
- Failed sign-ins: 5 within 15 minutes locks the address; public addresses are
  then banned for `MNEMOSTXT_BAN_HOURS` (bans survive restarts). The address
  comes from forwarding headers only when the connection is from a trusted
  proxy (`MNEMOSTXT_TRUSTED_PROXIES`, default: private ranges), so nobody can
  dodge a ban by sending their own `X-Forwarded-For`.
- Paths are checked lexically and again after resolving symlinks, and every
  file is then opened through an `os.Root` handle on the notes folder: the
  kernel itself refuses anything outside it, even a link swapped in between.
- Headers: CSP, HSTS (over HTTPS), `nosniff`, `no-referrer`, COOP/CORP,
  `frame-ancestors 'none'`, a Permissions-Policy that turns off camera,
  microphone, location and the rest.
- The service worker caches only the app's own files, never notes or `/api/`.
- Runs as your user in a read-only, capability-free container from `scratch`,
  with `no-new-privileges` and limits on processes and memory.

**Release keys and supply chain**

The Android signing key stays on the build machine (outside the repository);
`scripts/check-public.sh` blocks commits of keys, passwords, hashes and any
words listed in your own `.private-words`. Every push also runs `npm audit`,
`govulncheck`, `cargo audit` and `gitleaks` (report only). Each release has a
`SHA256SUMS` for its files.
