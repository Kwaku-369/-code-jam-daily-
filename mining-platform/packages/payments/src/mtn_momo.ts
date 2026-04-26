/**
 * MTN Mobile Money Adapter
 * Implements: Collections (receive) + Disbursements (send)
 * Docs: https://momodeveloper.mtn.com
 *
 * Applies: Circuit Breaker + Retry (enterprise resilience pattern)
 */

import type {
  PaymentGateway, PaymentRequest, PaymentResult,
  DisbursementRequest, DisbursementResult, PaymentStatusResult,
} from "./types";
import { KVCircuitBreaker, withRetry } from "./circuit_breaker";

export interface MTNMoMoConfig {
  subscriptionKeyCollection: string;
  subscriptionKeyDisbursement: string;
  apiUser: string;
  apiKey: string;
  environment: "sandbox" | "production";
  callbackHost?: string;
}

const BASE_URLS = {
  sandbox:    "https://sandbox.momodeveloper.mtn.com",
  production: "https://proxy.momoapi.mtn.com",
};

type TokenCache = { token: string; expiresAt: number };

export class MTNMoMoAdapter implements PaymentGateway {
  readonly name = "mtn_momo";
  private readonly base: string;
  private collectionToken: TokenCache | null = null;
  private disbursementToken: TokenCache | null = null;
  private readonly collectionCB: KVCircuitBreaker;
  private readonly disbursementCB: KVCircuitBreaker;

  constructor(private readonly cfg: MTNMoMoConfig, kv: KVNamespace) {
    this.base = BASE_URLS[cfg.environment];
    this.collectionCB   = new KVCircuitBreaker(kv, "mtn_collection");
    this.disbursementCB = new KVCircuitBreaker(kv, "mtn_disbursement");
  }

  // ── OAuth tokens ──────────────────────────────────────────────────────────

