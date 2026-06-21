-- 012_source_parameters.sql
-- Adds structured configuration to report_sources:
--   data_type        – what kind of data this source contains (e.g. "Claims", "Users")
--   parameters       – array of metric/KPI definitions the user wants tracked
--   expected_insights – natural-language statements of what the user wants to learn

ALTER TABLE report_sources
  ADD COLUMN IF NOT EXISTS data_type         text,
  ADD COLUMN IF NOT EXISTS parameters        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expected_insights jsonb NOT NULL DEFAULT '[]'::jsonb;
