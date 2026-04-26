/**
 * Auth Routes
 * POST /auth/register
 * POST /auth/login
 * POST /auth/refresh
 * POST /auth/logout
 * POST /auth/2fa/enroll    — generate TOTP secret + QR URI
 * POST /auth/2fa/verify    — confirm 2FA code to enable
 * POST /auth/2fa/challenge — validate code during login (step 2)
 * DELETE /auth/2fa         — disable 2FA (admin only on others)
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  hashPassword, verifyPassword,
  signJWT, verifyJWT, issueTokenPair,
  generateTOTPSecret, verifyTOTP,
} from "@mining/auth";
import { ok, fail } from "@mining/shared";
import { query, queryOne, execute, newId, nowISO } from "../lib/db";
import { audit } from "../lib/audit";
import { authMiddleware } from "../middleware/auth";
import { rateLimit } from "../middleware/ratelimit";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();

// ── Register ──────────────────────────────────────────────────────────────────
router.post("/register",
  rateLimit({ maxTokens: 10, refillRate: 0.1, windowLabel: "register" }),
  zValidator("json", z.object({
    company_name: z.string().min(2).max(120).optional(),
    company_id:   z.string().uuid().optional(),
    email:        z.string().email(),
    display_name: z.string().min(2).max(80),
    password:     z.string().min(8).max(128),
    role:         z.enum(["admin","instructor","analyst","worker"]).default("worker"),
    employee_id:  z.string().optional(),
  })),
  async (c) => {
    const body = c.req.valid("json");
    const db   = c.env.DB;

    // Require either company_id (join existing) or company_name (create new)
    if (!body.company_id && !body.company_name) {
      return c.json(fail("Provide company_id or company_name"), 400);
    }

    let companyId = body.company_id;

    // Create company if registering as first admin
    if (!companyId && body.company_name) {
      if (body.role !== "admin" && body.role !== "instructor") {
        return c.json(fail("Only admin/instructor can create a new company"), 403);
      }
      companyId = newId();
      await execute(db,
        `INSERT INTO companies (id, name) VALUES (?, ?)`,
        [companyId, body.company_name],
      );
    }

    // Verify company exists
    const company = await queryOne(db, `SELECT id FROM companies WHERE id=? AND active=1`, [companyId!]);
    if (!company) return c.json(fail("Company not found"), 404);

    // Check email uniqueness
    const existing = await queryOne(db, `SELECT id FROM users WHERE email=?`, [body.email]);
    if (existing) return c.json(fail("Email already registered"), 409);

    const userId   = newId();
    const passHash = await hashPassword(body.password);
    const now      = nowISO();

    await execute(db,
      `INSERT INTO users (id, company_id, email, display_name, employee_id, role, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, companyId!, body.email, body.display_name, body.employee_id ?? null, body.role, passHash, now, now],
    );

    // Create wallet for user
    await execute(db,
      `INSERT INTO wallets (id, user_id, company_id, currency) VALUES (?, ?, ?, 'GHS')`,
      [newId(), userId, companyId!],
    );

    await audit(db, {
      company_id: companyId!, user_id: userId,
      action: "USER_REGISTER", resource: "users", resource_id: userId,
      ip_address: c.req.header("CF-Connecting-IP"),
    });

    return c.json(ok({ user_id: userId, company_id: companyId }), 201);
  },
);

// ── Login (step 1 — returns token or requires 2FA challenge) ──────────────────
router.post("/login",
  rateLimit({ maxTokens: 20, refillRate: 0.33, windowLabel: "login" }),
  zValidator("json", z.object({
    email:    z.string().email(),
    password: z.string(),
  })),
  async (c) => {
    const { email, password } = c.req.valid("json");
    const db = c.env.DB;

    const user = await queryOne<{
      id: string; company_id: string; email: string; display_name: string;
      role: string; password_hash: string; totp_enabled: number; active: number;
    }>(db, `SELECT id, company_id, email, display_name, role, password_hash, totp_enabled, active FROM users WHERE email=?`, [email]);

    if (!user || !user.active) return c.json(fail("Invalid credentials"), 401);

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      await audit(db, { company_id: user.company_id, user_id: user.id, action: "LOGIN_FAILED", resource: "auth", ip_address: c.req.header("CF-Connecting-IP") });
      return c.json(fail("Invalid credentials"), 401);
    }

    // If 2FA is enabled, issue a short-lived challenge token instead
    if (user.totp_enabled) {
      const challengeToken = await signJWT({
        sub: user.id, email: user.email, role: user.role as any,
        company_id: user.company_id, type: "access",
      }, c.env.JWT_SECRET, 300); // 5 min challenge window

      return c.json(ok({ requires_2fa: true, challenge_token: challengeToken }));
    }

    // Issue full token pair
    const tokens = await issueTokenPair({
      sub: user.id, email: user.email,
      role: user.role as any, company_id: user.company_id,
    }, c.env.JWT_SECRET);

    // Store refresh token hash
    await storeRefreshToken(db, user.id, tokens.refresh_token);
    await execute(db, `UPDATE users SET last_login_at=? WHERE id=?`, [nowISO(), user.id]);
    await audit(db, { company_id: user.company_id, user_id: user.id, action: "LOGIN_SUCCESS", resource: "auth", ip_address: c.req.header("CF-Connecting-IP") });

    return c.json(ok(tokens));
  },
);

// ── 2FA Challenge (step 2 of login) ──────────────────────────────────────────
router.post("/2fa/challenge",
  rateLimit({ maxTokens: 10, refillRate: 0.2, windowLabel: "2fa-challenge" }),
  zValidator("json", z.object({
    challenge_token: z.string(),
    code:            z.string().length(6),
  })),
  async (c) => {
    const { challenge_token, code } = c.req.valid("json");
    const db = c.env.DB;

    let payload: Awaited<ReturnType<typeof verifyJWT>>;
    try {
      payload = await verifyJWT(challenge_token, c.env.JWT_SECRET);
    } catch {
      return c.json(fail("Invalid or expired challenge token"), 401);
    }

    const user = await queryOne<{ totp_secret: string; company_id: string; role: string; email: string; active: number }>(
      db, `SELECT totp_secret, company_id, role, email, active FROM users WHERE id=?`, [payload.sub],
    );
    if (!user || !user.active || !user.totp_secret) {
      return c.json(fail("Invalid session"), 401);
    }

    if (!verifyTOTP(code, user.totp_secret)) {
      await audit(db, { company_id: user.company_id, user_id: payload.sub, action: "2FA_FAILED", resource: "auth", ip_address: c.req.header("CF-Connecting-IP") });
      return c.json(fail("Invalid 2FA code"), 401);
    }

    const tokens = await issueTokenPair({
      sub: payload.sub, email: user.email,
      role: user.role as any, company_id: user.company_id,
    }, c.env.JWT_SECRET);

    await storeRefreshToken(db, payload.sub, tokens.refresh_token);
    await execute(db, `UPDATE users SET last_login_at=? WHERE id=?`, [nowISO(), payload.sub]);
    await audit(db, { company_id: user.company_id, user_id: payload.sub, action: "LOGIN_SUCCESS_2FA", resource: "auth", ip_address: c.req.header("CF-Connecting-IP") });

    return c.json(ok(tokens));
  },
);

// ── Refresh ───────────────────────────────────────────────────────────────────
router.post("/refresh",
  zValidator("json", z.object({ refresh_token: z.string() })),
  async (c) => {
    const { refresh_token } = c.req.valid("json");
    const db = c.env.DB;

    let payload: Awaited<ReturnType<typeof verifyJWT>>;
    try {
      payload = await verifyJWT(refresh_token, c.env.JWT_SECRET);
    } catch {
      return c.json(fail("Invalid refresh token"), 401);
    }
    if (payload.type !== "refresh") return c.json(fail("Invalid token type"), 401);

    // Verify token hash is in DB and not revoked (rotation)
    const tokenHash = await hashToken(refresh_token);
    const stored = await queryOne<{ id: string; revoked: number }>(
      db, `SELECT id, revoked FROM refresh_tokens WHERE token_hash=? AND user_id=?`,
      [tokenHash, payload.sub],
    );
    if (!stored || stored.revoked) return c.json(fail("Token revoked"), 401);

    // Rotate: revoke old, issue new
    await execute(db, `UPDATE refresh_tokens SET revoked=1 WHERE id=?`, [stored.id]);

    const user = await queryOne<{ email: string; role: string; company_id: string; active: number }>(
      db, `SELECT email, role, company_id, active FROM users WHERE id=?`, [payload.sub],
    );
    if (!user || !user.active) return c.json(fail("User not found"), 401);

    const tokens = await issueTokenPair({
      sub: payload.sub, email: user.email,
      role: user.role as any, company_id: user.company_id,
    }, c.env.JWT_SECRET);

    await storeRefreshToken(db, payload.sub, tokens.refresh_token);
    return c.json(ok(tokens));
  },
);

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/logout", authMiddleware,
  zValidator("json", z.object({ refresh_token: z.string().optional() })),
  async (c) => {
    const { refresh_token } = c.req.valid("json");
    const db = c.env.DB;
    if (refresh_token) {
      const hash = await hashToken(refresh_token);
      await execute(db, `UPDATE refresh_tokens SET revoked=1 WHERE token_hash=?`, [hash]);
    }
    return c.json(ok({ message: "Logged out" }));
  },
);

// ── 2FA Enroll ────────────────────────────────────────────────────────────────
router.post("/2fa/enroll", authMiddleware, async (c) => {
  const user = c.get("user");
  const db   = c.env.DB;

  const { secret, uri } = generateTOTPSecret(user.email, c.env.TOTP_ISSUER);

  // Store secret but don't enable yet (require confirmation)
  await execute(db,
    `UPDATE users SET totp_secret=?, totp_enabled=0, updated_at=? WHERE id=?`,
    [secret, nowISO(), user.sub],
  );

  return c.json(ok({ secret, uri, instructions: "Scan the QR code with Google Authenticator, then call /auth/2fa/verify to confirm." }));
});

// ── 2FA Verify (confirm enrollment) ──────────────────────────────────────────
router.post("/2fa/verify", authMiddleware,
  zValidator("json", z.object({ code: z.string().length(6) })),
  async (c) => {
    const { code } = c.req.valid("json");
    const user     = c.get("user");
    const db       = c.env.DB;

    const row = await queryOne<{ totp_secret: string }>(
      db, `SELECT totp_secret FROM users WHERE id=?`, [user.sub],
    );
    if (!row?.totp_secret) return c.json(fail("2FA not enrolled"), 400);

    if (!verifyTOTP(code, row.totp_secret)) {
      return c.json(fail("Invalid code — try again"), 401);
    }

    await execute(db, `UPDATE users SET totp_enabled=1, updated_at=? WHERE id=?`, [nowISO(), user.sub]);
    await audit(db, { company_id: user.company_id, user_id: user.sub, action: "2FA_ENABLED", resource: "auth" });

    return c.json(ok({ message: "2FA enabled successfully" }));
  },
);

// ── 2FA Disable ───────────────────────────────────────────────────────────────
router.delete("/2fa", authMiddleware,
  zValidator("json", z.object({ code: z.string().length(6) })),
  async (c) => {
    const { code } = c.req.valid("json");
    const user     = c.get("user");
    const db       = c.env.DB;

    const row = await queryOne<{ totp_secret: string; totp_enabled: number }>(
      db, `SELECT totp_secret, totp_enabled FROM users WHERE id=?`, [user.sub],
    );
    if (!row?.totp_enabled) return c.json(fail("2FA not enabled"), 400);
    if (!verifyTOTP(code, row.totp_secret!)) return c.json(fail("Invalid code"), 401);

    await execute(db,
      `UPDATE users SET totp_secret=NULL, totp_enabled=0, updated_at=? WHERE id=?`,
      [nowISO(), user.sub],
    );
    await audit(db, { company_id: user.company_id, user_id: user.sub, action: "2FA_DISABLED", resource: "auth" });

    return c.json(ok({ message: "2FA disabled" }));
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function storeRefreshToken(db: D1Database, userId: string, token: string): Promise<void> {
  const hash    = await hashToken(token);
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  await execute(db,
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
    [newId(), userId, hash, expires],
  );
}

async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export default router;
