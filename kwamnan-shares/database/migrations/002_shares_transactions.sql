-- ============================================================
-- Migration 002: Share Holdings & Transactions
-- ============================================================

-- ============================================================
-- SHARE HOLDINGS (Aggregated per investor per share class)
-- ============================================================
CREATE TABLE share_holdings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  share_class_id UUID NOT NULL REFERENCES share_classes(id),

  -- Aggregated totals (updated by trigger on each purchase)
  total_units BIGINT NOT NULL DEFAULT 0,
  total_amount_invested NUMERIC(15,2) NOT NULL DEFAULT 0,
  average_cost_per_unit NUMERIC(12,4),
  current_value NUMERIC(15,2),

  -- Certificate tracking
  certificate_number VARCHAR(30) UNIQUE, -- KRB-CERT-2024-XXXXX
  certificate_issued_at TIMESTAMPTZ,
  certificate_url TEXT, -- Supabase Storage URL

  -- Status
  status share_status DEFAULT 'active',
  first_purchase_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(investor_id, share_class_id)
);

-- ============================================================
-- SHARE TRANSACTIONS (Every purchase/sale event)
-- ============================================================
CREATE TABLE share_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference VARCHAR(50) UNIQUE NOT NULL, -- KRB-TXN-2024-XXXXX
  investor_id UUID NOT NULL REFERENCES profiles(id),
  share_class_id UUID NOT NULL REFERENCES share_classes(id),
  holding_id UUID REFERENCES share_holdings(id),

  -- Transaction details
  transaction_type VARCHAR(20) NOT NULL DEFAULT 'purchase', -- purchase, dividend, bonus
  units BIGINT NOT NULL,
  price_per_unit NUMERIC(12,4) NOT NULL,
  gross_amount NUMERIC(15,2) NOT NULL, -- units * price
  charges NUMERIC(12,2) DEFAULT 0,     -- Processing fees
  net_amount NUMERIC(15,2) NOT NULL,   -- gross + charges (investor pays)

  -- Charge breakdown
  processing_fee NUMERIC(12,2) DEFAULT 0,
  platform_fee NUMERIC(12,2) DEFAULT 0,
  vat NUMERIC(12,2) DEFAULT 0,

  -- Payment
  payment_id UUID, -- References payments table
  payment_status payment_status DEFAULT 'pending',
  payment_channel payment_channel,

  -- Approval workflow
  approval_status approval_status DEFAULT 'pending',
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,
  second_approver_id UUID REFERENCES profiles(id), -- Dual control
  second_approved_at TIMESTAMPTZ,

  -- Status
  status share_status DEFAULT 'pending_approval',
  notes TEXT,
  ip_address INET,
  device_fingerprint TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference VARCHAR(100) UNIQUE NOT NULL, -- Paystack reference
  internal_reference VARCHAR(50) UNIQUE NOT NULL, -- Our reference
  investor_id UUID NOT NULL REFERENCES profiles(id),

  amount NUMERIC(15,2) NOT NULL, -- Amount in GHS
  currency VARCHAR(3) DEFAULT 'GHS',
  channel payment_channel NOT NULL,
  status payment_status DEFAULT 'pending',

  -- Provider data
  provider VARCHAR(50) NOT NULL DEFAULT 'paystack',
  provider_reference VARCHAR(100) UNIQUE,
  provider_response JSONB,

  -- Mobile money specific
  mobile_number VARCHAR(20), -- For MoMo payments
  network_provider VARCHAR(20), -- mtn, vodafone, airteltigo

  -- Card specific
  card_type VARCHAR(20),
  card_last4 VARCHAR(4),
  card_bank VARCHAR(100),

  -- Transaction this payment is for
  transaction_id UUID REFERENCES share_transactions(id),

  -- Timestamps
  initiated_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,

  -- Security
  ip_address INET,
  webhook_verified BOOLEAN DEFAULT false,

  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DIVIDENDS
-- ============================================================
CREATE TABLE dividends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  share_class_id UUID NOT NULL REFERENCES share_classes(id),
  declaration_date DATE NOT NULL,
  record_date DATE NOT NULL,
  payment_date DATE,

  rate_per_unit NUMERIC(8,4) NOT NULL,
  total_payout NUMERIC(15,2),
  status VARCHAR(20) DEFAULT 'declared', -- declared, paid

  declared_by UUID REFERENCES profiles(id),
  approved_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE dividend_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dividend_id UUID NOT NULL REFERENCES dividends(id),
  investor_id UUID NOT NULL REFERENCES profiles(id),
  holding_id UUID REFERENCES share_holdings(id),

  units_at_record BIGINT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  tax_withheld NUMERIC(12,2) DEFAULT 0,
  net_amount NUMERIC(12,2) NOT NULL,

  payment_method VARCHAR(50),
  paid_at TIMESTAMPTZ,
  payment_reference VARCHAR(100),

  created_at TIMESTAMPTZ DEFAULT NOW()
);
