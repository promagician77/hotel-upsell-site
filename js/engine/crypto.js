// HMAC-SHA256 with WebCrypto, available in browsers and in Node 18+ as globalThis.crypto.
const enc = new TextEncoder();
const keys = new Map();

async function key(secret) {
  if (!keys.has(secret)) keys.set(secret, await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  return keys.get(secret);
}

export async function hmacHex(secret, data) {
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** Signed, expiring token for a guest link: offer page, one-click unsubscribe. */
export async function signToken(secret, payload) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${(await hmacHex(secret, body)).slice(0, 32)}`;
}

export async function verifyToken(secret, token, now) {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, why: 'malformed' };
  const [body, sig] = token.split('.');
  const want = (await hmacHex(secret, body)).slice(0, 32);
  if (!safeEqual(sig, want)) return { ok: false, why: 'bad signature' };
  let p;
  try { p = JSON.parse(unb64u(body)); } catch { return { ok: false, why: 'malformed' }; }
  if (p.exp && now > p.exp) return { ok: false, why: 'expired', payload: p };
  return { ok: true, payload: p };
}
