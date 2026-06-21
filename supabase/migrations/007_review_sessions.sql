-- ─────────────────────────────────────────────
-- Collaborative review sessions
-- Run this in Supabase SQL Editor
-- ─────────────────────────────────────────────

create table if not exists public.report_reviews (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.organizations(id) on delete cascade,
  deck_json       jsonb not null,
  deck_title      text not null,
  period          text not null,
  share_token     text not null unique,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  status          text not null default 'open' check (status in ('open', 'closed'))
);

create table if not exists public.slide_comments (
  id              uuid primary key default uuid_generate_v4(),
  review_id       uuid not null references public.report_reviews(id) on delete cascade,
  slide_index     int not null,
  reviewer_name   text not null default 'Reviewer',
  comment_text    text not null,
  resolved        boolean not null default false,
  created_at      timestamptz not null default now()
);

-- report_reviews: anyone can read by token (RLS off for service role reads, enabled for normal)
alter table public.report_reviews enable row level security;

create policy "Org members can create reviews"
  on public.report_reviews for insert
  with check (exists (
    select 1 from public.organization_members
    where organization_id = report_reviews.organization_id and user_id = auth.uid()
  ));

create policy "Org members can view their reviews"
  on public.report_reviews for select
  using (exists (
    select 1 from public.organization_members
    where organization_id = report_reviews.organization_id and user_id = auth.uid()
  ));

-- slide_comments: public insert (no auth needed — accessed via share token)
alter table public.slide_comments enable row level security;

create policy "Anyone can add comments"
  on public.slide_comments for insert
  with check (true);

create policy "Anyone can read comments"
  on public.slide_comments for select
  using (true);

create policy "Anyone can resolve comments"
  on public.slide_comments for update
  using (true);
