-- AI Analyst conversations were purely client-side React state — refreshing
-- the page or navigating away lost everything, with no way to see what the
-- AI told you last week. This stores each conversation so it can be
-- reopened later, alongside who asked and when.

create table if not exists public.ai_conversations (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by      uuid references auth.users(id) on delete set null,
  title           text not null default 'New conversation',
  messages        jsonb not null default '[]',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ai_conversations_org_updated_idx
  on public.ai_conversations (organization_id, updated_at desc);

alter table public.ai_conversations enable row level security;

-- drop-then-create makes this script safe to paste and run more than once
-- (Postgres has no "create policy if not exists")
drop policy if exists "Members can view org AI conversations" on public.ai_conversations;
create policy "Members can view org AI conversations"
  on public.ai_conversations for select
  using (exists (
    select 1 from public.organization_members
    where organization_id = ai_conversations.organization_id and user_id = auth.uid()
  ));

drop policy if exists "Members can create AI conversations" on public.ai_conversations;
create policy "Members can create AI conversations"
  on public.ai_conversations for insert
  with check (exists (
    select 1 from public.organization_members
    where organization_id = ai_conversations.organization_id and user_id = auth.uid()
  ));

drop policy if exists "Members can update org AI conversations" on public.ai_conversations;
create policy "Members can update org AI conversations"
  on public.ai_conversations for update
  using (exists (
    select 1 from public.organization_members
    where organization_id = ai_conversations.organization_id and user_id = auth.uid()
  ));

drop policy if exists "Members can delete org AI conversations" on public.ai_conversations;
create policy "Members can delete org AI conversations"
  on public.ai_conversations for delete
  using (exists (
    select 1 from public.organization_members
    where organization_id = ai_conversations.organization_id and user_id = auth.uid()
  ));
