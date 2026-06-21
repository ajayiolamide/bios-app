-- Amplitude connector — same shape as the Mixpanel columns added in
-- migration 011, just for a second analytics provider. Not wired into any
-- automatic pull yet (the org isn't using Amplitude today); this just gives
-- Settings somewhere to store credentials whenever they are ready to flip it
-- on, the same way Mixpanel's fields sat unused until they connected it.
alter table public.brand_settings add column if not exists amplitude_api_key text;
alter table public.brand_settings add column if not exists amplitude_secret_key text;
alter table public.brand_settings add column if not exists amplitude_data_region text not null default 'US';
-- High-water mark for the raw Export API, same role as mixpanel_raw_synced_until —
-- lets repeat syncs only pull what's new since the last successful run.
alter table public.brand_settings add column if not exists amplitude_raw_synced_until timestamptz;
