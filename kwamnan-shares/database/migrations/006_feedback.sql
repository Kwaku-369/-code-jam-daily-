-- Migration 006: Real-time multilingual feedback collection

CREATE TABLE IF NOT EXISTS feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  rating        SMALLINT CHECK (rating BETWEEN 1 AND 5),
  sentiment     TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  message       TEXT,
  language      TEXT NOT NULL DEFAULT 'en',
  page_path     TEXT,
  voice_used    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: anyone (even anonymous) can insert; only staff can read
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feedback_insert_any" ON feedback FOR INSERT
  TO anon, authenticated WITH CHECK (true);

CREATE POLICY "feedback_read_staff" ON feedback FOR SELECT
  TO authenticated
  USING (auth.user_role() IN ('admin', 'authorizer', 'inputer'));

-- Indexes for admin dashboard queries
CREATE INDEX idx_feedback_created ON feedback(created_at DESC);
CREATE INDEX idx_feedback_lang ON feedback(language);
CREATE INDEX idx_feedback_rating ON feedback(rating);

-- Realtime for staff dashboard live feed
ALTER PUBLICATION supabase_realtime ADD TABLE feedback;

-- Aggregate view for admin analytics
CREATE OR REPLACE VIEW feedback_summary AS
SELECT
  language,
  COUNT(*)                          AS total,
  ROUND(AVG(rating), 2)             AS avg_rating,
  COUNT(*) FILTER (WHERE sentiment = 'positive') AS positive,
  COUNT(*) FILTER (WHERE sentiment = 'neutral')  AS neutral,
  COUNT(*) FILTER (WHERE sentiment = 'negative') AS negative,
  COUNT(*) FILTER (WHERE voice_used = TRUE)      AS voice_submissions,
  DATE_TRUNC('day', created_at)     AS day
FROM feedback
GROUP BY language, DATE_TRUNC('day', created_at)
ORDER BY day DESC, total DESC;
