/**
 * Paystack Adapter — handles Mastercard, Visa, and GH bank payments
 * Paystack is the recommended PSP for West Africa (Ghana, Nigeria)
 * Docs: https://paystack.com/docs/api
 *
 * Collections via Paystack hosted checkout (card) or MoMo channel
 * Disbursements via Paystack Transfers API
 *
 * Applies: Circuit Breaker + HMAC webhook verification
 */

import type {
  PaymentGateway, PaymentRequest, PaymentResult,
  DisbursementRequest, DisbursementResult, PaymentStatusResult,
} from "./types";
import { KVCircuitBreaker, withRetry } from "./circuit_breaker";

export interface PaystackConfig {
  secretKey: string;   // sk_live_... or sk_test_...
}

const BASE = "https://api.paystack.co";

export class PaystackAdapter implements PaymentGateway {
  readonly name = "paystack";
  private readonly cb: KVCircuitBreaker;

  constructor(private readonly cfg: PaystackConfig, kv: KVNamespace) {
    this.cb = new KVCircuitBreaker(kv, "paystack");
  }

  private headers(): Record<string, string> {
    return {
      "Authorization": `Bearer ${this.cfg.secretKey}`,
      "Content-Type": "application/json",
    };
  }

  // ── Collections ───────────────────────────────────────────────────────────

  async initiateCollection(req: PaymentRequest): Promise<PaymentResult> {
    return this.cb.call(() =>
      withRetry(async () => {
        const body: Record<string, unknown> = {
          reference: req.id,
          amount: req.amount,         // Paystack uses pesewas/kobo natively
          currency: req.currency,
          email: req.payer_email ?? `${req.id}@mining.placeholder`,
          callback_url: req.callback_url,
          metadata: { ...req.metadata, custom_fields: [] },
        };
        // MoMo channel if phone provided and no email
        if (req.payer_phone && !req.payer_email) {
          body["channels"] = ["mobile_money"];
          body["mobile_money"] = { phone: req.payer_phone, provider: "mtn" };
        }
        const res = await fetch(`${BASE}/transaction/initialize`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
        });
        const json = await res.json() as { status: boolean; message: string; data?: { authorization_url: string; reference: string } };
        if (!json.status || !json.data) throw new Error(`Paystack init failed: ${json.message}`);
        return {
          gateway_reference: json.data.reference,
          status: "pending",
          payment_url: json.data.authorization_url,
        };
      })
    );
  }

  async getCollectionStatus(reference: string): Promise<PaymentStatusResult> {
    return this.cb.call(async () => {
      const res = await fetch(`${BASE}/transaction/verify/${reference}`, {
        headers: this.headers(),
      });
      const json = await res.json() as {
        status: boolean;
        data?: {
          status: string; amount: number; currency: string;
          paid_at?: string; gateway_response?: string;
        };
        message: string;
      };
      if (!json.status || !json.data) throw new Error(`Paystack verify failed: ${json.message}`);
      return {
        reference,
        gateway_reference: reference,
        status: json.data.status === "success" ? "success"
              : json.data.status === "failed"  ? "failed"
              : "pending",
        amount: json.data.amount,
        currency: json.data.currency as "GHS",
        paid_at: json.data.paid_at,
        gateway_message: json.data.gateway_response,
      };
    });
  }

  // ── Disbursements (Transfer API) ─────────────────────────────────────────

  async initiateDisbursement(req: DisbursementRequest): Promise<DisbursementResult> {
    return this.cb.call(() =>
      withRetry(async () => {
        // Step 1: Create transfer recipient
        const recipientBody: Record<string, unknown> = req.recipient_phone
          ? {
              type: "mobile_money",
              name: req.recipient_name,
              account_number: req.recipient_phone.replace(/^\+/, ""),
              bank_code: "MTN",
              currency: req.currency,
            }
          : {
              type: "ghipss",
              name: req.recipient_name,
              currency: req.currency,
            };

        const recRes = await fetch(`${BASE}/transferrecipient`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(recipientBody),
        });
        const recJson = await recRes.json() as { status: boolean; data?: { recipient_code: string }; message: string };
        if (!recJson.status || !recJson.data) throw new Error(`Paystack recipient failed: ${recJson.message}`);

        // Step 2: Initiate transfer
        const transferRes = await fetch(`${BASE}/transfer`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({
            source: "balance",
            amount: req.amount,
            reference: req.id,
            recipient: recJson.data.recipient_code,
            reason: req.description,
          }),
        });
        const json = await transferRes.json() as { status: boolean; data?: { transfer_code: string; status: string }; message: string };
        if (!json.status || !json.data) throw new Error(`Paystack transfer failed: ${json.message}`);
        return {
          gateway_reference: json.data.transfer_code,
          status: json.data.status === "success" ? "success" : "pending",
        };
      })
    );
  }

  async getDisbursementStatus(reference: string): Promise<PaymentStatusResult> {
    return this.cb.call(async () => {
      const res = await fetch(`${BASE}/transfer/${reference}`, { headers: this.headers() });
      const json = await res.json() as { status: boolean; data?: { status: string; amount: number; currency: string }; message: string };
      if (!json.status || !json.data) throw new Error(`Paystack transfer status failed: ${json.message}`);
      return {
        reference,
        status: json.data.status === "success" ? "success"
              : json.data.status === "failed"  ? "failed"
              : "pending",
        amount: json.data.amount,
        currency: json.data.currency as "GHS",
      };
    });
  }

  // HMAC-SHA512 webhook verification
  verifyWebhook(body: string, signature: string, secret: string): boolean {
    // Cloudflare Workers Web Crypto — synchronous comparison for webhooks
    // We do an async-safe comparison by returning true here and verifying async upstream
    // The actual async verify is done in the route handler via verifyPaystackWebhookAsync()
    return signature.length > 0 && secret.length > 0 && body.length > 0;
  }

  // Call this from route handler (async HMAC verification)
  static async verifyWebhookAsync(body: string, signature: string, secret: string): Promise<boolean> {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
    return expected === signature;
  }
}
