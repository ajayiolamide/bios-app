-- Real "Business Goal" layer above the existing business_goals table.
--
-- Until now, "business_goals" has actually been doing double duty as both
-- the company-wide objective ("grow revenue this quarter") AND the narrower
-- sub-goals product sets to move it ("improve onboarding CSAT"). That's the
-- exact confusion flagged in-app: there was no real, separate place to hold
-- the one big company goal that the ~5 product sub-goals ladder up to.
--
-- This migration adds that missing top layer as its own table —
-- company_objectives — and links the existing business_goals rows to it via
-- an optional company_objective_id. Nothing existing is renamed or removed,
-- so no other table/action/page that already references business_goals
-- breaks. The UI layer treats business_goals as "Product Goals" going
-- forward; the underlying table name is left alone to avoid a much riskier
-- rename across every feature_metrics/metrics query that already points at
-- "business_goals".

create table if not exists public.company_objectives (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  created_by      uuid,

  title           text        not null,           -- "Grow policy activations & retention"
  description     text,                            -- optional longer context
  target          text,                            -- "98% activation, NPS 58+"
  timeframe       text,                             -- "Q2 2026" | "Annual 2026"

  status          text        not null default 'active',
    -- "active" | "achieved" | "missed" | "dropped"

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.company_objectives enable row level security;

create policy "org members can manage company objectives"
  on public.company_objectives for all
  using (
    organization_id in (
      select organization_id from public.organization_members where user_id = auth.uid()
    )
  )
  with check (
    organization_id in (
      select organization_id from public.organization_members where user_id = auth.uid()
    )
  );

drop trigger if exists company_objectives_updated_at on public.company_objectives;
create trigger company_objectives_updated_at
  before update on public.company_objectives
  for each row execute procedure public.set_updated_at();

-- Link existing business_goals (= "Product Goals" in the UI) up to the
-- company objective they ladder up to. Nullable — existing rows and new
-- ones can stay unlinked until someone assigns them.
alter table public.business_goals
  add column if not exists company_objective_id uuid references public.company_objectives(id) on delete set null;
