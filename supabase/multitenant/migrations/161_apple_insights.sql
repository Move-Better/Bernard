-- Apple Business Connect — monthly Insights recap metrics (extract-only).
--
-- Tenants opt in by uploading the monthly Apple recap PDF (one per location).
-- The import handler (api/_routes/integrations/apple/import.js) parses the six
-- Core metrics + headline year-over-year and upserts one row per
-- (workspace, location, month). The source PDF is NEVER stored — we keep only
-- the extracted numbers for display and month-over-month tracking.

create table if not exists public.apple_insights (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  location_id   uuid references public.workspace_locations(id) on delete set null,
  location_label text,                 -- parsed "Name street City, ST ZIP" (display/verification only)
  period_month  date not null,         -- first day of the report month

  place_card_views integer,
  taps_from_search integer,
  directions       integer,
  photos           integer,
  website          integer,
  call             integer,

  views_yoy_pct numeric,               -- signed % (from "N% more/fewer views" sentence)
  taps_yoy_pct  numeric,               -- signed %

  raw_extract jsonb,                   -- full parse payload: interaction YoY, warnings, filename, parsedAt
  source      text not null default 'pdf_recap',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per workspace + location + month; re-uploading a month upserts.
-- NULLS NOT DISTINCT (PG15+) so single-location workspaces with a null
-- location_id still collapse to one row per month.
create unique index if not exists apple_insights_ws_loc_month_uidx
  on public.apple_insights (workspace_id, location_id, period_month)
  nulls not distinct;

create index if not exists apple_insights_ws_month_idx
  on public.apple_insights (workspace_id, period_month desc);

grant select, insert, update, delete on public.apple_insights to service_role;
grant usage on all sequences in schema public to service_role;
