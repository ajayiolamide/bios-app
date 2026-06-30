-- Feature folders: allow grouping feature cards into named collapsible folders.

create table if not exists public.feature_folders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);

create index feature_folders_org_idx on public.feature_folders(organization_id);

alter table public.feature_folders enable row level security;

create policy "org_members_manage_folders" on public.feature_folders
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.user_id = auth.uid()
        and organization_members.organization_id = feature_folders.organization_id
    )
  );

-- Add folder_id column to feature_metrics
alter table public.feature_metrics
  add column if not exists folder_id uuid references public.feature_folders(id) on delete set null;

create index feature_metrics_folder_idx on public.feature_metrics(folder_id);
