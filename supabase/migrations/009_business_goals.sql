-- Business Goals + Feature Metrics goal alignment
-- Run after 008_feature_metrics.sql

-- ─── 1. Business Goals ───────────────────────────────────────────────────────

create table if not exists public.business_goals (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  created_by      uuid,

  title           text        not null,           -- "Grow MRR by 40%"
  description     text,                           -- optional longer context
  type            text        not null default 'growth',
    -- "revenue" | "growth" | "retention" | "operational" | "product" | "market"

  target          text,                           -- "£2M ARR by Dec 2026"
  timeframe       text,                           -- "Q1 2026" | "H1 2026" | "Annual 2026"

  status          text        not null default 'active',
    -- "active" | "achieved" | "missed" | "dropped"

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.business_goals enable row level security;

create policy "org members can manage business goals"
  on public.business_goals for all
  using (
    organization_id in (
      select organization_id from public.organization_members where user_id = auth.uid()
    )
  )
  with check (
    organization_id in (
      select organization_id from public.organization_members where user_id = auth.uid()
    )
  );

drop trigger if exists business_goals_updated_at on public.business_goals;
create trigger business_goals_updated_at
  before update on public.business_goals
  for each row execute procedure public.set_updated_at();

-- ─── 2. Link feature_metrics → business_goals ─────────────────────────────

alter table public.feature_metrics
  add column if not exists business_goal_id  uuid references public.business_goals(id) on delete set null,
  add column if not exists goal_alignment    text;  -- AI explanation of how this feature serves the goal
