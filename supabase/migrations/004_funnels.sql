-- ─────────────────────────────────────────────
-- FUNNELS
-- Run this in Supabase SQL Editor
-- ─────────────────────────────────────────────

create table if not exists public.funnels (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  description     text,
  steps           jsonb not null default '[]',
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.funnels enable row level security;

create policy "Members can view org funnels"
  on public.funnels for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_id = funnels.organization_id
        and user_id = auth.uid()
    )
  );

create policy "Members can create funnels"
  on public.funnels for insert
  with check (
    exists (
      select 1 from public.organization_members
      where organization_id = funnels.organization_id
        and user_id = auth.uid()
    )
  );

create policy "Members can delete own funnels"
  on public.funnels for delete
  using (created_by = auth.uid());
