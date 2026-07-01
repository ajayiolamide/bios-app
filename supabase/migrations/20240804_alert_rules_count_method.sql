-- Per-rule counting method for event-based alert rules.
-- KPI-based rules use the linked metric's aggregation field instead.
ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS count_method TEXT NOT NULL DEFAULT 'total'
    CHECK (count_method IN ('total', 'unique'));
