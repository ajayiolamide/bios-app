-- Give the metrics table a real place in the product hierarchy:
-- Business Goal -> Feature (built to move a KPI) -> Metric/KPI/Guardrail.
-- Previously a metric row only carried a feature name baked into its
-- display string ("[Feature Name] label"); there was no real link back to
-- the feature plan or the business goal it serves, and no target to judge
-- the number against.

alter table public.metrics
  add column if not exists business_goal_id uuid references public.business_goals(id) on delete set null,
  add column if not exists feature_metric_id uuid references public.feature_metrics(id) on delete set null,
  add column if not exists target text default null,
  add column if not exists kind text default 'metric' check (kind in ('metric', 'kpi', 'guardrail'));

create index if not exists metrics_business_goal_id_idx on public.metrics(business_goal_id);
create index if not exists metrics_feature_metric_id_idx on public.metrics(feature_metric_id);

-- Backfill existing rows: match the "[Feature Name] ..." prefix already in
-- metric.name back to its feature_metrics row, and inherit that feature's
-- business goal. Rows that don't match a feature prefix (manually created
-- metrics) are left as plain metrics with no goal/feature link.
update public.metrics m
set
  feature_metric_id = fm.id,
  business_goal_id = fm.business_goal_id
from public.feature_metrics fm
where m.feature_metric_id is null
  and m.name like '[' || fm.feature_name || ']%'
  and fm.organization_id = m.organization_id;