  private async getCollectionToken(): Promise<string> {
    const now = Date.now();
    if (this.collectionToken && this.collectionToken.expiresAt > now + 30_000) {
      return this.collectionToken.token;
    }
    const creds = btoa(`${this.cfg.apiUser}:${this.cfg.apiKey}`);
    const res = await fetch(`${this.base}/collection/token/`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${creds}`,
        "Ocp-Apim-Subscription-Key": this.cfg.subscriptionKeyCollection,
      },
    });
    if (!res.ok) throw new Error(`MoMo token error: ${res.status}`);
    const { access_token, expires_in } = await res.json() as { access_token: string; expires_in: number };
    this.collectionToken = { token: access_token, expiresAt: now + expires_in * 1000 };
    return access_token;
  }

  private async getDisbursementToken(): Promise<string> {
    const now = Date.now();
    if (this.disbursementToken && this.disbursementToken.expiresAt > now + 30_000) {
      return this.disbursementToken.token;
    }
    const creds = btoa(`${this.cfg.apiUser}:${this.cfg.apiKey}`);
    const res = await fetch(`${this.base}/disbursement/token/`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${creds}`,
        "Ocp-Apim-Subscription-Key": this.cfg.subscriptionKeyDisbursement,
      },
    });
    if (!res.ok) throw new Error(`MoMo disbursement token error: ${res.status}`);
    const { access_token, expires_in } = await res.json() as { access_token: string; expires_in: number };
    this.disbursementToken = { token: access_token, expiresAt: now + expires_in * 1000 };
    return access_token;
  }

  // ── Collections ───────────────────────────────────────────────────────────

  async initiateCollection(req: PaymentRequest): Promise<PaymentResult> {
    return this.collectionCB.call(() =>
      withRetry(async () => {
        const token = await this.getCollectionToken();
        const body = {
          amount: String(Math.round(req.amount / 100)), // convert pesewas → cedis
          currency: req.currency === "GHS" ? "GHS" : req.currency,
          externalId: req.id,
          payer: { partyIdType: "MSISDN", partyId: req.payer_phone?.replace(/^\+/, "") ?? "" },
          payerMessage: req.description.slice(0, 160),
          payeeNote: req.description.slice(0, 160),
        };
        const res = await fetch(`${this.base}/collection/v1_0/requesttopay`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "X-Reference-Id": req.id,
            "X-Target-Environment": this.cfg.environment,
            "X-Callback-Url": req.callback_url,
            "Ocp-Apim-Subscription-Key": this.cfg.subscriptionKeyCollection,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        // 202 Accepted = success for async request
        if (res.status !== 202) {
          const err = await res.text();
          throw new Error(`MoMo collection failed: ${res.status} ${err}`);
        }
        return {
          gateway_reference: req.id,
          status: "pending" as const,
          ussd_string: `*170*8*${req.payer_phone}#`,
        };
      })
    );
  }

  async getCollectionStatus(reference: string): Promise<PaymentStatusResult> {
    return this.collectionCB.call(async () => {
      const token = await this.getCollectionToken();
      const res = await fetch(
        `${this.base}/collection/v1_0/requesttopay/${reference}`,
        {
          headers: {
            "Authorization": `Bearer ${token}`,
            "X-Target-Environment": this.cfg.environment,
            "Ocp-Apim-Subscription-Key": this.cfg.subscriptionKeyCollection,
          },
        },
      );
      if (!res.ok) throw new Error(`MoMo status error: ${res.status}`);
      const data = await res.json() as { status: string; amount: string; currency: string; financialTransactionId?: string; reason?: string };
      return {
        reference,
        gateway_reference: data.financialTransactionId ?? reference,
        status: this.mapStatus(data.status),
        amount: parseFloat(data.amount) * 100, // cedis → pesewas
        currency: "GHS",
        gateway_message: data.reason,
      };
    });
  }

  // ── Disbursements ─────────────────────────────────────────────────────────

  async initiateDisbursement(req: DisbursementRequest): Promise<DisbursementResult> {
    return this.disbursementCB.call(() =>
      withRetry(async () => {
        const token = await this.getDisbursementToken();
        const body = {
          amount: String(Math.round(req.amount / 100)),
          currency: req.currency,
          externalId: req.id,
          payee: { partyIdType: "MSISDN", partyId: req.recipient_phone?.replace(/^\+/, "") ?? "" },
          payerMessage: req.description.slice(0, 160),
          payeeNote: req.description.slice(0, 160),
        };
        const res = await fetch(`${this.base}/disbursement/v1_0/transfer`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "X-Reference-Id": req.id,
            "X-Target-Environment": this.cfg.environment,
            "Ocp-Apim-Subscription-Key": this.cfg.subscriptionKeyDisbursement,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (res.status !== 202) {
          const err = await res.text();
          throw new Error(`MoMo disbursement failed: ${res.status} ${err}`);
        }
        return { gateway_reference: req.id, status: "pending" as const };
      })
    );
  }

  async getDisbursementStatus(reference: string): Promise<PaymentStatusResult> {
    return this.disbursementCB.call(async () => {
      const token = await this.getDisbursementToken();
      const res = await fetch(
        `${this.base}/disbursement/v1_0/transfer/${reference}`,
        {
          headers: {
            "Authorization": `Bearer ${token}`,
            "X-Target-Environment": this.cfg.environment,
            "Ocp-Apim-Subscription-Key": this.cfg.subscriptionKeyDisbursement,
          },
        },
      );
      if (!res.ok) throw new Error(`MoMo disbursement status error: ${res.status}`);
      const data = await res.json() as { status: string; amount: string; currency: string; reason?: string };
      return {
        reference,
        status: this.mapStatus(data.status),
        amount: parseFloat(data.amount) * 100,
        currency: "GHS",
        gateway_message: data.reason,
      };
    });
  }

  // MoMo uses no webhook signature — callback URL receives POST
  verifyWebhook(_body: string, _signature: string, _secret: string): boolean { return true; }

  private mapStatus(s: string): "pending" | "success" | "failed" | "cancelled" {
    if (s === "SUCCESSFUL") return "success";
    if (s === "FAILED")     return "failed";
    if (s === "REJECTED" || s === "TIMEOUT") return "cancelled";
    return "pending";
  }
}
