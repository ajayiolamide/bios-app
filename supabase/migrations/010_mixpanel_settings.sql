-- Add Mixpanel connector fields to brand_settings

alter table public.brand_settings
  add column if not exists mixpanel_api_secret   text,
  add column if not exists mixpanel_project_id   text,
  add column if not exists mixpanel_data_region  text not null default 'US';
  -- mixpanel_data_region: 'US' | 'EU'
