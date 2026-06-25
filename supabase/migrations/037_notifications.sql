-- 037: status audit trail + notification settings

-- Track every status change as a timestamped log on each feature.
-- Stored as a JSONB array: [{status, timestamp, note?}]
alter table feature_metrics
  add column if not exists status_log jsonb not null default '[]'::jsonb;

-- Per-org notification toggles: PM gets a Slack ping on status change,
-- and/or a weekly digest every Monday at 9am.
alter table brand_settings
  add column if not exists pm_status_alerts_enabled boolean not null default true,
  add column if not exists pm_weekly_digest_enabled boolean not null default true;
