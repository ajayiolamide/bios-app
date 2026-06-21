-- ─────────────────────────────────────────────
-- METRICS
-- Run this in Supabase SQL Editor
-- ─────────────────────────────────────────────

create table if not exists public.metrics (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  description     text,
  event_name      text not null,
  aggregation     text not null default 'count'
                  check (aggregation in ('count', 'unique_users', 'unique_sessions')),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.metrics enable row level security;

create policy "Members can view org metrics"
  on public.metrics for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_id = metrics.organization_id
        and user_id = auth.uid()
    )
  );

create policy "Members can create metrics"
  on public.metrics for insert
  with check (
    exists (
      select 1 from public.organization_members
      where organization_id = metrics.organization_id
        and user_id = auth.uid()
    )
  );

create policy "Members can delete own metrics"
  on public.metrics for delete
  using (created_by = auth.uid());

create trigger set_metrics_updated_at
  before update on public.metrics
  for each row execute procedure public.set_updated_at();
