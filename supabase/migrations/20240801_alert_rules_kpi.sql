-- Add kpi_id to alert_rules so rules can reference a metric KPI directly.
-- Nullable — only set for rule_type = 'kpi_below_target'.
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS kpi_id UUID REFERENCES metrics(id) ON DELETE SET NULL;
