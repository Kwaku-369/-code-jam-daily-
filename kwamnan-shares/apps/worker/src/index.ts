import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { rateLimiter } from './middleware/rateLimit'
import { authMiddleware } from './middleware/auth'
import authRoutes from './routes/auth'
import shareRoutes from './routes/shares'
import paymentRoutes from './routes/payments'
import certificateRoutes from './routes/certificates'
import adminRoutes from './routes/admin'
import webhookRoutes from './routes/webhooks'
import notificationRoutes from './routes/notifications'

export type Env = {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  PAYSTACK_SECRET_KEY: string
  PAYSTACK_PUBLIC_KEY: string
  JWT_SECRET: string
  WEBHOOK_SECRET: string
  FRONTEND_URL: string
  RATE_LIMIT_KV: KVNamespace
  SESSION_KV: KVNamespace
  ENVIRONMENT: string
}

const app = new Hono<{ Bindings: Env }>()

// ── Security Headers ────────────────────────────────────────
app.use('*', secureHeaders())

// ── CORS ───────────────────────────────────────────────────
app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: [c.env.FRONTEND_URL, 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposeHeaders: ['X-Request-ID'],
    credentials: true,
    maxAge: 86400,
  })
  return corsMiddleware(c, next)
})

// ── Logging ─────────────────────────────────────────────────
app.use('*', logger())

// ── Rate Limiting ────────────────────────────────────────────
app.use('/api/*', rateLimiter)

// ── Health Check ─────────────────────────────────────────────
app.get('/', (c) => c.json({ status: 'ok', service: 'Kwamnan Shares API', version: '1.0.0' }))
app.get('/health', (c) => c.json({ status: 'healthy', timestamp: new Date().toISOString() }))

// ── Public Routes ─────────────────────────────────────────────
app.route('/api/auth', authRoutes)
app.route('/api/webhooks', webhookRoutes)

// ── Protected Routes ──────────────────────────────────────────
const protected_app = app.use('/api/*', authMiddleware)
app.route('/api/shares', shareRoutes)
app.route('/api/payments', paymentRoutes)
app.route('/api/certificates', certificateRoutes)
app.route('/api/notifications', notificationRoutes)

// ── Admin Routes (extra auth layer) ───────────────────────────
app.route('/api/admin', adminRoutes)

// ── 404 Handler ───────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Route not found' }, 404))

// ── Error Handler ─────────────────────────────────────────────
app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
