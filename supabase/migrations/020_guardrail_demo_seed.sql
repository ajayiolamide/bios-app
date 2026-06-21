-- Demo/seed data for the guardrail working example on "test feature".
-- Backdates the launch so computeFeatureImpact's 7-day gate clears, then
-- seeds adopters/non-adopters with a deliberate split: adoption looks like
-- it lifts the KPI (hosp_search), but a much higher share of adopters than
-- non-adopters also trip the new guardrail (hosp_search_failed) — this is
-- the scenario from the "what if failure is more than success" question.
-- Safe to delete afterwards; every row here is tagged properties.demo=true.

-- 1. Backdate the launch so daysSinceLaunch >= 7.
update public.feature_metrics
set launch_status = 'launched', actual_launch_date = (current_date - interval '10 days')::date
where feature_name = 'test feature';

-- 2. Seed events, scoped to the same org as "test feature".
with f as (
  select organization_id, (actual_launch_date)::timestamptz as launch_ts
  from public.feature_metrics where feature_name = 'test feature' limit 1
),
adopters as (select generate_series(1,12) as n),
nonadopters as (select generate_series(1,12) as n)
insert into public.events (organization_id, name, properties, user_id, session_id, timestamp)
select organization_id, 'test_feature_engaged', '{"demo": true}'::jsonb,
       'demo-adopter-' || n, null, launch_ts + (n || ' hours')::interval
from f, adopters
union all
select organization_id, 'hosp_search', '{"demo": true}'::jsonb,
       'demo-adopter-' || n, null, launch_ts + (n || ' hours')::interval + interval '1 hour'
from f, adopters where n <= 9          -- 9/12 adopters hit the KPI
union all
select organization_id, 'hosp_search_failed', '{"demo": true}'::jsonb,
       'demo-adopter-' || n, null, launch_ts + (n || ' hours')::interval + interval '2 hours'
from f, adopters where n <= 8          -- 8/12 adopters trip the guardrail
union all
select organization_id, 'page_view', '{"demo": true}'::jsonb,
       'demo-nonadopter-' || n, null, launch_ts + (n || ' hours')::interval
from f, nonadopters                     -- counts non-adopters as "active"
union all
select organization_id, 'hosp_search', '{"demo": true}'::jsonb,
       'demo-nonadopter-' || n, null, launch_ts + (n || ' hours')::interval + interval '1 hour'
from f, nonadopters where n <= 3        -- only 3/12 non-adopters hit the KPI
union all
select organization_id, 'hosp_search_failed', '{"demo": true}'::jsonb,
       'demo-nonadopter-' || n, null, launch_ts + (n || ' hours')::interval + interval '2 hours'
from f, nonadopters where n <= 1;       -- only 1/12 non-adopters trip the guardrail

-- To remove this demo data later:
-- delete from public.events where properties->>'demo' = 'true';
