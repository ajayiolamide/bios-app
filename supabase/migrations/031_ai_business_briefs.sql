-- The Overview page's "AI Business Brief" used to be pure client-side state:
-- generate it, and the moment you refresh or navigate away it's gone, with
-- no way to see what it said yesterday or last week. This stores every
-- generated brief so there's a real history with real dates, the same
-- pattern already used for AI Analyst conversations (ai_conversations).

create table if not exists public.ai_business_briefs (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by      uuid references auth.users(id) on delete set null,
  content         text not null,
  created_at      timestamptz not null default now()
);

create index if not exists ai_business_briefs_org_created_idx
  on public.ai_business_briefs (organization_id, created_at desc);

alter table public.ai_business_briefs enable row level security;

drop policy if exists "Members can view org AI briefs" on public.ai_business_briefs;
create policy "Members can view org AI briefs"
  on public.ai_business_briefs for select
  using (exists (
    select 1 from public.organization_members
    where organization_id = ai_business_briefs.organization_id and user_id = auth.uid()
  ));

drop policy if exists "Members can create AI briefs" on public.ai_business_briefs;
create policy "Members can create AI briefs"
  on public.ai_business_briefs for insert
  with check (exists (
    select 1 from public.organization_members
    where organization_id = ai_business_briefs.organization_id and user_id = auth.uid()
  ));
