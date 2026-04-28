// Paystack API service — Ghana (GHS)
// Covers: Card, MTN MoMo, Vodafone Cash, AirtelTigo

const PAYSTACK_BASE = 'https://api.paystack.co'

export type PaystackInitPayload = {
  email: string
  amount: number   // in pesewas (GHS * 100)
  reference: string
  callback_url?: string
  metadata?: Record<string, unknown>
  channels?: string[]
}

export type MoMoPayload = {
  email: string
  amount: number
  phone: string
  provider: 'mtn' | 'vod' | 'atl' // mtn=MTN, vod=Vodafone/Telecel, atl=AirtelTigo
  reference: string
  metadata?: Record<string, unknown>
}

export type ChargeCardPayload = {
  email: string
  amount: number
  authorization_code: string
  reference: string
  metadata?: Record<string, unknown>
}

export class PaystackService {
  private secretKey: string

  constructor(secretKey: string) {
    this.secretKey = secretKey
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${PAYSTACK_BASE}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    const data = await res.json() as T
    return data
  }

  // Initialize standard transaction (redirect to Paystack checkout)
  async initializeTransaction(payload: PaystackInitPayload) {
    return this.request<{
      status: boolean
      message: string
      data: { authorization_url: string; access_code: string; reference: string }
    }>('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        amount: payload.amount, // Already in pesewas
        channels: payload.channels || ['card', 'mobile_money', 'bank'],
      }),
    })
  }

  // Direct MoMo charge (no redirect needed)
  async chargeMoMo(payload: MoMoPayload) {
    return this.request<{
      status: boolean
      message: string
      data: {
        reference: string
        status: string
        display_text: string
      }
    }>('/charge', {
      method: 'POST',
      body: JSON.stringify({
        email: payload.email,
        amount: payload.amount,
        mobile_money: {
          phone: payload.phone,
          provider: payload.provider,
        },
        reference: payload.reference,
        metadata: payload.metadata,
      }),
    })
  }

  // Charge saved card with authorization_code
  async chargeAuthorization(payload: ChargeCardPayload) {
    return this.request<{
      status: boolean
      data: { reference: string; status: string; amount: number }
    }>('/transaction/charge_authorization', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  // Verify transaction (called after webhook or polling)
  async verifyTransaction(reference: string) {
    return this.request<{
      status: boolean
      data: {
        status: string
        reference: string
        amount: number
        paid_at: string
        channel: string
        currency: string
        authorization: {
          authorization_code: string
          card_type: string
          last4: string
          bank: string
          reusable: boolean
        }
        customer: { email: string }
        metadata: Record<string, unknown>
      }
    }>(`/transaction/verify/${reference}`)
  }

  // Verify webhook signature (HMAC SHA512)
  async verifyWebhookSignature(
    rawBody: string,
    signature: string
  ): Promise<boolean> {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(this.secretKey)
    const msgData = encoder.encode(rawBody)

    const key = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
    )
    const hashBuffer = await crypto.subtle.sign('HMAC', key, msgData)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const computed = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    return computed === signature
  }

  // Create transfer recipient (for dividend payouts)
  async createTransferRecipient(data: {
    name: string; account_number: string; bank_code: string
  }) {
    return this.request('/transferrecipient', {
      method: 'POST',
      body: JSON.stringify({ ...data, type: 'nuban', currency: 'GHS' }),
    })
  }

  // Initiate transfer (dividend payout)
  async initiateTransfer(data: {
    amount: number; recipient: string; reason: string; reference: string
  }) {
    return this.request('/transfer', {
      method: 'POST',
      body: JSON.stringify({ ...data, source: 'balance', currency: 'GHS' }),
    })
  }
}

// Calculate charges for share purchase
// Minimum 200 GHS; fee structure increases for 100 GHS range
export function calculateCharges(amountGHS: number): {
  grossAmount: number
  processingFee: number
  platformFee: number
  vat: number
  totalCharges: number
  netAmount: number
  amountInPesewas: number
} {
  let processingFee: number
  let platformFee: number

  if (amountGHS < 200) {
    // Deliberately higher fee structure for sub-200 GHS to encourage minimum
    processingFee = amountGHS * 0.025   // 2.5% (vs 1.95% standard)
    platformFee = amountGHS * 0.015     // 1.5% platform fee
  } else if (amountGHS < 1000) {
    processingFee = Math.min(amountGHS * 0.0195, 100) // Paystack standard: 1.95%, cap GHS 100
    platformFee = amountGHS * 0.005     // 0.5% platform fee
  } else {
    processingFee = Math.min(amountGHS * 0.015, 100)
    platformFee = amountGHS * 0.003
  }

  const vat = processingFee * 0.15 // Ghana 15% VAT on fees
  const totalCharges = processingFee + platformFee + vat
  const netAmount = amountGHS + totalCharges

  return {
    grossAmount: amountGHS,
    processingFee: Math.round(processingFee * 100) / 100,
    platformFee: Math.round(platformFee * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    totalCharges: Math.round(totalCharges * 100) / 100,
    netAmount: Math.round(netAmount * 100) / 100,
    amountInPesewas: Math.round(netAmount * 100),
  }
}

export function generatePaymentReference(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 7).toUpperCase()
  return `KRB-PAY-${timestamp}-${random}`
}
