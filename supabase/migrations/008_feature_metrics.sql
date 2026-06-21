-- Feature Metrics Planner
-- Stores guided feature intake + AI-suggested tracking items (metric / KPI / guardrail)

create table if not exists public.feature_metrics (
  id                   uuid        primary key default gen_random_uuid(),
  organization_id      uuid        not null references public.organizations(id) on delete cascade,
  created_by           uuid,

  -- Feature context (gathered via guided questions)
  feature_name         text        not null,
  feature_description  text,
  sector               text,        -- "product" | "growth" | "retention" | "engagement" | "monetization" | "onboarding"
  target_users         text,        -- "all" | "new" | "power" | "segment"
  success_definition   text,
  failure_definition   text,
  interaction_frequency text,       -- "daily" | "weekly" | "monthly" | "one-time"
  launch_timeline      text,        -- e.g. "2 weeks", "Q3"

  -- AI output: array of exactly 3 { type, name, description, how_to_track, event_name, target, frequency }
  suggestions          jsonb       not null default '[]',

  status               text        not null default 'active',  -- "active" | "archived"
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.feature_metrics enable row level security;

create policy "org members can manage feature metrics"
  on public.feature_metrics for all
  using (
    organization_id in (
      select organization_id
      from   public.organization_members
      where  user_id = auth.uid()
    )
  )
  with check (
    organization_id in (
      select organization_id
      from   public.organization_members
      where  user_id = auth.uid()
    )
  );

-- keep updated_at current
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists feature_metrics_updated_at on public.feature_metrics;
create trigger feature_metrics_updated_at
  before update on public.feature_metrics
  for each row execute procedure public.set_updated_at();
