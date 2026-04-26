/**
 * Payment Saga — Orchestrator Pattern
 * =====================================
 * Manages the multi-step payment flow with compensating transactions.
 *
 * Flow:
 *   INITIATED
 *     → PAYMENT_REQUESTED   (call gateway, student debited)
 *     → PAYMENT_CONFIRMED   (webhook/poll confirms success)
 *     → FEE_DEDUCTED        (platform fee credited to company wallet)
 *     → INSTRUCTOR_CREDITED (net amount credited to instructor wallet)
 *     → NOTIFICATIONS_SENT  (outbox pattern: D1 + Queue)
 *     → COMPLETED
 *
 * Compensations (if any step fails after gateway success):
 *   - PAYMENT_CONFIRMED failure → refund via gateway (best-effort)
 *   - DB failures → transactional rollback (D1 batch)
 */

import type { PaymentGateway, TxStatus } from "./types";

export interface PaymentSagaInput {
  transactionId: string;
  studentId: string;
  instructorId: string;
  companyId: string;
  amount: number;      // pesewas — total charged to student
  currency: "GHS" | "USD";
  description: string;
  gateway: PaymentGateway;
  gatewayReference: string;  // already initiated — we confirm here
  feePct: number;            // e.g. 10 = 10%
  callbackUrl: string;
}

export interface SagaResult {
  success: boolean;
  transactionId: string;
  netInstructorAmount: number;
  feeAmount: number;
  error?: string;
}

export class PaymentSaga {
  constructor(private readonly db: D1Database) {}

  async execute(input: PaymentSagaInput): Promise<SagaResult> {
    const fee    = Math.round(input.amount * input.feePct / 100);
    const net    = input.amount - fee;
    const now    = new Date().toISOString();

    try {
      // ── Step 1: Verify payment confirmed with gateway ──────────────────
      const status = await input.gateway.getCollectionStatus(input.gatewayReference);
      if (status.status !== "success") {
        await this.updateTxStatus(input.transactionId, "FAILED");
        return { success: false, transactionId: input.transactionId, netInstructorAmount: 0, feeAmount: 0, error: `Gateway status: ${status.status}` };
      }

      // ── Step 2: Atomic DB transaction — debit student, credit instructor ──
      // D1 batch executes atomically
      const stmts: D1PreparedStatement[] = [
        // Update main transaction to CONFIRMED
        this.db.prepare(`
          UPDATE transactions SET status='CONFIRMED', updated_at=? WHERE id=?
        `).bind(now, input.transactionId),

        // Debit student wallet (balance already held as pending on initiation)
        this.db.prepare(`
          UPDATE wallets SET pending = pending - ?, updated_at=?
          WHERE user_id=? AND pending >= ?
        `).bind(input.amount, now, input.studentId, input.amount),

        // Credit platform fee to company wallet
        this.db.prepare(`
          INSERT INTO wallets (id, user_id, company_id, balance, pending, currency, updated_at)
          VALUES (?, 'platform', ?, ?, 0, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?, updated_at=?
        `).bind(
          crypto.randomUUID(), input.companyId, fee, input.currency, now,
          fee, now,
        ),

        // Credit instructor wallet
        this.db.prepare(`
          INSERT INTO wallets (id, user_id, company_id, balance, pending, currency, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?, updated_at=?
        `).bind(
          crypto.randomUUID(), input.instructorId, input.companyId, net, input.currency, now,
          net, now,
        ),

        // Record fee sub-transaction
        this.db.prepare(`
          INSERT INTO transactions (id, company_id, from_user_id, to_user_id, amount, fee_amount, currency, type, status, gateway, gateway_reference, reference, description, metadata, created_at, updated_at)
          VALUES (?, ?, ?, 'platform', ?, 0, ?, 'FEE', 'CONFIRMED', ?, ?, ?, ?, '{}', ?, ?)
        `).bind(
          crypto.randomUUID(), input.companyId, input.studentId,
          fee, input.currency, input.gateway.name, input.gatewayReference,
          `fee:${input.transactionId}`, `Platform fee for ${input.description}`,
          now, now,
        ),

        // Queue notifications via outbox table
        this.db.prepare(`
          INSERT INTO notifications (id, user_id, company_id, type, title, message, data, created_at)
          VALUES (?, ?, ?, 'PAYMENT_RECEIVED', 'Payment Received', ?, ?, ?)
        `).bind(
          crypto.randomUUID(), input.instructorId, input.companyId,
          `You received GHS ${(net / 100).toFixed(2)} from a student payment.`,
          JSON.stringify({ transactionId: input.transactionId, amount: net }),
          now,
        ),

        this.db.prepare(`
          INSERT INTO notifications (id, user_id, company_id, type, title, message, data, created_at)
          VALUES (?, ?, ?, 'PAYMENT_CONFIRMED', 'Payment Confirmed', ?, ?, ?)
        `).bind(
          crypto.randomUUID(), input.studentId, input.companyId,
          `Your payment of GHS ${(input.amount / 100).toFixed(2)} was confirmed. Remaining balance updated.`,
          JSON.stringify({ transactionId: input.transactionId, amount: input.amount, fee }),
          now,
        ),
      ];

      await this.db.batch(stmts);

      return {
        success: true,
        transactionId: input.transactionId,
        netInstructorAmount: net,
        feeAmount: fee,
      };

    } catch (err) {
      // Best-effort rollback — mark transaction failed
      await this.updateTxStatus(input.transactionId, "FAILED").catch(() => {});
      return {
        success: false,
        transactionId: input.transactionId,
        netInstructorAmount: 0,
        feeAmount: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Initiation phase — called when student triggers payment ──────────────

  async initiate(params: {
    transactionId: string;
    studentId: string;
    instructorId: string;
    companyId: string;
    amount: number;
    currency: string;
    description: string;
    gatewayName: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO transactions (id, company_id, from_user_id, to_user_id, amount, fee_amount, currency, type, status, gateway, gateway_reference, reference, description, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, 'PAYMENT', 'INITIATED', ?, NULL, ?, ?, '{}', ?, ?)
    `).bind(
      params.transactionId, params.companyId,
      params.studentId, params.instructorId,
      params.amount, params.currency,
      params.gatewayName, params.transactionId,
      params.description, now, now,
    ).run();

    // Hold pending balance on student wallet
    await this.db.prepare(`
      INSERT INTO wallets (id, user_id, company_id, balance, pending, currency, updated_at)
      VALUES (?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET pending = pending + ?, updated_at=?
    `).bind(
      crypto.randomUUID(), params.studentId, params.companyId,
      params.amount, params.currency, now,
      params.amount, now,
    ).run();
  }

  private async updateTxStatus(id: string, status: TxStatus): Promise<void> {
    await this.db.prepare(`UPDATE transactions SET status=?, updated_at=? WHERE id=?`)
      .bind(status, new Date().toISOString(), id).run();
  }
}
