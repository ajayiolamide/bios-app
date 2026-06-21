-- ─────────────────────────────────────────────
-- REPORTS SYSTEM
-- Run this in Supabase SQL Editor
-- ─────────────────────────────────────────────

-- Brand settings (one per org)
create table if not exists public.brand_settings (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  company_name    text,
  logo_url        text,
  primary_color   text not null default '#6366f1',
  slack_webhook   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.brand_settings enable row level security;

create policy "Members can view brand settings"
  on public.brand_settings for select
  using (exists (
    select 1 from public.organization_members
    where organization_id = brand_settings.organization_id and user_id = auth.uid()
  ));

create policy "Members can upsert brand settings"
  on public.brand_settings for insert
  with check (exists (
    select 1 from public.organization_members
    where organization_id = brand_settings.organization_id and user_id = auth.uid()
  ));

create policy "Members can update brand settings"
  on public.brand_settings for update
  using (exists (
    select 1 from public.organization_members
    where organization_id = brand_settings.organization_id and user_id = auth.uid()
  ));

-- Report templates (configurable per org)
create table if not exists public.report_templates (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  instructions    text not null,
  slide_hint      int not null default 8,
  order_index     int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.report_templates enable row level security;

create policy "Members can view templates"
  on public.report_templates for select
  using (exists (
    select 1 from public.organization_members
    where organization_id = report_templates.organization_id and user_id = auth.uid()
  ));

create policy "Members can create templates"
  on public.report_templates for insert
  with check (exists (
    select 1 from public.organization_members
    where organization_id = report_templates.organization_id and user_id = auth.uid()
  ));

create policy "Members can update templates"
  on public.report_templates for update
  using (exists (
    select 1 from public.organization_members
    where organization_id = report_templates.organization_id and user_id = auth.uid()
  ));

create policy "Members can delete templates"
  on public.report_templates for delete
  using (exists (
    select 1 from public.organization_members
    where organization_id = report_templates.organization_id and user_id = auth.uid()
  ));

-- Report sources (Google Sheets URLs)
create table if not exists public.report_sources (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  sheet_url       text not null,
  last_fetched_at timestamptz,
  cached_data     jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.report_sources enable row level security;

create policy "Members can view sources"
  on public.report_sources for select
  using (exists (
    select 1 from public.organization_members
    where organization_id = report_sources.organization_id and user_id = auth.uid()
  ));

create policy "Members can manage sources"
  on public.report_sources for all
  using (exists (
    select 1 from public.organization_members
    where organization_id = report_sources.organization_id and user_id = auth.uid()
  ));

-- Generated reports (history)
create table if not exists public.reports (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id     uuid references public.report_templates(id) on delete set null,
  template_name   text not null,
  period          text not null,
  file_url        text,
  status          text not null default 'pending' check (status in ('pending','generating','done','failed')),
  error           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy "Members can view reports"
  on public.reports for select
  using (exists (
    select 1 from public.organization_members
    where organization_id = reports.organization_id and user_id = auth.uid()
  ));

create policy "Members can create reports"
  on public.reports for insert
  with check (exists (
    select 1 from public.organization_members
    where organization_id = reports.organization_id and user_id = auth.uid()
  ));

create policy "Members can update reports"
  on public.reports for update
  using (exists (
    select 1 from public.organization_members
    where organization_id = reports.organization_id and user_id = auth.uid()
  ));
