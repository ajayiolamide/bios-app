-- Enable RLS on public.users and public.organizations
-- These tables were public with no RLS — this fixes the security advisory.

alter table public.users enable row level security;
alter table public.organizations enable row level security;

-- Users: can only read/update/insert their own row
create policy "users_select_own" on public.users
  for select using (auth.uid() = id);

create policy "users_update_own" on public.users
  for update using (auth.uid() = id);

create policy "users_insert_own" on public.users
  for insert with check (auth.uid() = id);

-- Organizations: members can read their org via organization_members join
create policy "orgs_select_member" on public.organizations
  for select using (
    exists (
      select 1 from public.organization_members
      where organization_members.user_id = auth.uid()
        and organization_members.organization_id = organizations.id
    )
  );

create policy "orgs_update_owner" on public.organizations
  for update using (owner_id = auth.uid());

create policy "orgs_delete_owner" on public.organizations
  for delete using (owner_id = auth.uid());

create policy "orgs_insert_authenticated" on public.organizations
  for insert with check (auth.uid() = owner_id);
