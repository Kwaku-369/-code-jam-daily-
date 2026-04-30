import { Hono } from 'hono'
import { createClient } from '@supabase/supabase-js'
import { Env } from '../index'
import { requireRole, AnySupabase } from '../middleware/auth'
import { generateShareCertificate } from '../services/certificates'

const admin = new Hono<{ Bindings: Env }>()

// All admin routes require bank_staff or admin role + TOTP verified session
admin.use('*', requireRole('admin', 'bank_staff'))

// GET /api/admin/dashboard — Stats overview
admin.get('/dashboard', async (c) => {
  const supabase = c.get('supabase')

  const [investors, pendingApprovals, totalInvested, recentTxns, securityAlerts, duplicates] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact' }).eq('role', 'investor'),
    supabase.from('approval_queue').select('id', { count: 'exact' }).eq('status', 'pending'),
    supabase.from('profiles').select('total_invested').eq('role', 'investor'),
    supabase.from('share_transactions')
      .select('*, profiles(full_name, investor_id), share_classes(name)')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.from('security_events').select('id', { count: 'exact' }).eq('resolved', false),
    supabase.from('duplicate_flags').select('id', { count: 'exact' }).eq('status', 'pending'),
  ])

  const totalInvestedSum = (totalInvested.data || []).reduce(
    (sum: number, p: Record<string, unknown>) => sum + ((p.total_invested as number) || 0), 0
  )

  return c.json({
    stats: {
      total_investors: investors.count || 0,
      pending_approvals: pendingApprovals.count || 0,
      total_invested_ghs: totalInvestedSum,
      security_alerts: securityAlerts.count || 0,
      duplicate_flags: duplicates.count || 0,
    },
    recent_transactions: recentTxns.data || [],
  })
})

// GET /api/admin/approval-queue — Pending dual-control approvals
admin.get('/approval-queue', async (c) => {
  const supabase = c.get('supabase')
  const { data } = await supabase
    .from('approval_queue')
    .select(`
      *,
      share_transactions!resource_id (
        *, profiles(full_name, investor_id, email, phone), share_classes(name, code)
      )
    `)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })

  return c.json({ data })
})

// POST /api/admin/approve/:queueId — First or second approval (TOTP required)
admin.post('/approve/:queueId', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')
  const queueId = c.req.param('queueId')
  const { totp_code, notes } = await c.req.json()

  if (!totp_code) return c.json({ error: 'TOTP code required for approval' }, 400)

  // Verify TOTP via Supabase MFA
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const totpFactor = factors?.totp?.[0]
  if (!totpFactor) return c.json({ error: 'Google Authenticator not set up. Contact admin.' }, 403)

  const { data: challenge } = await supabase.auth.mfa.challenge({ factorId: totpFactor.id })
  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: totpFactor.id,
    challengeId: challenge!.id,
    code: totp_code,
  })

  if (verifyError) return c.json({ error: 'Invalid authenticator code' }, 403)

  const { data: queueItem } = await supabase
    .from('approval_queue')
    .select('*')
    .eq('id', queueId)
    .eq('status', 'pending')
    .single()

  if (!queueItem) return c.json({ error: 'Approval item not found or already processed' }, 404)

  // Prevent self-approval on second step
  if (queueItem.first_approver_id === user.id && queueItem.first_approved_at) {
    return c.json({ error: 'You already provided first approval. A different officer must provide second approval.' }, 403)
  }

  const now = new Date().toISOString()

  if (!queueItem.first_approved_at) {
    // First approval
    await supabase.from('approval_queue').update({
      first_approver_id: user.id,
      first_approved_at: now,
      first_approval_notes: notes,
      first_totp_verified: true,
    }).eq('id', queueId)

    await supabase.from('audit_logs').insert({
      user_id: user.id,
      action: 'FIRST_APPROVAL',
      resource_type: queueItem.resource_type,
      resource_id: queueItem.resource_id,
      ip_address: c.req.header('CF-Connecting-IP'),
    })

    return c.json({ success: true, message: 'First approval recorded. Awaiting second approval.' })
  } else {
    // Second approval — finalize
    await supabase.from('approval_queue').update({
      second_approver_id: user.id,
      second_approved_at: now,
      second_approval_notes: notes,
      second_totp_verified: true,
      status: 'approved',
      completed_at: now,
    }).eq('id', queueId)

    // Activate the share transaction
    if (queueItem.resource_type === 'share_transaction') {
      const { data: txn } = await supabase
        .from('share_transactions')
        .update({
          status: 'active',
          approval_status: 'approved',
          approved_by: queueItem.first_approver_id,
          approved_at: queueItem.first_approved_at,
          second_approver_id: user.id,
          second_approved_at: now,
        })
        .eq('id', queueItem.resource_id)
        .select('*, profiles(full_name, investor_id, email), share_classes(name, face_value)')
        .single()

      if (txn) {
        // Generate certificate
        await generateAndStoreCertificate(supabase, c.env, txn)

        // Notify investor
        await supabase.from('notifications').insert({
          user_id: txn.investor_id,
          type: 'share_purchased',
          title: '🎉 Shares Confirmed!',
          message: `Congratulations! Your purchase of ${txn.units.toLocaleString()} units of ${(txn.share_classes as Record<string, unknown>)?.name} has been approved. Your certificate is ready.`,
          data: { transaction_id: txn.id },
          sent_email: false,
        })
      }
    }

    await supabase.from('audit_logs').insert({
      user_id: user.id,
      action: 'SECOND_APPROVAL_FINALIZED',
      resource_type: queueItem.resource_type,
      resource_id: queueItem.resource_id,
      ip_address: c.req.header('CF-Connecting-IP'),
    })

    return c.json({ success: true, message: 'Transaction fully approved and shares activated.' })
  }
})

