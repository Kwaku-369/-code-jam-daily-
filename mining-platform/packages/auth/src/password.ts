/**
 * Password hashing — PBKDF2 via Web Crypto (Cloudflare Workers compatible)
 * =========================================================================
 * Algorithm: PBKDF2-SHA256, 600,000 iterations (OWASP 2024 recommendation)
 * Output format: pbkdf2$iterations$salt$hash  (all base64url)
 */

const ITERATIONS = 600_000;
const KEY_LENGTH  = 32;

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")).split("").map(c => c.charCodeAt(0)));
}

export async function hashPassword(password: string): Promise<string> {
  const salt    = crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    baseKey, KEY_LENGTH * 8,
  );
  return `pbkdf2$${ITERATIONS}$${toB64(salt.buffer)}$${toB64(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, iters, saltB64, hashB64] = stored.split("$");
  const salt    = fromB64(saltB64);
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: Number(iters), hash: "SHA-256" },
    baseKey, KEY_LENGTH * 8,
  );
  // Constant-time comparison
  const a = new Uint8Array(derived);
  const b = fromB64(hashB64);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
