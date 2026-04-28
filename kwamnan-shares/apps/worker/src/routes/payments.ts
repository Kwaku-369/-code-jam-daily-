import { Hono } from 'hono'
import { createClient } from '@supabase/supabase-js'
import { Env } from '../index'
import { PaystackService, generatePaymentReference } from '../services/paystack'

const payments = new Hono<{ Bindings: Env }>()

// POST /api/payments/initiate — Start payment for a transaction
payments.post('/initiate', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')
  const { transaction_id, mobile_number, provider } = await c.req.json()

  if (!transaction_id) return c.json({ error: 'Transaction ID required' }, 400)

  // Verify transaction belongs to user and is pending
  const { data: txn } = await supabase
    .from('share_transactions')
    .select('*, share_classes(name)')
    .eq('id', transaction_id)
    .eq('investor_id', user.id)
    .in('status', ['pending_approval'])
    .single()

  if (!txn) return c.json({ error: 'Transaction not found or already processed' }, 404)

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, phone, full_name')
    .eq('id', user.id)
    .single()

  const paystack = new PaystackService(c.env.PAYSTACK_SECRET_KEY)
  const paymentRef = generatePaymentReference()
  const amountPesewas = Math.round(txn.net_amount * 100)

  let paystackResponse: Record<string, unknown>

  // Mobile Money path
  if (['mtn_momo', 'vodafone_cash', 'airteltigo'].includes(txn.payment_channel)) {
    const providerMap: Record<string, string> = {
      mtn_momo: 'mtn',
      vodafone_cash: 'vod',
      airteltigo: 'atl',
    }

    const phone = mobile_number || profile?.phone
    if (!phone) return c.json({ error: 'Mobile number required for mobile money' }, 400)

    paystackResponse = await paystack.chargeMoMo({
      email: profile!.email,
      amount: amountPesewas,
      phone: phone.startsWith('+') ? phone : `+233${phone.replace(/^0/, '')}`,
      provider: providerMap[txn.payment_channel] as 'mtn' | 'vod' | 'atl',
      reference: paymentRef,
      metadata: {
        transaction_id,
        investor_id: user.id,
        share_class: (txn.share_classes as Record<string, unknown>)?.name,
        units: txn.units,
      },
    })
  } else {
    // Card payment — redirect to Paystack checkout
    paystackResponse = await paystack.initializeTransaction({
      email: profile!.email,
      amount: amountPesewas,
      reference: paymentRef,
      callback_url: `${c.env.FRONTEND_URL}/dashboard/shares/payment-complete`,
      channels: ['card'],
      metadata: {
        transaction_id,
        investor_id: user.id,
        units: txn.units,
      },
    })
  }

  const psData = paystackResponse as { status: boolean; data: Record<string, unknown> }
  if (!psData.status) {
    return c.json({ error: 'Payment initiation failed. Please try again.' }, 502)
  }

  // Create payment record
  const { data: payment } = await supabase
    .from('payments')
    .insert({
      reference: paymentRef,
      internal_reference: paymentRef,
      investor_id: user.id,
      amount: txn.net_amount,
      channel: txn.payment_channel,
      provider: 'paystack',
      provider_reference: (psData.data?.access_code as string) || paymentRef,
      provider_response: psData.data,
      mobile_number: mobile_number || profile?.phone,
      transaction_id,
      ip_address: c.req.header('CF-Connecting-IP'),
    })
    .select()
    .single()

  // Link payment to transaction
  await supabase
    .from('share_transactions')
    .update({ payment_id: payment?.id })
    .eq('id', transaction_id)

  return c.json({
    payment_id: payment?.id,
    reference: paymentRef,
    ...(psData.data?.authorization_url
      ? { redirect_url: psData.data.authorization_url }
      : { message: psData.data?.display_text || 'Please check your phone to approve the MoMo payment.' }
    ),
    status: 'initiated',
  })
})

// GET /api/payments/verify/:reference — Verify payment status
payments.get('/verify/:reference', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')
  const reference = c.req.param('reference')

  const { data: payment } = await supabase
    .from('payments')
    .select('*')
    .eq('reference', reference)
    .eq('investor_id', user.id)
    .single()

  if (!payment) return c.json({ error: 'Payment not found' }, 404)

  // Already confirmed
  if (payment.status === 'completed') {
    return c.json({ status: 'completed', payment })
  }

  // Verify with Paystack
  const paystack = new PaystackService(c.env.PAYSTACK_SECRET_KEY)
  const verification = await paystack.verifyTransaction(reference)

  if (!verification.status || !verification.data) {
    return c.json({ status: payment.status, payment })
  }

  const psStatus = verification.data.status

  if (psStatus === 'success') {
    // Update payment status
    await supabase.from('payments').update({
      status: 'completed',
      paid_at: new Date().toISOString(),
      webhook_verified: true,
      provider_response: verification.data,
      card_type: verification.data.authorization?.card_type,
      card_last4: verification.data.authorization?.last4,
      card_bank: verification.data.authorization?.bank,
    }).eq('reference', reference)

    // Update transaction to pending admin approval
    if (payment.transaction_id) {
      await supabase.from('share_transactions').update({
        payment_status: 'completed',
      }).eq('id', payment.transaction_id)

      // Create approval queue entry
      await supabase.from('approval_queue').insert({
        resource_type: 'share_transaction',
        resource_id: payment.transaction_id,
        action: 'approve_share_purchase',
        data: { payment_reference: reference, amount: payment.amount },
      })

      // Notify bank staff
      await supabase.from('notifications').insert({
        user_id: user.id,
        type: 'payment_confirmed',
        title: 'Payment Received',
        message: `Your payment of GHS ${payment.amount.toFixed(2)} has been confirmed. Your shares are pending bank approval.`,
        data: { reference, transaction_id: payment.transaction_id },
      })
    }

    return c.json({ status: 'completed', message: 'Payment successful. Awaiting bank approval.' })
  }

  return c.json({ status: psStatus === 'failed' ? 'failed' : 'pending' })
})

// GET /api/payments/history
payments.get('/history', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')

  const { data } = await supabase
    .from('payments')
    .select('*')
    .eq('investor_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  return c.json({ data })
})

export default payments
