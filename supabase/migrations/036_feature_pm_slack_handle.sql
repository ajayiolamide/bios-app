-- Add PM / owner Slack handle to feature metrics
-- Used to tag the responsible PM in Slack notifications

alter table feature_metrics
  add column if not exists pm_slack_handle text null;