// POST /api/admin/reject/:queueId
admin.post('/reject/:queueId', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')
  const queueId = c.req.param('queueId')
  const { totp_code, reason } = await c.req.json()

  if (!totp_code || !reason) return c.json({ error: 'TOTP code and reason required' }, 400)

  // TOTP verification (same as approve)
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const totpFactor = factors?.totp?.[0]
  if (!totpFactor) return c.json({ error: 'MFA not configured' }, 403)
  const { data: challenge } = await supabase.auth.mfa.challenge({ factorId: totpFactor.id })
  const { error: ve } = await supabase.auth.mfa.verify({
    factorId: totpFactor.id, challengeId: challenge!.id, code: totp_code,
  })
  if (ve) return c.json({ error: 'Invalid authenticator code' }, 403)

  const { data: queueItem } = await supabase
    .from('approval_queue').select('*').eq('id', queueId).single()
  if (!queueItem) return c.json({ error: 'Not found' }, 404)

  await supabase.from('approval_queue').update({
    status: 'rejected', final_notes: reason, completed_at: new Date().toISOString(),
  }).eq('id', queueId)

  await supabase.from('share_transactions').update({
    status: 'cancelled', approval_status: 'rejected', approval_notes: reason,
  }).eq('id', queueItem.resource_id)

  await supabase.from('notifications').insert({
    user_id: queueItem.data?.investor_id,
    type: 'admin_approval',
    title: 'Transaction Rejected',
    message: `Your share purchase was not approved. Reason: ${reason}. Please contact the bank for clarification.`,
  })

  return c.json({ success: true, message: 'Transaction rejected.' })
})

// GET /api/admin/investors — Investor list with search
admin.get('/investors', async (c) => {
  const supabase = c.get('supabase')
  const search = c.req.query('search')
  const page = parseInt(c.req.query('page') || '1')

  let query = supabase
    .from('profiles')
    .select('id, investor_id, full_name, email, phone, status, kyc_verified, total_shares, total_invested, created_at', { count: 'exact' })
    .eq('role', 'investor')
    .order('created_at', { ascending: false })
    .range((page - 1) * 20, page * 20 - 1)

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,investor_id.ilike.%${search}%,phone.ilike.%${search}%,id_number.ilike.%${search}%`)
  }

  const { data, count } = await query
  return c.json({ data, total: count, page })
})

// GET /api/admin/duplicates — Flagged duplicate profiles
admin.get('/duplicates', async (c) => {
  const supabase = c.get('supabase')
  const { data } = await supabase
    .from('duplicate_flags')
    .select(`
      *,
      flagged: flagged_profile_id (id, full_name, investor_id, phone, email, id_number),
      matching: matching_profile_id (id, full_name, investor_id, phone, email, id_number)
    `)
    .eq('status', 'pending')
    .order('match_confidence', { ascending: false })

  return c.json({ data })
})

// GET /api/admin/security-events
admin.get('/security-events', async (c) => {
  const supabase = c.get('supabase')
  const { data } = await supabase
    .from('security_events')
    .select('*, profiles(full_name, investor_id)')
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(50)

  return c.json({ data })
})

// POST /api/admin/generate-certificate/:holdingId
admin.post('/generate-certificate/:holdingId', async (c) => {
  const supabase = c.get('supabase')
  const holdingId = c.req.param('holdingId')

  const { data: holding } = await supabase
    .from('share_holdings')
    .select('*, profiles(full_name, investor_id, id_number), share_classes(name, face_value)')
    .eq('id', holdingId)
    .single()

  if (!holding) return c.json({ error: 'Holding not found' }, 404)

  await generateAndStoreCertificate(supabase, c.env, holding)
  return c.json({ success: true, message: 'Certificate generated.' })
})

// Internal: Generate and store certificate PDF
async function generateAndStoreCertificate(
  supabase: AnySupabase,
  env: Env,
  txnOrHolding: Record<string, any>
) {
  try {
    const investor = txnOrHolding.profiles as Record<string, unknown>
    const shareClass = txnOrHolding.share_classes as Record<string, unknown>

    const { data: holding } = await supabase
      .from('share_holdings')
      .select('*')
      .eq('investor_id', txnOrHolding.investor_id)
      .eq('share_class_id', txnOrHolding.share_class_id)
      .single()

    if (!holding) return

    const pdfBytes = await generateShareCertificate({
      certificateNumber: holding.certificate_number,
      investorId: investor?.investor_id as string || '',
      investorName: investor?.full_name as string || '',
      idNumber: investor?.id_number as string || 'N/A',
      shareClass: shareClass?.name as string || '',
      totalUnits: holding.total_units,
      totalInvested: holding.total_amount_invested,
      faceValuePerUnit: shareClass?.face_value as number || 1,
      issueDate: new Date().toISOString(),
      issuedBy: 'General Manager',
      registrarName: 'Share Registrar',
    })

    const filePath = `${txnOrHolding.investor_id}/${holding.certificate_number}.pdf`

    await supabase.storage.from('certificates').upload(filePath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    })

    await supabase.from('share_holdings').update({
      certificate_url: filePath,
      certificate_issued_at: new Date().toISOString(),
    }).eq('id', holding.id)
  } catch (err) {
    console.error('Certificate generation failed:', err)
  }
}

export default admin
