-- Team invitations: allow org owners/admins to invite people by email.
-- Invited users land on /accept-invite?token=<uuid>, sign in/up, and are
-- added to the org with the specified role.

create table if not exists public.org_invitations (
  id           uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email        text not null,
  role         text not null check (role in ('admin', 'member', 'viewer')) default 'member',
  token        uuid not null default gen_random_uuid(),
  invited_by   uuid not null references auth.users(id) on delete cascade,
  expires_at   timestamptz not null default (now() + interval '7 days'),
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- Prevent duplicate pending invites for the same email within the same org
create unique index org_invitations_pending_unique
  on public.org_invitations (organization_id, lower(email))
  where accepted_at is null;

-- Fast token lookups (accept-invite page)
create index org_invitations_token_idx on public.org_invitations(token);
create index org_invitations_org_idx   on public.org_invitations(organization_id);

-- RLS: org members can view invitations for their workspace
alter table public.org_invitations enable row level security;

create policy "org_members_view_invitations" on public.org_invitations
  for select using (
    exists (
      select 1 from public.organization_members
      where organization_members.user_id = auth.uid()
        and organization_members.organization_id = org_invitations.organization_id
    )
  );
