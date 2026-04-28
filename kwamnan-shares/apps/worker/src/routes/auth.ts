import { Hono } from 'hono'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { Env } from '../index'

const auth = new Hono<{ Bindings: Env }>()

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(2).max(255),
  phone: z.string().regex(/^\+233[0-9]{9}$/),
  date_of_birth: z.string().optional(),
  id_type: z.enum(['ghana_card', 'passport', 'voters_id', 'drivers_license']).optional(),
  id_number: z.string().optional(),
  address: z.string().optional(),
  region: z.string().optional(),
  next_of_kin_name: z.string().optional(),
  next_of_kin_phone: z.string().optional(),
  next_of_kin_relation: z.string().optional(),
})

// POST /api/auth/register
auth.post('/register', async (c) => {
  const body = await c.req.json()
  const parse = registerSchema.safeParse(body)
  if (!parse.success) {
    return c.json({ error: 'Invalid input', details: parse.error.flatten() }, 400)
  }

  const { email, password, full_name, phone, ...profileData } = parse.data
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY)

  // Check phone uniqueness
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .or(`phone.eq.${phone},email.eq.${email}`)
    .single()

  if (existing) {
    return c.json({ error: 'An account with this email or phone already exists.' }, 409)
  }

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
  })

  if (authError || !authData.user) {
    return c.json({ error: authError?.message || 'Registration failed' }, 400)
  }

  const { error: profileError } = await supabase.from('profiles').insert({
    id: authData.user.id,
    email,
    phone,
    full_name,
    ...profileData,
    status: 'pending',
  })

  if (profileError) {
    await supabase.auth.admin.deleteUser(authData.user.id)
    return c.json({ error: 'Failed to create profile' }, 500)
  }

  // Log audit
  await supabase.from('audit_logs').insert({
    user_id: authData.user.id,
    action: 'REGISTER',
    resource_type: 'profile',
    resource_id: authData.user.id,
    ip_address: c.req.header('CF-Connecting-IP'),
    user_agent: c.req.header('User-Agent'),
  })

  return c.json({ success: true, message: 'Registration successful. Please verify your email.' }, 201)
})

// POST /api/auth/login
auth.post('/login', async (c) => {
  const { email, password } = await c.req.json()
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    // Track failed logins
    await supabase.rpc('increment_failed_logins', { user_email: email })
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, status, totp_enabled, sms_2fa_enabled, investor_id, full_name, locked_until')
    .eq('id', data.user.id)
    .single()

  if (profile?.locked_until && new Date(profile.locked_until) > new Date()) {
    return c.json({ error: 'Account locked. Try again later or contact support.' }, 423)
  }

  if (profile?.status === 'suspended') {
    return c.json({ error: 'Account suspended. Contact Kwamnan Rural Bank.' }, 403)
  }

  // Reset failed attempts on success
  await supabase.from('profiles').update({ failed_login_attempts: 0, last_login_at: new Date().toISOString(), last_login_ip: c.req.header('CF-Connecting-IP') }).eq('id', data.user.id)

  await supabase.from('audit_logs').insert({
    user_id: data.user.id,
    action: 'LOGIN',
    resource_type: 'auth',
    ip_address: c.req.header('CF-Connecting-IP'),
    user_agent: c.req.header('User-Agent'),
  })

  return c.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: {
      id: data.user.id,
      email: data.user.email,
      full_name: profile?.full_name,
      role: profile?.role,
      investor_id: profile?.investor_id,
      totp_enabled: profile?.totp_enabled,
      sms_2fa_enabled: profile?.sms_2fa_enabled,
      status: profile?.status,
    },
    requires_2fa: profile?.totp_enabled || profile?.sms_2fa_enabled,
  })
})

// POST /api/auth/enroll-totp — Get QR code for Google Authenticator
auth.post('/enroll-totp', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  const token = authHeader.slice(7)

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY)

  // Use user's token for MFA enrollment (not service key — required by Supabase MFA)
  const userSupabase = createClient(c.env.SUPABASE_URL, token.startsWith('eyJ') ? c.env.SUPABASE_SERVICE_ROLE_KEY : token)
  const { data, error } = await userSupabase.auth.mfa.enroll({ factorType: 'totp' })

  if (error) return c.json({ error: error.message }, 400)

  return c.json({
    factor_id: data.id,
    qr_code: data.totp?.qr_code,
    secret: data.totp?.secret,
    uri: data.totp?.uri,
  })
})

// POST /api/auth/verify-totp
auth.post('/verify-totp', async (c) => {
  const { factor_id, challenge_id, code } = await c.req.json()
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const { data, error } = await supabase.auth.mfa.verify({ factorId: factor_id, challengeId: challenge_id, code })
  if (error) return c.json({ error: 'Invalid code. Try again.' }, 400)

  // Mark TOTP as enabled
  await supabase.from('profiles').update({ totp_enabled: true }).eq('id', user.id)

  return c.json({ success: true, session: data.session })
})

// POST /api/auth/challenge-totp — Create TOTP challenge (step 2 of login)
auth.post('/challenge-totp', async (c) => {
  const { factor_id } = await c.req.json()
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await supabase.auth.mfa.challenge({ factorId: factor_id })
  if (error) return c.json({ error: error.message }, 400)

  return c.json({ challenge_id: data.id })
})

// POST /api/auth/refresh
auth.post('/refresh', async (c) => {
  const { refresh_token } = await c.req.json()
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await supabase.auth.refreshSession({ refresh_token })
  if (error) return c.json({ error: 'Session expired. Please login again.' }, 401)
  return c.json({ access_token: data.session!.access_token, refresh_token: data.session!.refresh_token })
})

export default auth
