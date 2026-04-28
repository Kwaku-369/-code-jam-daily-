-- ============================================================
-- Migration 003: Security, Audit & Duplicate Detection
-- ============================================================

-- ============================================================
-- AUDIT LOG (Immutable record of all actions)
-- ============================================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  result VARCHAR(20) DEFAULT 'success', -- success, failure, blocked
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SECURITY EVENTS (Threat Detection)
-- ============================================================
CREATE TABLE security_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  event_type VARCHAR(100) NOT NULL,
  threat_level threat_level DEFAULT 'low',
  description TEXT,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB,
  resolved BOOLEAN DEFAULT false,
  resolved_by UUID REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DUPLICATE DETECTION FLAGS
-- Catches: same ID number different name, same phone different ID, etc.
-- ============================================================
CREATE TABLE duplicate_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flagged_profile_id UUID NOT NULL REFERENCES profiles(id),
  matching_profile_id UUID NOT NULL REFERENCES profiles(id),
  match_type VARCHAR(50) NOT NULL, -- id_number, phone, email, name_fuzzy, combination
  match_confidence NUMERIC(5,2), -- 0-100 confidence score
  match_details JSONB,
  status VARCHAR(20) DEFAULT 'pending', -- pending, cleared, confirmed_duplicate, merged
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  type notification_type NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  data JSONB,
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  sent_email BOOLEAN DEFAULT false,
  sent_sms BOOLEAN DEFAULT false,
  sent_push BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2FA / AUTH SESSIONS
-- ============================================================
CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  session_token TEXT UNIQUE NOT NULL,
  totp_verified BOOLEAN DEFAULT false,
  sms_code VARCHAR(10),
  sms_code_expires_at TIMESTAMPTZ,
  sms_attempts INTEGER DEFAULT 0,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ADMIN APPROVAL QUEUE (Dual Control)
-- ============================================================
CREATE TABLE approval_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resource_type VARCHAR(50) NOT NULL, -- share_transaction, new_investor, kyc
  resource_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,
  requested_by UUID REFERENCES profiles(id),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  data JSONB,

  -- First approver
  first_approver_id UUID REFERENCES profiles(id),
  first_approved_at TIMESTAMPTZ,
  first_approval_notes TEXT,
  first_totp_verified BOOLEAN DEFAULT false,

  -- Second approver (different from first)
  second_approver_id UUID REFERENCES profiles(id),
  second_approved_at TIMESTAMPTZ,
  second_approval_notes TEXT,
  second_totp_verified BOOLEAN DEFAULT false,

  -- Final status
  status approval_status DEFAULT 'pending',
  final_notes TEXT,
  completed_at TIMESTAMPTZ,

  CONSTRAINT different_approvers CHECK (first_approver_id != second_approver_id)
);

-- ============================================================
-- SHARE PRICE HISTORY (Real-time tracking)
-- ============================================================
CREATE TABLE share_price_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  share_class_id UUID NOT NULL REFERENCES share_classes(id),
  price NUMERIC(12,4) NOT NULL,
  recorded_by UUID REFERENCES profiles(id),
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-generate investor_id
CREATE OR REPLACE FUNCTION generate_investor_id()
RETURNS TRIGGER AS $$
DECLARE
  new_id TEXT;
  counter INTEGER;
BEGIN
  IF NEW.role = 'investor' AND NEW.investor_id IS NULL THEN
    SELECT COUNT(*) + 1 INTO counter FROM profiles WHERE role = 'investor';
    new_id := 'KRB-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(counter::TEXT, 5, '0');
    NEW.investor_id := new_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_generate_investor_id
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION generate_investor_id();

-- Auto-generate transaction reference
CREATE OR REPLACE FUNCTION generate_transaction_ref()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reference IS NULL THEN
    NEW.reference := 'KRB-TXN-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
                     UPPER(SUBSTRING(uuid_generate_v4()::TEXT, 1, 8));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_generate_transaction_ref
  BEFORE INSERT ON share_transactions
  FOR EACH ROW EXECUTE FUNCTION generate_transaction_ref();

