-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────
-- PROFILES  (mirrors auth.users)
-- ─────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  org_id   uuid;
  org_name text;
  org_slug text;
begin
  -- Insert profile
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  );

  -- Create organization if org_name was provided at signup
  org_name := coalesce(
    new.raw_user_meta_data->>'org_name',
    split_part(new.email, '@', 1) || '''s Org'
  );
  org_slug := lower(regexp_replace(org_name, '[^a-zA-Z0-9]', '-', 'g'));
  org_id   := uuid_generate_v4();

  insert into public.organizations (id, name, slug, owner_id)
  values (org_id, org_name, org_slug, new.id);

  -- Make the new user the owner
  insert into public.organization_members (organization_id, user_id, role)
  values (org_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────────
-- ORGANIZATIONS
-- ─────────────────────────────────────────────
create table if not exists public.organizations (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  owner_id    uuid not null references auth.users(id) on delete restrict,
  logo_url    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.organizations enable row level security;

create policy "Members can view their organization"
  on public.organizations for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_id = id
        and user_id = auth.uid()
    )
  );

create policy "Owners can update their organization"
  on public.organizations for update
  using (owner_id = auth.uid());

-- ─────────────────────────────────────────────
-- ORGANIZATION MEMBERS
-- ─────────────────────────────────────────────
create type if not exists public.member_role as enum ('owner', 'admin', 'member', 'viewer');

create table if not exists public.organization_members (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             public.member_role not null default 'member',
  created_at       timestamptz not null default now(),
  unique(organization_id, user_id)
);

alter table public.organization_members enable row level security;

create policy "Members can view their org members"
  on public.organization_members for select
  using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = organization_id
        and om.user_id = auth.uid()
    )
  );

create policy "Admins can manage members"
  on public.organization_members for all
  using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = organization_id
        and om.user_id = auth.uid()
        and om.role in ('owner', 'admin')
    )
  );

-- ─────────────────────────────────────────────
-- EVENTS
-- ─────────────────────────────────────────────
create table if not exists public.events (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  properties       jsonb not null default '{}',
  user_id          text,
  session_id       text,
  timestamp        timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create index on public.events (organization_id, timestamp desc);
create index on public.events (organization_id, name);

alter table public.events enable row level security;

create policy "Members can view org events"
  on public.events for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_id = events.organization_id
        and user_id = auth.uid()
    )
  );

create policy "Members can insert events"
  on public.events for insert
  with check (
    exists (
      select 1 from public.organization_members
      where organization_id = events.organization_id
        and user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────
-- UPDATED_AT trigger helper
-- ─────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

create trigger set_organizations_updated_at
  before update on public.organizations
  for each row execute procedure public.set_updated_at();
