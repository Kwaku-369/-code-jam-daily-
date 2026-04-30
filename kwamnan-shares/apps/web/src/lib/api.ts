// API client for Cloudflare Worker
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://kwamnan-shares-api.workers.dev'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, ...fetchOptions } = options
  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...fetchOptions.headers,
    },
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' })) as { error: string }
    throw new ApiError(res.status, error.error || 'Request failed')
  }

  return res.json() as Promise<T>
}

// ── Auth ──────────────────────────────────────────────────
export const authApi = {
  register: (data: Record<string, unknown>) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  login: (email: string, password: string) =>
    request<{ access_token: string; refresh_token: string; user: UserProfile; requires_2fa: boolean }>(
      '/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }
    ),

  enrollTotp: (token: string) =>
    request<{ factor_id: string; qr_code: string; secret: string; uri: string }>(
      '/api/auth/enroll-totp', { method: 'POST', token }
    ),

  challengeTotp: (factor_id: string, token: string) =>
    request<{ challenge_id: string }>(
      '/api/auth/challenge-totp', { method: 'POST', body: JSON.stringify({ factor_id }), token }
    ),

  verifyTotp: (factor_id: string, challenge_id: string, code: string, token: string) =>
    request<{ success: boolean; session: Record<string, unknown> }>(
      '/api/auth/verify-totp', {
        method: 'POST',
        body: JSON.stringify({ factor_id, challenge_id, code }),
        token,
      }
    ),

  refresh: (refresh_token: string) =>
    request<{ access_token: string; refresh_token: string }>(
      '/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token }) }
    ),
}

// ── Shares ────────────────────────────────────────────────
export const sharesApi = {
  getClasses: () => request<{ data: ShareClass[] }>('/api/shares/classes'),

  getPortfolio: (token: string) =>
    request<{ data: Holding[] }>('/api/shares/portfolio', { token }),

  getTransactions: (token: string, page = 1) =>
    request<{ data: Transaction[]; total: number }>(`/api/shares/transactions?page=${page}`, { token }),

  purchase: (data: PurchasePayload, token: string) =>
    request<PurchaseResponse>('/api/shares/purchase', {
      method: 'POST', body: JSON.stringify(data), token,
    }),

  getCertificateUrl: (holdingId: string, token: string) =>
    request<{ url: string }>(`/api/shares/certificate/${holdingId}`, { token }),

  downloadSpreadsheet: (token: string) =>
    fetch(`${API_BASE}/api/shares/spreadsheet`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.blob()),
}

// ── Payments ──────────────────────────────────────────────
export const paymentsApi = {
  initiate: (data: { transaction_id: string; mobile_number?: string }, token: string) =>
    request<{ payment_id: string; reference: string; redirect_url?: string; message?: string }>(
      '/api/payments/initiate', { method: 'POST', body: JSON.stringify(data), token }
    ),

  verify: (reference: string, token: string) =>
    request<{ status: string; message?: string }>(`/api/payments/verify/${reference}`, { token }),

  getHistory: (token: string) =>
    request<{ data: Payment[] }>('/api/payments/history', { token }),
}

// ── Notifications ─────────────────────────────────────────
export const notificationsApi = {
  getAll: (token: string) => request<{ data: Notification[] }>('/api/notifications', { token }),
  readAll: (token: string) => request('/api/notifications/read-all', { method: 'POST', token }),
  getUnreadCount: (token: string) => request<{ count: number }>('/api/notifications/unread-count', { token }),
}

// ── Admin ────────────────────────────────────────────────
export const adminApi = {
  getDashboard: (token: string) => request<AdminDashboard>('/api/admin/dashboard', { token }),
  getApprovalQueue: (token: string) => request<{ data: ApprovalItem[] }>('/api/admin/approval-queue', { token }),
  approve: (queueId: string, data: { totp_code: string; notes?: string }, token: string) =>
    request('/api/admin/approve/' + queueId, { method: 'POST', body: JSON.stringify(data), token }),
  reject: (queueId: string, data: { totp_code: string; reason: string }, token: string) =>
    request('/api/admin/reject/' + queueId, { method: 'POST', body: JSON.stringify(data), token }),
  getInvestors: (token: string, search?: string, page = 1) =>
    request<{ data: UserProfile[]; total: number }>(`/api/admin/investors?search=${search || ''}&page=${page}`, { token }),
  getDuplicates: (token: string) => request<{ data: DuplicateFlag[] }>('/api/admin/duplicates', { token }),
  getSecurityEvents: (token: string) => request<{ data: SecurityEvent[] }>('/api/admin/security-events', { token }),
}

// ── Types ─────────────────────────────────────────────────
export type UserProfile = {
  id: string; investor_id: string; full_name: string; email: string; phone: string;
  role: string; status: string; totp_enabled: boolean; sms_2fa_enabled: boolean;
  total_shares: number; total_invested: number; kyc_verified: boolean;
}
export type ShareClass = {
  id: string; code: string; name: string; description: string;
  current_price: number; face_value: number; minimum_units: number;
  dividend_rate: number; dividend_frequency: string;
  total_shares_authorized: number; total_shares_issued: number;
  investor_count: number;
}
export type Holding = {
  id: string; share_class_id: string; total_units: number; total_amount_invested: number;
  current_value: number; unrealized_pnl: number; certificate_number: string;
  certificate_url?: string; average_cost_per_unit?: number; share_classes: ShareClass;
}
export type Transaction = {
  id: string; reference: string; units: number; price_per_unit: number;
  gross_amount: number; net_amount: number; status: string; payment_channel: string;
  created_at: string; share_classes: { code: string; name: string };
}
export type PurchasePayload = {
  share_class_id: string; units: number; payment_channel: string; mobile_number?: string;
}
export type PurchaseResponse = {
  transaction_id: string; reference: string; amount: number; amount_pesewas: number;
  breakdown: Record<string, string>; investor_email: string; investor_phone: string;
  share_class: string; units: number;
}
export type Payment = {
  id: string; reference: string; amount: number; channel: string; status: string;
  created_at: string; paid_at?: string;
}
export type Notification = {
  id: string; type: string; title: string; message: string; read: boolean; created_at: string;
}
export type AdminDashboard = {
  stats: { total_investors: number; pending_approvals: number; total_invested_ghs: number; security_alerts: number; duplicate_flags: number };
  recent_transactions: Transaction[];
}
export type ApprovalItem = {
  id: string; resource_type: string; resource_id: string; status: string;
  first_approved_at?: string; second_approved_at?: string;
  first_approval_notes?: string; second_approval_notes?: string;
  requested_at: string; data: Record<string, unknown>;
  share_transactions: Transaction & { profiles: UserProfile; share_classes: ShareClass };
}
export type DuplicateFlag = {
  id: string; match_confidence: number; match_type: string; match_details: Record<string, unknown>;
  flagged: UserProfile; matching: UserProfile;
}
export type SecurityEvent = {
  id: string; event_type: string; threat_level: string; description: string;
  ip_address: string; created_at: string; profiles?: UserProfile;
}
