-- Migration 007: Enhanced role system — adds inputer and authorizer as distinct roles
-- Dual-control: inputer (maker) creates; authorizer (checker) approves
-- An authorizer CAN also be an inputer — they simply have both privileges

-- 1. Update the user_role enum to include the new granular bank roles
DO $$
BEGIN
  -- Add roles if they don't exist
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'inputer';
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'authorizer';
EXCEPTION WHEN others THEN NULL;
END$$;

-- The full role hierarchy:
--   investor    → can buy shares, view own portfolio
--   inputer     → can create transactions/payments on behalf of investors (maker)
--   authorizer  → can approve/reject transactions (checker); may also be inputer
--   bank_staff  → legacy catch-all, same as inputer
--   admin       → full access, user management
--   auditor     → read-only across all tables

-- 2. Column to flag that an authorizer is currently acting as inputer
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS acting_as_inputer BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS staff_employee_id TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS totp_enrolled BOOLEAN DEFAULT FALSE;

-- Authorizers must always have TOTP enrolled — enforce via trigger
CREATE OR REPLACE FUNCTION enforce_authorizer_totp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IN ('authorizer', 'admin') AND NEW.totp_enrolled = FALSE THEN
    RAISE EXCEPTION 'Authorizer and admin roles require TOTP enrollment before activation.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_authorizer_totp ON profiles;
CREATE TRIGGER check_authorizer_totp
  BEFORE UPDATE OF role ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_authorizer_totp();

-- 3. Update auth.user_role() helper (used in RLS) to include new roles
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role::text FROM profiles WHERE id = auth.uid();
$$;

-- 4. Convenience function: is the current user authorizer-level or above?
CREATE OR REPLACE FUNCTION auth.can_authorize()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role IN ('authorizer', 'admin') FROM profiles WHERE id = auth.uid();
$$;

-- 5. Can the current user input transactions (maker)?
CREATE OR REPLACE FUNCTION auth.can_input()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role IN ('inputer', 'bank_staff', 'admin')
      OR (role = 'authorizer' AND acting_as_inputer = TRUE)
  FROM profiles WHERE id = auth.uid();
$$;

-- 6. Update approval_queue to track inputer separately from authorizer
ALTER TABLE approval_queue
  ADD COLUMN IF NOT EXISTS inputer_id UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS inputer_notes TEXT;

-- 7. Update RLS for share_transactions to allow inputers to insert
DROP POLICY IF EXISTS "staff_manage_transactions" ON share_transactions;
CREATE POLICY "inputer_create_transactions" ON share_transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.can_input());

CREATE POLICY "authorizer_update_transactions" ON share_transactions FOR UPDATE
  TO authenticated
  USING (auth.can_authorize());

CREATE POLICY "staff_read_all_transactions" ON share_transactions FOR SELECT
  TO authenticated
  USING (
    auth.uid() = investor_id   -- own record
    OR auth.user_role() IN ('inputer', 'authorizer', 'bank_staff', 'admin', 'auditor')
  );

-- 8. View: pending items needing authorizer action (excludes items created by same person)
CREATE OR REPLACE VIEW pending_authorizations AS
SELECT
  aq.id,
  aq.transaction_id,
  aq.payment_id,
  aq.status,
  aq.first_approved_by,
  aq.first_approved_at,
  aq.inputer_id,
  aq.inputer_notes,
  aq.created_at,
  p.full_name   AS investor_name,
  p.investor_id AS investor_code,
  st.total_amount,
  st.units,
  sc.name       AS share_class_name,
  inp.full_name AS inputer_name
FROM approval_queue aq
JOIN share_transactions st ON st.id = aq.transaction_id
JOIN profiles p  ON p.id  = st.investor_id
JOIN share_classes sc ON sc.id = st.share_class_id
LEFT JOIN profiles inp ON inp.id = aq.inputer_id
WHERE aq.status = 'pending'
  -- Authorizer cannot approve their own input
  AND (aq.inputer_id IS NULL OR aq.inputer_id != auth.uid())
  AND (aq.first_approved_by IS NULL OR aq.first_approved_by != auth.uid())
ORDER BY aq.created_at ASC;

-- 9. Audit log: track mode-switch (authorizer acting as inputer)
CREATE OR REPLACE FUNCTION log_mode_switch()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.acting_as_inputer IS DISTINCT FROM NEW.acting_as_inputer THEN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, changes)
    VALUES (
      auth.uid(),
      CASE NEW.acting_as_inputer WHEN TRUE THEN 'SWITCH_TO_INPUTER' ELSE 'SWITCH_TO_AUTHORIZER' END,
      'profiles',
      NEW.id,
      jsonb_build_object('from', OLD.acting_as_inputer, 'to', NEW.acting_as_inputer)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_mode_switch ON profiles;
CREATE TRIGGER on_mode_switch
  AFTER UPDATE OF acting_as_inputer ON profiles
  FOR EACH ROW EXECUTE FUNCTION log_mode_switch();
