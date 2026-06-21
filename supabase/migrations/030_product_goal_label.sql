-- White-label terminology: lets an org rename what the UI calls the
-- sub-goal layer under a Business Goal (e.g. "Initiative", "Workstream",
-- "OKR") instead of the hardcoded "Product Goal" — needed for reselling
-- this platform under someone else's brand/vocabulary.
alter table public.organizations
  add column if not exists product_goal_label text not null default 'Product Goal';
