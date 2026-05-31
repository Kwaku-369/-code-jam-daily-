/**
 * Rate Limiter — Token Bucket via Cloudflare KV
 * Applies: Token Bucket pattern from enterprise infra patterns
 */

import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

interface Bucket {
  tokens: number;
  lastRefill: number;  // epoch ms
}

export function rateLimit(opts: {
  maxTokens?: number;
  refillRate?: number;  // tokens per second
  windowLabel?: string;
}) {
  const { maxTokens = 60, refillRate = 1, windowLabel = "global" } = opts;

  return createMiddleware<AppEnv>(async (c, next) => {
    const ip  = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? "unknown";
    const key = `rl:${windowLabel}:${ip}`;
    const now = Date.now();

    const raw    = await c.env.RATE_LIMIT.get(key);
    const bucket: Bucket = raw ? JSON.parse(raw) : { tokens: maxTokens, lastRefill: now };

    // Refill tokens based on elapsed time
    const elapsed   = (now - bucket.lastRefill) / 1000;
    bucket.tokens   = Math.min(maxTokens, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      return c.json({ ok: false, error: "Too many requests" }, 429);
    }

    bucket.tokens -= 1;
    // TTL = time to refill to full from empty = maxTokens / refillRate seconds
    await c.env.RATE_LIMIT.put(key, JSON.stringify(bucket), {
      expirationTtl: Math.ceil(maxTokens / refillRate) + 10,
    });

    c.header("X-RateLimit-Remaining", String(Math.floor(bucket.tokens)));
    c.header("X-RateLimit-Limit",     String(maxTokens));
    await next();
  });
}