-- Update profile totals when transaction is approved
CREATE OR REPLACE FUNCTION update_investor_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status != 'active' THEN
    -- Update or create holding
    INSERT INTO share_holdings (investor_id, share_class_id, total_units, total_amount_invested, first_purchase_at)
    VALUES (NEW.investor_id, NEW.share_class_id, NEW.units, NEW.net_amount, NOW())
    ON CONFLICT (investor_id, share_class_id) DO UPDATE
    SET
      total_units = share_holdings.total_units + NEW.units,
      total_amount_invested = share_holdings.total_amount_invested + NEW.net_amount,
      average_cost_per_unit = (share_holdings.total_amount_invested + NEW.net_amount) /
                               (share_holdings.total_units + NEW.units),
      last_updated_at = NOW();

    -- Update profile summary
    UPDATE profiles SET
      total_shares = total_shares + NEW.units,
      total_invested = total_invested + NEW.net_amount,
      updated_at = NOW()
    WHERE id = NEW.investor_id;

    -- Update share class issued count
    UPDATE share_classes SET
      total_shares_issued = total_shares_issued + NEW.units,
      investor_count = (SELECT COUNT(DISTINCT investor_id) FROM share_holdings WHERE share_class_id = NEW.share_class_id),
      updated_at = NOW()
    WHERE id = NEW.share_class_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_update_investor_totals
  AFTER UPDATE ON share_transactions
  FOR EACH ROW EXECUTE FUNCTION update_investor_totals();

-- updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_share_classes_updated_at BEFORE UPDATE ON share_classes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_transactions_updated_at BEFORE UPDATE ON share_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- DUPLICATE DETECTION: Check on profile insert/update
CREATE OR REPLACE FUNCTION check_duplicate_profiles()
RETURNS TRIGGER AS $$
DECLARE
  match RECORD;
  confidence NUMERIC;
BEGIN
  -- Check exact ID number match with different name
  FOR match IN
    SELECT id, full_name, id_number, phone, email FROM profiles
    WHERE id != NEW.id AND (
      (id_number IS NOT NULL AND id_number = NEW.id_number) OR
      (phone = NEW.phone) OR
      (email = NEW.email) OR
      similarity(full_name, NEW.full_name) > 0.7
    )
  LOOP
    confidence := 0;
    IF match.id_number = NEW.id_number THEN confidence := confidence + 40; END IF;
    IF match.phone = NEW.phone THEN confidence := confidence + 30; END IF;
    IF match.email = NEW.email THEN confidence := confidence + 20; END IF;
    IF similarity(match.full_name, NEW.full_name) > 0.7 THEN confidence := confidence + 10; END IF;

    IF confidence >= 30 THEN
      INSERT INTO duplicate_flags (
        flagged_profile_id, matching_profile_id, match_type, match_confidence, match_details
      ) VALUES (
        NEW.id, match.id,
        CASE
          WHEN match.id_number = NEW.id_number THEN 'id_number'
          WHEN match.phone = NEW.phone THEN 'phone'
          WHEN match.email = NEW.email THEN 'email'
          ELSE 'name_fuzzy'
        END,
        confidence,
        jsonb_build_object(
          'new_name', NEW.full_name, 'existing_name', match.full_name,
          'new_phone', NEW.phone, 'existing_phone', match.phone,
          'confidence', confidence
        )
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_check_duplicates
  AFTER INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION check_duplicate_profiles();

-- Generate certificate number when holding is created
CREATE OR REPLACE FUNCTION generate_certificate_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.certificate_number IS NULL THEN
    NEW.certificate_number := 'KRB-CERT-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
                               LPAD((SELECT COUNT(*) + 1 FROM share_holdings)::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_generate_cert_number
  BEFORE INSERT ON share_holdings
  FOR EACH ROW EXECUTE FUNCTION generate_certificate_number();
