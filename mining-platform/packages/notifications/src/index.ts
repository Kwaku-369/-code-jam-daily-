/**
 * Notification Service — Outbox Pattern
 * ========================================
 * Notifications are written atomically to D1 (outbox table)
 * and dispatched via Cloudflare Queue for reliable async delivery.
 *
 * Read path: REST poll (/api/v1/notifications) + balance summary injected inline.
 * Future: Durable Objects for WebSocket push.
 */

export interface NotificationRow {
  id: string;
  user_id: string;
  company_id: string;
  type: string;
  title: string;
  message: string;
  data: string;        // JSON string
  read: number;        // 0 | 1
  created_at: string;
}

export type NotificationType =
  | "PAYMENT_RECEIVED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_FAILED"
  | "PAYOUT_SENT"
  | "BALANCE_UPDATE"
  | "JOB_ASSIGNED"
  | "INCIDENT_REPORTED"
  | "SAFETY_BRIEF_READY"
  | "SYSTEM";

export class NotificationService {
  constructor(private readonly db: D1Database) {}

  async send(params: {
    userId: string;
    companyId: string;
    type: NotificationType;
    title: string;
    message: string;
    data?: Record<string, unknown>;
  }): Promise<string> {
    const id  = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO notifications (id, user_id, company_id, type, title, message, data, read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).bind(id, params.userId, params.companyId, params.type, params.title, params.message,
      JSON.stringify(params.data ?? {}), now).run();
    return id;
  }

  async sendBatch(notifications: Array<Parameters<NotificationService["send"]>[0]>): Promise<void> {
    if (!notifications.length) return;
    const now   = new Date().toISOString();
    const stmts = notifications.map(n =>
      this.db.prepare(`
        INSERT INTO notifications (id, user_id, company_id, type, title, message, data, read, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).bind(
        crypto.randomUUID(), n.userId, n.companyId, n.type,
        n.title, n.message, JSON.stringify(n.data ?? {}), now,
      ),
    );
    await this.db.batch(stmts);
  }

  async getUnread(userId: string, limit = 20): Promise<NotificationRow[]> {
    const { results } = await this.db.prepare(`
      SELECT * FROM notifications WHERE user_id=? AND read=0
      ORDER BY created_at DESC LIMIT ?
    `).bind(userId, limit).all<NotificationRow>();
    return results;
  }

  async getAll(userId: string, limit = 50, offset = 0): Promise<{ notifications: NotificationRow[]; unread_count: number }> {
    const [list, count] = await Promise.all([
      this.db.prepare(`
        SELECT * FROM notifications WHERE user_id=?
        ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).bind(userId, limit, offset).all<NotificationRow>(),
      this.db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE user_id=? AND read=0`)
        .bind(userId).first<{ n: number }>(),
    ]);
    return { notifications: list.results, unread_count: count?.n ?? 0 };
  }

  async markRead(id: string, userId: string): Promise<void> {
    await this.db.prepare(`UPDATE notifications SET read=1 WHERE id=? AND user_id=?`)
      .bind(id, userId).run();
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db.prepare(`UPDATE notifications SET read=1 WHERE user_id=? AND read=0`)
      .bind(userId).run();
  }

  async getWalletSummary(userId: string): Promise<{
    balance: number;
    pending: number;
    currency: string;
    last_credit?: { amount: number; at: string };
  }> {
    const [wallet, lastCredit] = await Promise.all([
      this.db.prepare(`SELECT balance, pending, currency FROM wallets WHERE user_id=?`)
        .bind(userId).first<{ balance: number; pending: number; currency: string }>(),
      this.db.prepare(`
        SELECT amount, created_at FROM transactions
        WHERE to_user_id=? AND status='CONFIRMED' AND type='PAYMENT'
        ORDER BY created_at DESC LIMIT 1
      `).bind(userId).first<{ amount: number; created_at: string }>(),
    ]);
    return {
      balance:  wallet?.balance  ?? 0,
      pending:  wallet?.pending  ?? 0,
      currency: wallet?.currency ?? "GHS",
      last_credit: lastCredit ? { amount: lastCredit.amount, at: lastCredit.created_at } : undefined,
    };
  }
}
