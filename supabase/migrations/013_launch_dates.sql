-- 013_launch_dates.sql
-- Adds structured launch date tracking to feature_metrics
-- and date ranges to business_goals for goal-window alignment checks.

-- ─── feature_metrics: launch date tracking ───────────────────────────────────

ALTER TABLE public.feature_metrics
  ADD COLUMN IF NOT EXISTS planned_launch_date  date,
  ADD COLUMN IF NOT EXISTS actual_launch_date   date,
  ADD COLUMN IF NOT EXISTS launch_status        text NOT NULL DEFAULT 'not_launched'
    CHECK (launch_status IN ('not_launched', 'launched', 'delayed', 'cancelled'));

-- ─── business_goals: date range for window alignment ─────────────────────────

ALTER TABLE public.business_goals
  ADD COLUMN IF NOT EXISTS start_date  date,
  ADD COLUMN IF NOT EXISTS end_date    date;
