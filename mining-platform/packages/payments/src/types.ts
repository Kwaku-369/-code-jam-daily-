/**
 * Payment Gateway — Clean Architecture Port
 * All external payment adapters implement this interface.
 * Amounts are in the smallest currency unit (pesewas for GHS, cents for USD).
 */

export type Currency = "GHS" | "USD" | "EUR";

export type PaymentStatus = "pending" | "success" | "failed" | "cancelled";

export interface PaymentRequest {
  id: string;              // idempotency key / our reference
  amount: number;          // smallest unit (pesewas)
  currency: Currency;
  payer_phone?: string;    // required for MoMo
  payer_email?: string;    // required for card
  description: string;
  callback_url: string;
  metadata?: Record<string, string>;
}

export interface PaymentResult {
  gateway_reference: string;
  status: PaymentStatus;
  payment_url?: string;    // card redirect URL
  ussd_string?: string;    // MoMo USSD prompt
  raw?: unknown;
}

export interface DisbursementRequest {
  id: string;
  amount: number;
  currency: Currency;
  recipient_phone?: string;
  recipient_name: string;
  description: string;
  metadata?: Record<string, string>;
}

export interface DisbursementResult {
  gateway_reference: string;
  status: PaymentStatus;
  raw?: unknown;
}

export interface PaymentStatusResult {
  reference: string;
  gateway_reference?: string;
  status: PaymentStatus;
  amount?: number;
  currency?: Currency;
  paid_at?: string;
  gateway_message?: string;
}

// ─── Port (implemented by adapters) ───────────────────────────────────────────
export interface PaymentGateway {
  readonly name: string;
  initiateCollection(req: PaymentRequest): Promise<PaymentResult>;
  getCollectionStatus(reference: string): Promise<PaymentStatusResult>;
  initiateDisbursement(req: DisbursementRequest): Promise<DisbursementResult>;
  getDisbursementStatus(reference: string): Promise<PaymentStatusResult>;
  verifyWebhook(body: string, signature: string, secret: string): boolean;
}

// ─── Circuit Breaker (KV-backed for Cloudflare Workers) ───────────────────────
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;  // epoch ms
  nextRetryAt: number;    // epoch ms
}

export const CIRCUIT_DEFAULTS = {
  failureThreshold: 5,
  successThreshold: 2,
  openDurationMs: 60_000,  // 1 minute
} as const;

export class CircuitOpenError extends Error {
  constructor(gateway: string) {
    super(`Circuit OPEN for gateway: ${gateway}`);
    this.name = "CircuitOpenError";
  }
}

// ─── Domain types for platform payment flow ───────────────────────────────────
export type TxType = "PAYMENT" | "PAYOUT" | "FEE" | "REFUND";
export type TxStatus = "INITIATED" | "PENDING" | "CONFIRMED" | "FAILED" | "REFUNDED";

export interface Transaction {
  id: string;
  company_id: string;
  from_user_id: string | null;  // null for platform-initiated
  to_user_id: string | null;
  amount: number;               // pesewas
  fee_amount: number;
  currency: Currency;
  type: TxType;
  status: TxStatus;
  gateway: string;
  gateway_reference: string | null;
  reference: string;            // our idempotent reference
  description: string;
  metadata: string;             // JSON
  created_at: string;
  updated_at: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  company_id: string;
  balance: number;        // available balance in pesewas
  pending: number;        // pending credits (not yet confirmed)
  currency: Currency;
  updated_at: string;
}
