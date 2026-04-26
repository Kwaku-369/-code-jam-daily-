/**
 * TOTP 2FA — RFC 6238 (Google Authenticator / Authy compatible)
 * =============================================================
 * Standard: RFC 6238 TOTP, RFC 4226 HOTP
 * Compatible with: Google Authenticator, Authy, 1Password, Bitwarden
 *
 * No external dependency on otplib — pure Web Crypto API (Cloudflare Workers compatible)
 * Install: npm i otpauth  (drop-in production replacement for the stubs below)
 */

// ---- Pure TOTP implementation (Web Crypto, zero deps) -------------------

function base32Decode(encoded: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned  = encoded.toUpperCase().replace(/=+$/, "");
  let bits = 0, value = 0;
  const output: number[] = [];
  for (const char of cleaned) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 char: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

function base32Encode(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  while (output.length % 8) output += "=";
  return output;
}

async function hmacSHA1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, message);
  return new Uint8Array(sig);
}

async function hotp(secret: Uint8Array, counter: bigint): Promise<string> {
  const msg = new Uint8Array(8);
  const view = new DataView(msg.buffer);
  view.setBigUint64(0, counter, false);
  const mac = await hmacSHA1(secret, msg);
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (
    ((mac[offset]     & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) <<  8) |
     (mac[offset + 3] & 0xff)
  ) % 1_000_000;
  return code.toString().padStart(6, "0");
}

// ---- Public TOTP API ------------------------------------------------------

export interface TOTPSecret {
  secret:   string;   // base32-encoded
  otpauth:  string;   // otpauth:// URI for QR code
}

export const TOTP_ISSUER = "MiningPlatform";
export const TOTP_STEP   = 30;    // seconds
export const TOTP_WINDOW = 1;     // allow ±1 step for clock drift

export async function generateTOTPSecret(
  email:  string,
  issuer: string = TOTP_ISSUER,
): Promise<TOTPSecret> {
  const raw    = crypto.getRandomValues(new Uint8Array(20));
  const secret = base32Encode(raw).replace(/=/g, "");
  const label  = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits:    "6",
    period:    String(TOTP_STEP),
  });
  return { secret, otpauth: `otpauth://totp/${label}?${params}` };
}

export async function verifyTOTP(
  secret:  string,
  token:   string,
  step:    number = TOTP_STEP,
  window:  number = TOTP_WINDOW,
): Promise<boolean> {
  const key     = base32Decode(secret);
  const counter = BigInt(Math.floor(Date.now() / 1000 / step));
  for (let delta = -window; delta <= window; delta++) {
    const expected = await hotp(key, counter + BigInt(delta));
    if (expected === token.replace(/\s/g, "")) return true;
  }
  return false;
}

export async function generateTOTPToken(secret: string, step = TOTP_STEP): Promise<string> {
  const key     = base32Decode(secret);
  const counter = BigInt(Math.floor(Date.now() / 1000 / step));
  return hotp(key, counter);
}
