-- A feature is built to move a KPI that belongs to its business goal, and
-- that KPI can be shared by more than one feature (several features can all
-- be bets on the same number). A feature's own metrics row (kind='kpi',
-- feature_metric_id pointing back to it) can't represent that — it's a 1:1
-- link. This adds a many-features-to-one-KPI pointer on the feature itself.

alter table public.feature_metrics
  add column if not exists target_kpi_id uuid references public.metrics(id) on delete set null;

create index if not exists feature_metrics_target_kpi_id_idx on public.feature_metrics(target_kpi_id);

-- Backfill: before this migration, every "kpi"-kind metric was created
-- privately for a single feature (metrics.feature_metric_id = that feature's
-- id). Promote each of those into the new model by pointing the feature at
-- its own kpi metric as the KPI it targets. This doesn't create any new
-- sharing — it just makes the existing 1:1 relationship explicit through the
-- new column, so future features aimed at the same goal can be pointed at
-- the same KPI row instead of getting their own.
update public.feature_metrics fm
set target_kpi_id = m.id
from public.metrics m
where fm.target_kpi_id is null
  and m.feature_metric_id = fm.id
  and m.kind = 'kpi';
