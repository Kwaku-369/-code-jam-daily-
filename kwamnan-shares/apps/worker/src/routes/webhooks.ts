import { Hono } from 'hono'
import { createClient } from '@supabase/supabase-js'
import { Env } from '../index'
import { PaystackService } from '../services/paystack'
import { generateShareCertificate } from '../services/certificates'

const webhooks = new Hono<{ Bindings: Env }>()

// POST /api/webhooks/paystack — Paystack event handler
webhooks.post('/paystack', async (c) => {
  const rawBody = await c.req.text()
  const signature = c.req.header('x-paystack-signature')

  if (!signature) return c.json({ error: 'No signature' }, 400)

  const paystack = new PaystackService(c.env.PAYSTACK_SECRET_KEY)
  const isValid = await paystack.verifyWebhookSignature(rawBody, signature)

  // Always return 200 — Paystack retries for 72h on non-200
  if (!isValid) {
    console.warn('Invalid Paystack webhook signature')
    return c.json({ received: true }, 200)
  }

  const event = JSON.parse(rawBody)
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY)

  if (event.event === 'charge.success') {
    const { reference, amount, customer, metadata, authorization } = event.data

    // Mark payment as completed
    const { data: payment } = await supabase
      .from('payments')
      .update({
        status: 'completed',
        paid_at: new Date().toISOString(),
        webhook_verified: true,
        card_type: authorization?.card_type,
        card_last4: authorization?.last4,
        card_bank: authorization?.bank,
        provider_response: event.data,
      })
      .eq('reference', reference)
      .select()
      .single()

    if (!payment) return c.json({ received: true }, 200)

    // Update transaction payment status
    if (payment.transaction_id) {
      await supabase.from('share_transactions').update({
        payment_status: 'completed',
      }).eq('id', payment.transaction_id)

      // Queue for bank approval (dual control)
      await supabase.from('approval_queue').upsert({
        resource_type: 'share_transaction',
        resource_id: payment.transaction_id,
        action: 'approve_share_purchase',
        data: {
          payment_reference: reference,
          amount_ghs: amount / 100,
          investor_id: payment.investor_id,
        },
      }, { onConflict: 'resource_id' })

      // Notify investor
      await supabase.from('notifications').insert({
        user_id: payment.investor_id,
        type: 'payment_confirmed',
        title: '✓ Payment Confirmed',
        message: `Your payment of GHS ${(amount / 100).toFixed(2)} was received successfully. Your shares are now pending bank approval.`,
        sent_email: false,
      })
    }
  }

  if (event.event === 'transfer.success') {
    // Dividend payout confirmed
    const { reference, amount } = event.data
    await supabase.from('dividend_payments').update({
      paid_at: new Date().toISOString(),
      payment_reference: reference,
    }).eq('payment_reference', reference)
  }

  return c.json({ received: true }, 200)
})

export default webhooks
