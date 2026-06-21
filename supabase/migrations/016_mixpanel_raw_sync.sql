-- High-water mark for the scoped Mixpanel raw-event sync, so repeated manual
-- syncs only pull events since the last successful sync instead of re-fetching
-- the whole window every time.

alter table public.brand_settings
  add column if not exists mixpanel_raw_synced_until timestamptz default null;
