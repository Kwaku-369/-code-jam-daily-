/**
 * Mining Platform API — Cloudflare Worker Entry Point
 * ====================================================
 * Framework: Hono v4
 * Patterns applied:
 *   - RBAC middleware (role hierarchy)
 *   - Rate limiting (token bucket via KV)
 *   - Circuit Breaker (payment gateways, KV-backed)
 *   - Saga (payment flow orchestration)
 *   - Outbox (notifications via D1 + Queue)
 *   - CQRS (wallet balance read vs. write)
 *   - Audit log (append-only, every mutation)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { handleQueue } from "./queue/handler";
import authRouter          from "./routes/auth";
import usersRouter         from "./routes/users";
import sitesRouter         from "./routes/sites";
import jobsRouter          from "./routes/jobs";
import incidentsRouter     from "./routes/incidents";
import reportsRouter       from "./routes/reports";
import paymentsRouter      from "./routes/payments";
import notificationsRouter from "./routes/notifications";
import type { AppEnv } from "./types";

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono<AppEnv>();

// ── Global Middleware ─────────────────────────────────────────────────────────

app.use("*", cors({
  origin: ["https://app.miningplatform.app", "http://localhost:5173"],
  allowMethods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowHeaders: ["Authorization","Content-Type","X-Request-ID"],
  exposeHeaders: ["X-RateLimit-Remaining","X-RateLimit-Limit"],
  maxAge: 86400,
  credentials: true,
}));

app.use("*", secureHeaders());

app.use("*", async (c, next) => {
  const requestId = c.req.header("X-Request-ID") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-ID", requestId);
  await next();
});

// ── Health Check (no auth) ────────────────────────────────────────────────────

app.get("/health", async (c) => {
  let dbOk = false;
  try {
    await c.env.DB.prepare("SELECT 1").first();
    dbOk = true;
  } catch {}
  const status = dbOk ? 200 : 503;
  return c.json({
    ok: dbOk,
    service: "mining-platform-api",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    db: dbOk ? "ok" : "error",
  }, status);
});

// ── API Routes ────────────────────────────────────────────────────────────────

const api = new Hono<AppEnv>();

api.route("/auth",          authRouter);
api.route("/users",         usersRouter);
api.route("/sites",         sitesRouter);
api.route("/jobs",          jobsRouter);
api.route("/incidents",     incidentsRouter);
api.route("/reports",       reportsRouter);
api.route("/payments",      paymentsRouter);
api.route("/notifications", notificationsRouter);

app.route("/api/v1", api);

// ── 404 / Error Handlers ──────────────────────────────────────────────────────

app.notFound((c) =>
  c.json({ ok: false, error: "Not found", path: new URL(c.req.url).pathname }, 404),
);

app.onError((err, c) => {
  console.error("[error]", err.message, err.stack);
  const status = (err as any).status ?? 500;
  return c.json({ ok: false, error: err.message ?? "Internal server error" }, status);
});

// ─── Cloudflare Worker Export ─────────────────────────────────────────────────

export default {
  fetch: app.fetch,
  queue: handleQueue,
} satisfies ExportedHandler<import("./types").Env>;
