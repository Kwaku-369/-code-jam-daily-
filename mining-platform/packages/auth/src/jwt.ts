/**
 * JWT — Cloudflare Workers Web Crypto (no jsonwebtoken dep)
 * ==========================================================
 * Uses HS256 (HMAC-SHA256) — pure Web Crypto API.
 * Access token:  15 min  (short-lived)
 * Refresh token: 7 days  (rotated on use)
 */

import type { Role } from "../../shared/src/index";

export interface JWTPayload {
  sub:        string;   // user_id
  email:      string;
  role:       Role;
  company_id: string;
  type:       "access" | "refresh" | "api_key";
  iat:        number;
  exp:        number;
}

function b64url(data: string | ArrayBuffer): string {
  const bytes = typeof data === "string"
    ? new TextEncoder().encode(data)
    : new Uint8Array(data);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

async function getKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );
}

export async function signJWT(payload: Omit<JWTPayload, "iat" | "exp">, secret: string, expiresIn = 900): Promise<string> {
  const header  = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body    = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresIn }));
  const key     = await getKey(secret, ["sign"]);
  const sig     = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT");

  const key      = await getKey(secret, ["verify"]);
  const sigBytes = Uint8Array.from(b64urlDecode(parts[2]).split("").map(c => c.charCodeAt(0)));
  const valid    = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new Error("Invalid JWT signature");

  const payload: JWTPayload = JSON.parse(b64urlDecode(parts[1]));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("JWT expired");
  return payload;
}

// ---- Token pair ----------------------------------------------------------

export interface TokenPair {
  access_token:  string;
  refresh_token: string;
  expires_in:    number;   // seconds
  token_type:    "Bearer";
}

export async function issueTokenPair(
  payload: Omit<JWTPayload, "iat" | "exp" | "type">,
  secret:  string,
): Promise<TokenPair> {
  const [access_token, refresh_token] = await Promise.all([
    signJWT({ ...payload, type: "access"  }, secret, 15 * 60),
    signJWT({ ...payload, type: "refresh" }, secret, 7 * 24 * 3600),
  ]);
  return { access_token, refresh_token, expires_in: 900, token_type: "Bearer" };
}
