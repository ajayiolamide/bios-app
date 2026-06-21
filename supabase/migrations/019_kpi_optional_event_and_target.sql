-- A KPI is decided ("we want 80% renewal within 7 days") before anyone has
-- necessarily built or wired up the event that will measure it. Requiring
-- event_name at the moment a KPI is created forces people to type a guessed
-- or placeholder event just to save the form. Make it optional — a KPI can
-- exist as "defined, not yet measurable" until a real event is attached,
-- either manually or when a feature built against it supplies one.
alter table public.metrics alter column event_name drop not null;

-- Structured target, separate from the free-text `target` column added in
-- migration 017. `target` stays as an optional human-readable note (e.g.
-- "by end of Q2"); target_value is a plain number in the SAME unit as the
-- metric's own aggregation (count / unique_users / unique_sessions) — not a
-- percentage, since the app has no concept of a denominator to compute a
-- real rate against. This is what actually lets a goal's progress be
-- computed (actual / target_value) instead of just shown as text.
alter table public.metrics add column if not exists target_value numeric default null;
