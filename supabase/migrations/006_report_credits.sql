-- ─────────────────────────────────────────────
-- Add credit tracking + slide count to reports
-- Run this in Supabase SQL Editor
-- ─────────────────────────────────────────────

alter table public.reports
  add column if not exists tokens_used  integer not null default 0,
  add column if not exists slides_count integer not null default 0,
  add column if not exists ai_model     text;
