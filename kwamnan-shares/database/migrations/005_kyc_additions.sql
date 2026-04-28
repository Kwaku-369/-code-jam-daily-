-- Migration 005: KYC additions to profiles and related tables
-- Adds face photo URL, KYC submission tracking, and storage bucket policies

-- Add KYC columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS face_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS id_type TEXT CHECK (id_type IN ('ghana_card', 'passport', 'voters_id', 'drivers_license')),
  ADD COLUMN IF NOT EXISTS id_number TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- Track who reviewed the KYC and when
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS kyc_reviewed_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS kyc_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_rejection_reason TEXT;

-- Update kyc_status enum to include 'rejected'
-- (The enum was already created in 001_initial.sql as: pending | submitted | verified | rejected)
-- If it's missing 'rejected', add it:
DO $$
BEGIN
  ALTER TYPE kyc_status ADD VALUE IF NOT EXISTS 'rejected';
EXCEPTION WHEN others THEN NULL;
END$$;

-- Index for fast KYC queue queries
CREATE INDEX IF NOT EXISTS idx_profiles_kyc_status ON profiles(kyc_status) WHERE kyc_status != 'verified';
CREATE INDEX IF NOT EXISTS idx_profiles_kyc_submitted_at ON profiles(kyc_submitted_at DESC) WHERE kyc_submitted_at IS NOT NULL;

-- ============================================================
-- Supabase Storage: kyc-documents bucket policies
-- Run these in the Supabase dashboard SQL editor after
-- creating the 'kyc-documents' bucket with private access
-- ============================================================

-- Policy: Investors can upload their own KYC documents
-- CREATE POLICY "kyc_upload_own" ON storage.objects FOR INSERT
--   TO authenticated
--   WITH CHECK (
--     bucket_id = 'kyc-documents'
--     AND (storage.foldername(name))[1] = 'kyc'
--     AND (storage.foldername(name))[2] = auth.uid()::text
--   );

-- Policy: Investors can read their own documents
-- CREATE POLICY "kyc_read_own" ON storage.objects FOR SELECT
--   TO authenticated
--   USING (
--     bucket_id = 'kyc-documents'
--     AND (storage.foldername(name))[2] = auth.uid()::text
--   );

-- Policy: Bank staff (admin, authorizer, inputer) can read all KYC documents
-- CREATE POLICY "kyc_read_staff" ON storage.objects FOR SELECT
--   TO authenticated
--   USING (
--     bucket_id = 'kyc-documents'
--     AND auth.user_role() IN ('admin', 'authorizer', 'inputer')
--   );

-- ============================================================
-- Notification template for KYC status changes
-- ============================================================
CREATE OR REPLACE FUNCTION notify_kyc_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only fire when kyc_status actually changes
  IF OLD.kyc_status IS DISTINCT FROM NEW.kyc_status THEN
    INSERT INTO notifications (user_id, type, title, body, metadata)
    VALUES (
      NEW.id,
      'kyc_status',
      CASE NEW.kyc_status
        WHEN 'verified' THEN 'KYC Verified ✓'
        WHEN 'rejected' THEN 'KYC Review Required'
        WHEN 'submitted' THEN 'KYC Under Review'
        ELSE 'KYC Status Updated'
      END,
      CASE NEW.kyc_status
        WHEN 'verified' THEN 'Your identity has been verified. You can now purchase shares.'
        WHEN 'rejected' THEN COALESCE(NEW.kyc_rejection_reason, 'Your KYC submission needs corrections. Please resubmit.')
        WHEN 'submitted' THEN 'We received your KYC documents. Verification takes up to 1 business day.'
        ELSE 'Your KYC status has been updated.'
      END,
      jsonb_build_object('kyc_status', NEW.kyc_status, 'reviewed_at', NEW.kyc_reviewed_at)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_kyc_status_change ON profiles;
CREATE TRIGGER on_kyc_status_change
  AFTER UPDATE OF kyc_status ON profiles
  FOR EACH ROW EXECUTE FUNCTION notify_kyc_status_change();

-- ============================================================
-- Admin view for KYC queue
-- ============================================================
CREATE OR REPLACE VIEW kyc_queue AS
SELECT
  p.id,
  p.full_name,
  p.email,
  p.phone,
  p.investor_id,
  p.id_type,
  p.id_number,
  p.date_of_birth,
  p.face_photo_url,
  p.kyc_status,
  p.kyc_submitted_at,
  p.kyc_reviewed_at,
  p.kyc_rejection_reason,
  reviewer.full_name AS reviewed_by_name
FROM profiles p
LEFT JOIN profiles reviewer ON reviewer.id = p.kyc_reviewed_by
WHERE p.kyc_status IN ('submitted', 'rejected')
ORDER BY p.kyc_submitted_at ASC;

-- Realtime for KYC queue (admin subscriptions)
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
