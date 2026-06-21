-- Every AI surface in the app (Cohorts insight, AI Analyst, AI Business
-- Brief) generated text that was useful in the moment but disappeared the
-- second you navigated away — there was no way to hold onto a good insight
-- and actually put it in a report later. This table is a simple library:
-- save any AI output once, then pick from it when building a deck.

create table if not exists public.saved_insights (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by      uuid references auth.users(id) on delete set null,
  source          text not null,              -- e.g. 'cohort', 'ai_analyst', 'business_brief'
  content         text not null,
  context         text,                       -- optional extra detail (e.g. cohort description, date range)
  created_at      timestamptz not null default now()
);

create index if not exists saved_insights_org_created_idx
  on public.saved_insights (organization_id, created_at desc);

alter table public.saved_insights enable row level security;

drop policy if exists "Members can view org saved insights" on public.saved_insights;
create policy "Members can view org saved insights"
  on public.saved_insights for select
  using (exists (
    select 1 from public.organization_members
    where organization_id = saved_insights.organization_id and user_id = auth.uid()
  ));

drop policy if exists "Members can create saved insights" on public.saved_insights;
create policy "Members can create saved insights"
  on public.saved_insights for insert
  with check (exists (
    select 1 from public.organization_members
    where organization_id = saved_insights.organization_id and user_id = auth.uid()
  ));

drop policy if exists "Members can delete saved insights" on public.saved_insights;
create policy "Members can delete saved insights"
  on public.saved_insights for delete
  using (exists (
    select 1 from public.organization_members
    where organization_id = saved_insights.organization_id and user_id = auth.uid()
  ));
