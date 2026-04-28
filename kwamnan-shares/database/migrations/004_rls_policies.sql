-- ============================================================
-- Migration 004: Row Level Security Policies
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividend_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_price_history ENABLE ROW LEVEL SECURITY;

-- Helper function
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS TEXT AS $$
  SELECT role::TEXT FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- PROFILES
-- ============================================================
-- Investors can only see/edit their own profile
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (id = auth.uid() OR auth.user_role() IN ('admin', 'bank_staff', 'auditor'));

CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (
    id = auth.uid() OR auth.user_role() IN ('admin', 'bank_staff')
  );

-- ============================================================
-- SHARE HOLDINGS
-- ============================================================
CREATE POLICY "holdings_select" ON share_holdings
  FOR SELECT USING (
    investor_id = auth.uid() OR auth.user_role() IN ('admin', 'bank_staff', 'auditor')
  );

CREATE POLICY "holdings_insert_service" ON share_holdings
  FOR INSERT WITH CHECK (auth.user_role() IN ('admin', 'bank_staff') OR investor_id = auth.uid());

-- ============================================================
-- SHARE TRANSACTIONS
-- ============================================================
CREATE POLICY "transactions_select" ON share_transactions
  FOR SELECT USING (
    investor_id = auth.uid() OR auth.user_role() IN ('admin', 'bank_staff', 'auditor')
  );

CREATE POLICY "transactions_insert_own" ON share_transactions
  FOR INSERT WITH CHECK (investor_id = auth.uid());

-- Only admin/staff can update transaction status
CREATE POLICY "transactions_update_admin" ON share_transactions
  FOR UPDATE USING (auth.user_role() IN ('admin', 'bank_staff'));

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE POLICY "payments_select" ON payments
  FOR SELECT USING (
    investor_id = auth.uid() OR auth.user_role() IN ('admin', 'bank_staff', 'auditor')
  );

CREATE POLICY "payments_insert_own" ON payments
  FOR INSERT WITH CHECK (investor_id = auth.uid());

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (user_id = auth.uid() OR auth.user_role() IN ('admin'));

-- ============================================================
-- AUDIT LOGS (Read-only for auditors/admins)
-- ============================================================
CREATE POLICY "audit_read_admin" ON audit_logs
  FOR SELECT USING (auth.user_role() IN ('admin', 'auditor'));

-- ============================================================
-- SECURITY EVENTS
-- ============================================================
CREATE POLICY "security_events_admin" ON security_events
  FOR SELECT USING (auth.user_role() IN ('admin', 'bank_staff'));

-- ============================================================
-- DUPLICATE FLAGS
-- ============================================================
CREATE POLICY "duplicates_admin" ON duplicate_flags
  FOR ALL USING (auth.user_role() IN ('admin', 'bank_staff'));

-- ============================================================
-- APPROVAL QUEUE
-- ============================================================
CREATE POLICY "approval_queue_staff" ON approval_queue
  FOR ALL USING (auth.user_role() IN ('admin', 'bank_staff'));

-- ============================================================
-- SHARE CLASSES (Public read)
-- ============================================================
CREATE POLICY "share_classes_public_read" ON share_classes
  FOR SELECT USING (is_available = true OR auth.user_role() IN ('admin', 'bank_staff'));

CREATE POLICY "share_classes_admin_write" ON share_classes
  FOR ALL USING (auth.user_role() = 'admin');

-- ============================================================
-- DIVIDEND PAYMENTS
-- ============================================================
CREATE POLICY "dividend_payments_select" ON dividend_payments
  FOR SELECT USING (
    investor_id = auth.uid() OR auth.user_role() IN ('admin', 'bank_staff', 'auditor')
  );

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX idx_profiles_investor_id ON profiles(investor_id);
CREATE INDEX idx_profiles_id_number ON profiles(id_number);
CREATE INDEX idx_profiles_phone ON profiles(phone);
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_full_name_trgm ON profiles USING gin(full_name gin_trgm_ops);
CREATE INDEX idx_transactions_investor_id ON share_transactions(investor_id);
CREATE INDEX idx_transactions_status ON share_transactions(status);
CREATE INDEX idx_transactions_created_at ON share_transactions(created_at DESC);
CREATE INDEX idx_payments_reference ON payments(reference);
CREATE INDEX idx_payments_investor_id ON payments(investor_id);
CREATE INDEX idx_holdings_investor_id ON share_holdings(investor_id);
CREATE INDEX idx_notifications_user_id_unread ON notifications(user_id) WHERE read = false;
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_security_events_unresolved ON security_events(created_at DESC) WHERE resolved = false;
CREATE INDEX idx_approval_queue_pending ON approval_queue(status) WHERE status = 'pending';

-- Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE share_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE share_holdings;
ALTER PUBLICATION supabase_realtime ADD TABLE approval_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE share_price_history;
ALTER PUBLICATION supabase_realtime ADD TABLE security_events;
