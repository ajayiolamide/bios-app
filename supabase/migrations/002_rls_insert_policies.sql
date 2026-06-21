-- ─────────────────────────────────────────────
-- FIX: Add missing INSERT policies
-- Run this in Supabase SQL Editor if you already ran 001_initial.sql
-- ─────────────────────────────────────────────

-- Allow authenticated users to create their own organization
create policy "Authenticated users can create organizations"
  on public.organizations for insert
  with check (auth.uid() = owner_id);

-- Allow a user to add themselves as the initial owner member
-- (subsequent member adds are controlled by the existing "Admins can manage" policy)
create policy "Users can join as owner on org creation"
  on public.organization_members for insert
  with check (auth.uid() = user_id AND role = 'owner');

-- Allow members to see their own membership row directly (avoids self-referential policy issues)
create policy "Users can view own membership"
  on public.organization_members for select
  using (auth.uid() = user_id);
