import { Hono } from 'hono'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { Env } from '../index'
import { requireRole } from '../middleware/auth'
import { calculateCharges } from '../services/paystack'

const shares = new Hono<{ Bindings: Env }>()

// GET /api/shares/classes — List available share classes
shares.get('/classes', async (c) => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await supabase
    .from('share_classes')
    .select('*')
    .eq('is_available', true)
    .order('code')
  if (error) return c.json({ error: 'Failed to fetch share classes' }, 500)
  return c.json({ data })
})

// GET /api/shares/portfolio — Current user's holdings
shares.get('/portfolio', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')

  const { data: holdings, error } = await supabase
    .from('share_holdings')
    .select(`
      *,
      share_classes (code, name, current_price, dividend_rate, dividend_frequency)
    `)
    .eq('investor_id', user.id)
    .eq('status', 'active')

  if (error) return c.json({ error: 'Failed to fetch portfolio' }, 500)

  // Enrich with current value
  const enriched = holdings?.map((h: Record<string, unknown>) => ({
    ...h,
    current_value: h.total_units as number * ((h.share_classes as Record<string, unknown>)?.current_price as number || 0),
    unrealized_pnl: (h.total_units as number * ((h.share_classes as Record<string, unknown>)?.current_price as number || 0)) - (h.total_amount_invested as number),
  }))

  return c.json({ data: enriched })
})

// GET /api/shares/transactions — Transaction history
shares.get('/transactions', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')
  const page = parseInt(c.req.query('page') || '1')
  const limit = 20

  const { data, error, count } = await supabase
    .from('share_transactions')
    .select('*, share_classes(code, name)', { count: 'exact' })
    .eq('investor_id', user.id)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (error) return c.json({ error: 'Failed to fetch transactions' }, 500)
  return c.json({ data, total: count, page, limit })
})

const purchaseSchema = z.object({
  share_class_id: z.string().uuid(),
  units: z.number().int().min(200, 'Minimum purchase is 200 shares (GHS 200)'),
  payment_channel: z.enum(['mtn_momo', 'vodafone_cash', 'airteltigo', 'visa', 'mastercard']),
  mobile_number: z.string().optional(),
  network_provider: z.string().optional(),
})

// POST /api/shares/purchase — Initiate share purchase
shares.post('/purchase', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')
  const body = await c.req.json()

  const parse = purchaseSchema.safeParse(body)
  if (!parse.success) {
    return c.json({ error: parse.error.errors[0].message, details: parse.error.flatten() }, 400)
  }

  const { share_class_id, units, payment_channel, mobile_number } = parse.data

  // Verify share class exists and has availability
  const { data: shareClass } = await supabase
    .from('share_classes')
    .select('*')
    .eq('id', share_class_id)
    .eq('is_available', true)
    .single()

  if (!shareClass) return c.json({ error: 'Share class not found or unavailable' }, 404)

  const remainingShares = shareClass.total_shares_authorized - shareClass.total_shares_issued
  if (units > remainingShares) {
    return c.json({ error: `Only ${remainingShares.toLocaleString()} units available` }, 400)
  }

  // Enforce minimum 200 units
  if (units < 200) {
    return c.json({ error: 'Minimum purchase is 200 units (GHS 200). This helps grow your wealth meaningfully.' }, 400)
  }

  const amountGHS = units * shareClass.current_price
  const charges = calculateCharges(amountGHS)

  // Get investor profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, phone, kyc_verified, status')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'pending') {
    return c.json({ error: 'Please complete your KYC verification before purchasing shares.' }, 403)
  }

  // Create pending transaction
  const { data: txn, error: txnError } = await supabase
    .from('share_transactions')
    .insert({
      investor_id: user.id,
      share_class_id,
      units,
      price_per_unit: shareClass.current_price,
      gross_amount: charges.grossAmount,
      charges: charges.totalCharges,
      net_amount: charges.netAmount,
      processing_fee: charges.processingFee,
      platform_fee: charges.platformFee,
      vat: charges.vat,
      payment_channel,
      status: 'pending_approval',
      ip_address: c.req.header('CF-Connecting-IP'),
    })
    .select()
    .single()

  if (txnError || !txn) return c.json({ error: 'Failed to create transaction' }, 500)

  return c.json({
    transaction_id: txn.id,
    reference: txn.reference,
    amount: charges.netAmount,
    amount_pesewas: charges.amountInPesewas,
    breakdown: {
      shares_cost: `GHS ${charges.grossAmount.toFixed(2)}`,
      processing_fee: `GHS ${charges.processingFee.toFixed(2)}`,
      platform_fee: `GHS ${charges.platformFee.toFixed(2)}`,
      vat: `GHS ${charges.vat.toFixed(2)}`,
      total: `GHS ${charges.netAmount.toFixed(2)}`,
    },
    investor_email: profile.email,
    investor_phone: profile.phone,
    share_class: shareClass.name,
    units,
  })
})

// GET /api/shares/certificate/:holdingId — Download certificate
shares.get('/certificate/:holdingId', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')
  const holdingId = c.req.param('holdingId')

  const { data: holding } = await supabase
    .from('share_holdings')
    .select('*, share_classes(name, face_value)')
    .eq('id', holdingId)
    .eq('investor_id', user.id)
    .single()

  if (!holding) return c.json({ error: 'Certificate not found' }, 404)
  if (!holding.certificate_url) return c.json({ error: 'Certificate not yet generated' }, 404)

  // Generate signed URL (1 hour)
  const { data: signedUrl } = await supabase.storage
    .from('certificates')
    .createSignedUrl(holding.certificate_url, 3600)

  return c.json({ url: signedUrl?.signedUrl })
})

// GET /api/shares/spreadsheet — Export holdings as CSV
shares.get('/spreadsheet', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')

  const { data: holdings } = await supabase
    .from('share_holdings')
    .select('*, share_classes(code, name, current_price, dividend_rate)')
    .eq('investor_id', user.id)

  const { data: transactions } = await supabase
    .from('share_transactions')
    .select('*, share_classes(code, name)')
    .eq('investor_id', user.id)
    .order('created_at', { ascending: false })

  const csvRows = [
    'Transaction Ref,Date,Share Class,Units,Price/Unit,Amount,Status,Channel',
    ...(transactions || []).map((t: Record<string, unknown>) =>
      [
        t.reference,
        new Date(t.created_at as string).toLocaleDateString(),
        (t.share_classes as Record<string, unknown>)?.name,
        t.units,
        `GHS ${(t.price_per_unit as number).toFixed(2)}`,
        `GHS ${(t.net_amount as number).toFixed(2)}`,
        t.status,
        t.payment_channel,
      ].join(',')
    ),
  ].join('\n')

  c.header('Content-Type', 'text/csv')
  c.header('Content-Disposition', 'attachment; filename="kwamnan-shares-statement.csv"')
  return c.body(csvRows)
})

export default shares
