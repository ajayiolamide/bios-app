alter table public.brand_settings
  add column if not exists mixpanel_username text;
