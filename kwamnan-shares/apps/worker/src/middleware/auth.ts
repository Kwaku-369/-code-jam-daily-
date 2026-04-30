import { MiddlewareHandler } from 'hono'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Env } from '../index'

export type AuthUser = {
  id: string
  email: string
  role: string
  investor_id: string | null
}

// Untyped Supabase client — table types are not generated at build time;
// callers cast row shapes as needed.
export type AnySupabase = SupabaseClient<any, any, any>

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
    supabase: AnySupabase
  }
}

export const authMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  // Skip auth for public routes
  const path = new URL(c.req.url).pathname
  const publicPaths = ['/api/auth/', '/api/webhooks/', '/health', '/']
  if (publicPaths.some((p) => path.startsWith(p))) return next()

  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  const token = authHeader.slice(7)
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY) as AnySupabase

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return c.json({ error: 'Invalid or expired token' }, 401)

  // Fetch profile for role info
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, investor_id, status, failed_login_attempts, locked_until')
    .eq('id', user.id)
    .single()

  if (!profile) return c.json({ error: 'Profile not found' }, 401)
  if (profile.status === 'suspended') return c.json({ error: 'Account suspended. Contact support.' }, 403)
  if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
    return c.json({ error: 'Account temporarily locked due to failed attempts.' }, 423)
  }

  c.set('user', {
    id: user.id,
    email: user.email!,
    role: profile.role,
    investor_id: profile.investor_id,
  })
  c.set('supabase', supabase)

  return next()
}

export const requireRole = (...roles: string[]): MiddlewareHandler<{ Bindings: Env }> => {
  return async (c, next) => {
    const user = c.get('user')
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }
    return next()
  }
}
