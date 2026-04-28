import { MiddlewareHandler } from 'hono'
import { Env } from '../index'

const LIMITS: Record<string, { max: number; window: number }> = {
  '/api/auth/login': { max: 5, window: 300 },        // 5 per 5 min
  '/api/auth/register': { max: 3, window: 3600 },    // 3 per hour
  '/api/auth/verify-totp': { max: 5, window: 300 },
  '/api/payments/initiate': { max: 10, window: 3600 },
  default: { max: 100, window: 60 },                  // 100 per min
}

export const rateLimiter: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || 'unknown'
  const path = new URL(c.req.url).pathname
  const limit = LIMITS[path] || LIMITS.default
  const key = `rl:${ip}:${path}`

  try {
    const current = await c.env.RATE_LIMIT_KV.get(key)
    const count = current ? parseInt(current) : 0

    if (count >= limit.max) {
      return c.json({ error: 'Too many requests. Please wait before trying again.' }, 429)
    }

    await c.env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: limit.window })
  } catch {
    // KV failure — allow request through (fail open for availability)
  }

  return next()
}
