-- Add access control columns to report_reviews
-- expires_at: null = open forever, timestamp = link expires at that time
-- is_private: true = link is disabled (returns 403-style error)

ALTER TABLE report_reviews
  ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
