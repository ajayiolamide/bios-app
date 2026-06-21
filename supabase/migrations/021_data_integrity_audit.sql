-- Read-only audit — run this in the Supabase SQL editor and check which
-- counts come back non-zero. Nothing here modifies data.

select 'metrics with business_goal_id pointing to a goal that no longer exists' as check, count(*)
from public.metrics m
where m.business_goal_id is not null
  and not exists (select 1 from public.business_goals g where g.id = m.business_goal_id)

union all
select 'metrics with feature_metric_id pointing to a feature that no longer exists', count(*)
from public.metrics m
where m.feature_metric_id is not null
  and not exists (select 1 from public.feature_metrics f where f.id = m.feature_metric_id)

union all
select 'feature_metrics with business_goal_id pointing to a goal that no longer exists', count(*)
from public.feature_metrics f
where f.business_goal_id is not null
  and not exists (select 1 from public.business_goals g where g.id = f.business_goal_id)

union all
select 'feature_metrics with target_kpi_id pointing to a metric that no longer exists', count(*)
from public.feature_metrics f
where f.target_kpi_id is not null
  and not exists (select 1 from public.metrics m where m.id = f.target_kpi_id)

union all
select 'KPI-kind metrics with no business_goal_id (orphan KPI)', count(*)
from public.metrics where kind = 'kpi' and business_goal_id is null

union all
select 'standalone metrics — not linked to any goal or feature', count(*)
from public.metrics where business_goal_id is null and feature_metric_id is null

union all
select 'metrics with kind=kpi sharing the same event_name as another metric', count(*)
from public.metrics m1
where m1.kind = 'kpi' and m1.event_name is not null
  and exists (
    select 1 from public.metrics m2
    where m2.id != m1.id and m2.event_name = m1.event_name and m2.organization_id = m1.organization_id
  )

union all
select 'brand_settings rows per org beyond the expected one-per-org', count(*)
from (
  select organization_id, count(*) c from public.brand_settings group by organization_id having count(*) > 1
) dupes

union all
select 'demo-tagged events still in the table (from the guardrail demo seed)', count(*)
from public.events where properties->>'demo' = 'true'

union all
select 'events with organization_id not matching any real organization', count(*)
from public.events e
where not exists (select 1 from public.organizations o where o.id = e.organization_id)

order by 1;
