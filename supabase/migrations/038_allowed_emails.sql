-- Invite-only access control.
-- Only emails in this table can create an account.
-- Add rows here (via Supabase dashboard or admin panel) to grant access.

create table if not exists public.allowed_emails (
  id         uuid primary key default uuid_generate_v4(),
  email      text not null unique,
  note       text,                          -- e.g. "Company A tester"
  invited_at timestamptz not null default now(),
  used       boolean not null default false -- flipped to true on first signup
);

-- No public access — checked server-side via admin client only
alter table public.allowed_emails enable row level security;

-- Pre-seed your own email so you can always sign in / create orgs
insert into public.allowed_emails (email, note)
values ('ajayiibrahimme@gmail.com', 'Owner')
on conflict (email) do nothing;
