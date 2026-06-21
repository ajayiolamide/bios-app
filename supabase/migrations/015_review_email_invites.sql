-- Track email invites for review sessions
-- Each invite has an email + optional per-invite expiry
ALTER TABLE report_reviews
  ADD COLUMN IF NOT EXISTS invited_emails jsonb NOT NULL DEFAULT '[]'::jsonb;
-- invited_emails shape: [{ email: string, expires_at: string|null, sent_at: string }]
