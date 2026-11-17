// Encrypted notes: a file whose content is encrypted with a passphrase, with
// the browser's own crypto (WebCrypto): AES-256-GCM, the key derived with
// PBKDF2-SHA256. Nothing is stored anywhere: forget the passphrase and the
// note is gone. On disk the file is two lines of text, so it syncs and diffs
// like any note:
//
//   mnemostxt-enc:v1
//   <base64 of: 16-byte salt | 12-byte nonce | ciphertext + tag>
//
// The salt stays the same for a file (the derived key is kept in memory while
// the note is open, so saving is instant); every save uses a fresh nonce.
import { fromBase64, toBase64 } from './encoding.js';

export const ENC_HEADER = 'mnemostxt-enc:v1';
const ITERATIONS = 600_000;
const HEAD = new TextEncoder().encode(ENC_HEADER);

export const cryptoAvailable = () => !!globalThis.crypto?.subtle;

export function isEncrypted(bytes) {
  if (!bytes || bytes.length < HEAD.length + 1) return false;
  for (let i = 0; i < HEAD.length; i++) if (bytes[i] !== HEAD[i]) return false;
  return bytes[HEAD.length] === 0x0a || bytes[HEAD.length] === 0x0d;
}

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// A new lock for a file: { key, salt }.
export async function newLock(passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { key: await deriveKey(passphrase, salt), salt };
}

// plain bytes → the file's bytes.
export async function encryptBytes(plain, lock) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, lock.key, plain));
  const packed = new Uint8Array(16 + 12 + ct.length);
  packed.set(lock.salt, 0); packed.set(iv, 16); packed.set(ct, 28);
  return new TextEncoder().encode(`${ENC_HEADER}\n${toBase64(packed)}\n`);
}

function unpack(bytes) {
  const body = new TextDecoder().decode(bytes).split(/\r?\n/)[1] || '';
  let packed;
  try { packed = fromBase64(body.trim()); } catch { packed = null; }
  if (!packed || packed.length < 16 + 12 + 16) throw new Error('This encrypted note is damaged');
  return { salt: packed.slice(0, 16), iv: packed.slice(16, 28), ct: packed.slice(28) };
}

// The file's bytes → { plain, lock }. Pass the passphrase, or the lock from an
// earlier open (same salt: no key derivation). Throws 'WRONG' on a bad passphrase.
export async function decryptBytes(bytes, { passphrase, lock } = {}) {
  const { salt, iv, ct } = unpack(bytes);
  const same = lock && lock.salt.length === salt.length && lock.salt.every((b, i) => b === salt[i]);
  if (!same && passphrase == null) { const e = new Error('The passphrase is needed again'); e.code = 'WRONG'; throw e; }
  const use = same ? lock : { key: await deriveKey(passphrase, salt), salt };
  try {
    return { plain: new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, use.key, ct)), lock: use };
  } catch {
    const e = new Error('Wrong passphrase');
    e.code = 'WRONG';
    throw e;
  }
}
