-- Lets a KPI's actual value come from a connected spreadsheet row instead of
-- a tracked event. Until now, every KPI's "total" was computed exclusively
-- from the events table (Mixpanel/Amplitude/app SDK) — operational KPIs with
-- no tracked source (e.g. "claims paid within 24hrs", answered by manually
-- asking the claims team) had no way to ever show real progress, even though
-- the real number already gets typed into a connected sheet every month for
-- the Reports page.
--
-- These three columns are deliberately a manual, explicit mapping (pick the
-- sheet, pick the column that names each row, pick which row IS this KPI) —
-- not name-matching/fuzzy-matching, which could silently attach the wrong
-- number to a KPI with no visible error.

alter table public.metrics
  add column if not exists source_report_id    uuid references public.report_sources(id) on delete set null,
  add column if not exists source_label_column text,   -- which column header identifies each row, e.g. "Metric"
  add column if not exists source_row_value     text;   -- the exact value in that column that IS this KPI
