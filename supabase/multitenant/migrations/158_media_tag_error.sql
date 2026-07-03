-- AI tagging moved off the synchronous request path (was hitting the 120s
-- function cap and 504ing on large videos, per the "Tagging failed — 504"
-- bug report 2026-07-03). The handler now flips status -> 'tagging' and
-- returns immediately; a waitUntil background job finishes the work and
-- either sets status -> 'tagged' or reverts status + records the failure
-- here so the UI can surface it instead of silently hanging.
ALTER TABLE public.media_assets ADD COLUMN IF NOT EXISTS tag_error text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO service_role;
