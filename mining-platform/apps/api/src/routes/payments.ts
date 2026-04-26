/**
 * Payments Routes
 *
 * POST   /payments/initiate        — student initiates payment to instructor
 * POST   /payments/webhook/momo    — MTN MoMo callback
 * POST   /payments/webhook/paystack — Paystack callback
 * GET    /payments/status/:txId    — poll transaction status
 * GET    /payments/wallet          — get own wallet balance
 * GET    /payments/history         — transaction history
 * POST   /payments/payout          — instructor requests payout
 *
 * Pattern: Saga (Orchestrator) for payment flow, Circuit Breaker on gateway calls
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { MTNMoMoAdapter } from "@mining/payments";
import { PaystackAdapter } from "@mining/payments";
import { PaymentSaga } from "@mining/payments";
import { ok, fail } from "@mining/shared";
import { query, queryOne, execute, newId, nowISO } from "../lib/db";
import { audit } from "../lib/audit";
import { authMiddleware, requireRole } from "../middleware/auth";
import { rateLimit } from "../middleware/ratelimit";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();

// All payment routes require auth
router.use("*", authMiddleware);

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMoMoAdapter(env: AppEnv["Bindings"], kv: KVNamespace): MTNMoMoAdapter {
  return new MTNMoMoAdapter({
    subscriptionKeyCollection:    env.MTN_MOMO_SUBSCRIPTION_KEY_COLLECTION,
    subscriptionKeyDisbursement:  env.MTN_MOMO_SUBSCRIPTION_KEY_DISBURSEMENT,
    apiUser: env.MTN_MOMO_API_USER,
    apiKey:  env.MTN_MOMO_API_KEY,
    environment: (env.MTN_MOMO_ENV ?? "sandbox") as "sandbox" | "production",
  }, kv);
}

function getPaystackAdapter(env: AppEnv["Bindings"], kv: KVNamespace): PaystackAdapter {
  return new PaystackAdapter({ secretKey: env.PAYSTACK_SECRET_KEY }, kv);
}

// ── Initiate Payment ──────────────────────────────────────────────────────────
router.post("/initiate",
  rateLimit({ maxTokens: 20, refillRate: 0.5, windowLabel: "payment-initiate" }),
  zValidator("json", z.object({
    instructor_id: z.string().uuid(),
    amount:        z.number().int().min(100),   // pesewas, min GHS 1.00
    currency:      z.enum(["GHS"]).default("GHS"),
    gateway:       z.enum(["mtn_momo", "paystack"]),
    payer_phone:   z.string().optional(),
    payer_email:   z.string().email().optional(),
    description:   z.string().max(200).default("Course payment"),
  })),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const env  = c.env;
    const db   = env.DB;

    // Verify instructor exists and belongs to same company
    const instructor = await queryOne<{ id: string; display_name: string; role: string }>(
      db,
      `SELECT id, display_name, role FROM users WHERE id=? AND company_id=? AND active=1`,
      [body.instructor_id, user.company_id],
    );
    if (!instructor) return c.json(fail("Instructor not found"), 404);
    if (instructor.role !== "instructor" && instructor.role !== "admin") {
      return c.json(fail("Target user is not an instructor"), 400);
    }

    const txId     = newId();
    const feePct   = parseInt(env.PLATFORM_FEE_PCT ?? "10", 10);
    const baseUrl  = new URL(c.req.url).origin;
    const callbackUrl = `${baseUrl}/api/v1/payments/webhook/${body.gateway}`;

    // Gateway-specific validations
    if (body.gateway === "mtn_momo" && !body.payer_phone) {
      return c.json(fail("payer_phone required for MTN MoMo"), 400);
    }

    const saga    = new PaymentSaga(db);
    const gateway = body.gateway === "mtn_momo"
      ? getMoMoAdapter(env, env.RATE_LIMIT)
      : getPaystackAdapter(env, env.RATE_LIMIT);

    // Step 1: Record initiation + hold pending balance
    await saga.initiate({
      transactionId: txId,
      studentId:     user.sub,
      instructorId:  body.instructor_id,
      companyId:     user.company_id,
      amount:        body.amount,
      currency:      body.currency,
      description:   body.description,
      gatewayName:   body.gateway,
    });

    // Step 2: Call gateway
    let result;
    try {
      result = await gateway.initiateCollection({
        id:            txId,
        amount:        body.amount,
        currency:      body.currency,
        payer_phone:   body.payer_phone,
        payer_email:   body.payer_email,
        description:   body.description,
        callback_url:  callbackUrl,
        metadata:      { student_id: user.sub, instructor_id: body.instructor_id },
      });
    } catch (err) {
      await execute(db, `UPDATE transactions SET status='FAILED', updated_at=? WHERE id=?`, [nowISO(), txId]);
      // Release pending hold
      await execute(db, `UPDATE wallets SET pending = pending - ? WHERE user_id=?`, [body.amount, user.sub]);
      return c.json(fail(`Gateway error: ${err instanceof Error ? err.message : "unknown"}`), 502);
    }

    // Update gateway reference
    await execute(db,
      `UPDATE transactions SET status='PENDING', gateway_reference=?, updated_at=? WHERE id=?`,
      [result.gateway_reference, nowISO(), txId],
    );

    await audit(db, {
      company_id: user.company_id, user_id: user.sub,
      action: "PAYMENT_INITIATED", resource: "transactions", resource_id: txId,
      payload: { amount: body.amount, gateway: body.gateway, instructor_id: body.instructor_id },
    });

    return c.json(ok({
      transaction_id:    txId,
      status:            "pending",
      payment_url:       result.payment_url,
      ussd_string:       result.ussd_string,
      gateway_reference: result.gateway_reference,
      amount:            body.amount,
      fee:               Math.round(body.amount * feePct / 100),
      net_instructor:    body.amount - Math.round(body.amount * feePct / 100),
      currency:          body.currency,
    }), 201);
  },
);

// ── MTN MoMo Webhook ──────────────────────────────────────────────────────────
router.post("/webhook/mtn_momo", async (c) => {
  const body = await c.req.text();
  const db   = c.env.DB;

  // MTN MoMo sends a JSON callback — extract reference
  let payload: { externalId?: string; status?: string; financialTransactionId?: string };
  try {
    payload = JSON.parse(body);
  } catch {
    return c.json({ ok: false }, 400);
  }

  const txId = payload.externalId;
  if (!txId) return c.json({ ok: false }, 400);

  const tx = await queryOne<{
    id: string; company_id: string; from_user_id: string;
    to_user_id: string; amount: number; currency: string; status: string;
  }>(db, `SELECT * FROM transactions WHERE id=? OR reference=?`, [txId, txId]);

  if (!tx || tx.status === "CONFIRMED" || tx.status === "FAILED") {
    return c.json({ ok: true }); // idempotent
  }

  if (payload.status === "SUCCESSFUL") {
    const feePct = parseInt(c.env.PLATFORM_FEE_PCT ?? "10", 10);
    const momoGw = getMoMoAdapter(c.env, c.env.RATE_LIMIT);
    const saga   = new PaymentSaga(db);

    await saga.execute({
      transactionId:    tx.id,
      studentId:        tx.from_user_id,
      instructorId:     tx.to_user_id,
      companyId:        tx.company_id,
      amount:           tx.amount,
      currency:         tx.currency as "GHS",
      description:      "MoMo payment confirmed",
      gateway:          momoGw,
      gatewayReference: payload.financialTransactionId ?? txId,
      feePct,
      callbackUrl:      "",
    });
  } else if (payload.status === "FAILED" || payload.status === "REJECTED") {
    await execute(db, `UPDATE transactions SET status='FAILED', updated_at=? WHERE id=?`, [nowISO(), tx.id]);
    await execute(db, `UPDATE wallets SET pending = pending - ? WHERE user_id=?`, [tx.amount, tx.from_user_id]);
  }

  return c.json({ ok: true });
});

// ── Paystack Webhook ──────────────────────────────────────────────────────────
router.post("/webhook/paystack", async (c) => {
  const body      = await c.req.text();
  const signature = c.req.header("x-paystack-signature") ?? "";
  const db        = c.env.DB;

  const valid = await PaystackAdapter.verifyWebhookAsync(body, signature, c.env.WEBHOOK_SECRET_PAYSTACK);
  if (!valid) return c.json({ ok: false }, 401);

  const event = JSON.parse(body) as { event: string; data?: { reference?: string; status?: string } };
  if (event.event !== "charge.success" || !event.data?.reference) {
    return c.json({ ok: true }); // ignore non-payment events
  }

  const tx = await queryOne<{
    id: string; company_id: string; from_user_id: string;
    to_user_id: string; amount: number; currency: string; status: string;
  }>(db, `SELECT * FROM transactions WHERE reference=?`, [event.data.reference]);

  if (!tx || tx.status === "CONFIRMED") return c.json({ ok: true });

  const feePct   = parseInt(c.env.PLATFORM_FEE_PCT ?? "10", 10);
  const paystackGw = getPaystackAdapter(c.env, c.env.RATE_LIMIT);
  const saga = new PaymentSaga(db);

  await saga.execute({
    transactionId:    tx.id,
    studentId:        tx.from_user_id,
    instructorId:     tx.to_user_id,
    companyId:        tx.company_id,
    amount:           tx.amount,
    currency:         tx.currency as "GHS",
    description:      "Paystack payment confirmed",
    gateway:          paystackGw,
    gatewayReference: event.data.reference,
    feePct,
    callbackUrl:      "",
  });

  return c.json({ ok: true });
});

// ── Transaction Status ────────────────────────────────────────────────────────
router.get("/status/:txId", async (c) => {
  const { txId } = c.req.param();
  const user     = c.get("user");
  const db       = c.env.DB;

  const tx = await queryOne<{
    id: string; status: string; amount: number; fee_amount: number;
    currency: string; gateway: string; created_at: string;
  }>(db,
    `SELECT id, status, amount, fee_amount, currency, gateway, created_at
     FROM transactions
     WHERE id=? AND company_id=? AND (from_user_id=? OR to_user_id=?)`,
    [txId, user.company_id, user.sub, user.sub],
  );

  if (!tx) return c.json(fail("Transaction not found"), 404);
  return c.json(ok(tx));
});

// ── Wallet Balance ────────────────────────────────────────────────────────────
router.get("/wallet", async (c) => {
  const user = c.get("user");
  const db   = c.env.DB;

  const [wallet, recentTx] = await Promise.all([
    queryOne<{ balance: number; pending: number; currency: string }>(
      db, `SELECT balance, pending, currency FROM wallets WHERE user_id=?`, [user.sub],
    ),
    query<{ id: string; amount: number; fee_amount: number; type: string; status: string; created_at: string }>(
      db,
      `SELECT id, amount, fee_amount, type, status, created_at
       FROM transactions WHERE (from_user_id=? OR to_user_id=?) AND company_id=?
       ORDER BY created_at DESC LIMIT 5`,
      [user.sub, user.sub, user.company_id],
    ),
  ]);

  return c.json(ok({
    balance:       wallet?.balance  ?? 0,
    pending:       wallet?.pending  ?? 0,
    currency:      wallet?.currency ?? "GHS",
    balance_ghs:   ((wallet?.balance ?? 0) / 100).toFixed(2),
    pending_ghs:   ((wallet?.pending ?? 0) / 100).toFixed(2),
    recent_transactions: recentTx,
  }));
});

// ── Transaction History ───────────────────────────────────────────────────────
router.get("/history", async (c) => {
  const user   = c.get("user");
  const db     = c.env.DB;
  const limit  = Math.min(parseInt(c.req.query("limit")  ?? "20"), 100);
  const offset = parseInt(c.req.query("offset") ?? "0");

  const txs = await query<{
    id: string; amount: number; fee_amount: number; type: string;
    status: string; gateway: string; description: string; created_at: string;
    from_user_id: string; to_user_id: string;
  }>(db,
    `SELECT id, amount, fee_amount, type, status, gateway, description, created_at, from_user_id, to_user_id
     FROM transactions
     WHERE (from_user_id=? OR to_user_id=?) AND company_id=?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [user.sub, user.sub, user.company_id, limit, offset],
  );

  const decorated = txs.map(tx => ({
    ...tx,
    direction:   tx.from_user_id === user.sub ? "debit" : "credit",
    amount_ghs:  (tx.amount / 100).toFixed(2),
  }));

  return c.json(ok({ transactions: decorated, limit, offset }));
});

// ── Payout Request (instructor → bank/MoMo) ───────────────────────────────────
router.post("/payout",
  requireRole("instructor"),
  rateLimit({ maxTokens: 5, refillRate: 0.05, windowLabel: "payout" }),
  zValidator("json", z.object({
    amount:          z.number().int().min(1000),  // min GHS 10
    gateway:         z.enum(["mtn_momo", "paystack"]),
    recipient_phone: z.string().optional(),
    recipient_name:  z.string(),
  })),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const db   = c.env.DB;

    const wallet = await queryOne<{ balance: number; currency: string }>(
      db, `SELECT balance, currency FROM wallets WHERE user_id=?`, [user.sub],
    );
    if (!wallet || wallet.balance < body.amount) {
      return c.json(fail("Insufficient balance"), 400);
    }

    const txId   = newId();
    const now    = nowISO();

    // Debit wallet + record payout transaction atomically
    await db.batch([
      db.prepare(`UPDATE wallets SET balance = balance - ?, updated_at=? WHERE user_id=? AND balance >= ?`)
        .bind(body.amount, now, user.sub, body.amount),
      db.prepare(`
        INSERT INTO transactions (id,company_id,from_user_id,to_user_id,amount,fee_amount,currency,type,status,gateway,reference,description,metadata,created_at,updated_at)
        VALUES (?,?,?,NULL,?,0,?,'PAYOUT','INITIATED',?,?,?,?,?,?)
      `).bind(
        txId, user.company_id, user.sub,
        body.amount, wallet.currency,
        body.gateway, txId,
        `Payout request by ${user.email}`,
        JSON.stringify({ recipient_phone: body.recipient_phone, recipient_name: body.recipient_name }),
        now, now,
      ),
    ]);

    // Trigger payout via gateway
    const gateway = body.gateway === "mtn_momo"
      ? getMoMoAdapter(c.env, c.env.RATE_LIMIT)
      : getPaystackAdapter(c.env, c.env.RATE_LIMIT);

    try {
      const result = await gateway.initiateDisbursement({
        id:              txId,
        amount:          body.amount,
        currency:        wallet.currency as "GHS",
        recipient_phone: body.recipient_phone,
        recipient_name:  body.recipient_name,
        description:     `Mining Platform payout`,
      });

      await execute(db,
        `UPDATE transactions SET status='PENDING', gateway_reference=?, updated_at=? WHERE id=?`,
        [result.gateway_reference, now, txId],
      );

      await audit(db, {
        company_id: user.company_id, user_id: user.sub,
        action: "PAYOUT_REQUESTED", resource: "transactions", resource_id: txId,
        payload: { amount: body.amount, gateway: body.gateway },
      });

      return c.json(ok({ transaction_id: txId, status: "pending", amount_ghs: (body.amount / 100).toFixed(2) }), 201);
    } catch (err) {
      // Refund wallet on gateway failure
      await execute(db, `UPDATE wallets SET balance = balance + ?, updated_at=? WHERE user_id=?`, [body.amount, now, user.sub]);
      await execute(db, `UPDATE transactions SET status='FAILED', updated_at=? WHERE id=?`, [now, txId]);
      return c.json(fail(`Payout failed: ${err instanceof Error ? err.message : "unknown"}`), 502);
    }
  },
);

export default router;
