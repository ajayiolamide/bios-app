-- Controls which sections appear in the morning Slack digest.
-- Default: all sections on.
ALTER TABLE brand_settings
  ADD COLUMN IF NOT EXISTS digest_sections JSONB NOT NULL DEFAULT '{"goals": true, "features": true, "attention": true}'::jsonb;
