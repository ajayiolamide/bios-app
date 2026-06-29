-- Enable RLS on public.users and public.organizations
-- These tables were public with no RLS — this fixes the security advisory.

alter table public.users enable row level security;
alter table public.organizations enable row level security;

-- Users: can only read/update their own row
create policy "users_select_own" on public.users
  for select using (auth.uid() = id);

create policy "users_update_own" on public.users
  for update using (auth.uid() = id);

-- Organizations: members can read their org; only owner can update/delete
create policy "orgs_select_member" on public.organizations
  for select using (
    exists (
      select 1 from public.users
      where users.id = auth.uid()
        and users.organization_id = organizations.id
    )
  );

create policy "orgs_update_owner" on public.organizations
  for update using (owner_id = auth.uid());

create policy "orgs_delete_owner" on public.organizations
  for delete using (owner_id = auth.uid());

-- Allow insert during org creation (the server action uses service role, so this is for completeness)
create policy "orgs_insert_authenticated" on public.organizations
  for insert with check (auth.uid() = owner_id);
