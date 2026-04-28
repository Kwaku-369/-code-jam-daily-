-- ============================================================
-- KWAMNAN RURAL BANK SHARES SYSTEM
-- Migration 001: Core Schema
-- Run in Supabase SQL Editor
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy name matching (duplicate detection)

-- ============================================================
-- CUSTOM TYPES
-- ============================================================
CREATE TYPE user_role AS ENUM ('investor', 'bank_staff', 'admin', 'auditor');
CREATE TYPE account_status AS ENUM ('pending', 'active', 'suspended', 'closed');
CREATE TYPE id_type AS ENUM ('ghana_card', 'passport', 'voters_id', 'drivers_license');
CREATE TYPE share_status AS ENUM ('pending_approval', 'active', 'matured', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'refunded');
CREATE TYPE payment_channel AS ENUM ('mtn_momo', 'vodafone_cash', 'airteltigo', 'visa', 'mastercard', 'bank_transfer');
CREATE TYPE notification_type AS ENUM ('share_purchased', 'payment_confirmed', 'dividend_due', 'certificate_ready', 'security_alert', 'admin_approval', 'kyc_update');
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'escalated');
CREATE TYPE threat_level AS ENUM ('low', 'medium', 'high', 'critical');

-- ============================================================
-- PROFILES TABLE (extends Supabase auth.users)
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  investor_id VARCHAR(20) UNIQUE, -- Auto-generated: KRB-2024-XXXXX
  role user_role NOT NULL DEFAULT 'investor',
  status account_status NOT NULL DEFAULT 'pending',

  -- Personal info
  full_name VARCHAR(255) NOT NULL,
  date_of_birth DATE,
  gender VARCHAR(10),
  nationality VARCHAR(100) DEFAULT 'Ghanaian',
  phone VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  address TEXT,
  region VARCHAR(100),
  district VARCHAR(100),

  -- ID verification
  id_type id_type,
  id_number VARCHAR(50) UNIQUE,
  id_expiry DATE,
  kyc_verified BOOLEAN DEFAULT false,
  kyc_verified_at TIMESTAMPTZ,
  kyc_verified_by UUID REFERENCES profiles(id),

  -- 2FA settings
  totp_secret VARCHAR(64), -- Encrypted TOTP secret for Google Authenticator
  totp_enabled BOOLEAN DEFAULT false,
  sms_2fa_enabled BOOLEAN DEFAULT false,
  backup_codes TEXT[], -- Encrypted backup codes

  -- Next of kin
  next_of_kin_name VARCHAR(255),
  next_of_kin_phone VARCHAR(20),
  next_of_kin_relation VARCHAR(100),

  -- Profile metadata
  profile_photo_url TEXT,
  total_shares INTEGER DEFAULT 0,
  total_invested NUMERIC(15,2) DEFAULT 0,
  total_dividends_earned NUMERIC(15,2) DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  last_login_ip INET,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SHARE CLASSES / PRODUCTS
-- ============================================================
CREATE TABLE share_classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(20) UNIQUE NOT NULL, -- e.g. 'ORD-A', 'PREF-B'
  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Pricing
  face_value NUMERIC(12,2) NOT NULL DEFAULT 1.00,
  current_price NUMERIC(12,2) NOT NULL,
  minimum_units INTEGER NOT NULL DEFAULT 200, -- 200 units minimum
  maximum_units_per_investor INTEGER,

  -- Returns
  dividend_rate NUMERIC(5,2), -- Annual percentage
  dividend_frequency VARCHAR(20) DEFAULT 'annual', -- quarterly, annual

  -- Availability
  total_shares_authorized BIGINT NOT NULL,
  total_shares_issued BIGINT DEFAULT 0,
  is_available BOOLEAN DEFAULT true,
  available_from DATE,
  available_until DATE,

  -- Social proof counters (updated via triggers)
  investor_count INTEGER DEFAULT 0,
  units_sold_this_month BIGINT DEFAULT 0,

  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default share class
INSERT INTO share_classes (code, name, description, face_value, current_price, minimum_units, total_shares_authorized, dividend_rate, dividend_frequency)
VALUES
  ('ORD-A', 'Ordinary Shares Class A', 'Standard ordinary shares of Kwamnan Rural Bank. Earn dividends annually and participate in bank growth.', 1.00, 1.00, 200, 10000000, 12.50, 'annual'),
  ('PREF-A', 'Preference Shares', 'Fixed dividend preference shares with priority dividend payments.', 1.00, 1.20, 200, 2000000, 15.00, 'semi-annual');
