-- 119_content_items_photo_treatment.sql
-- Photo compositor (P1): persist the AI/manual photo treatment spec and the
-- baked composite URL on a content item so the editor can re-render from the
-- original and the publish path ships the baked image.
--
--   photo_treatment      jsonb  — { sourceUrl, templateId, headline, headlineSize,
--                                   grade, aspect, scrim, ... } (re-render input)
--   photo_composite_url  text   — the last rendered/uploaded composite (Blob URL)
--
-- Columns inherit the existing table grants to service_role (the REST API used
-- by serverless functions); no new GRANT needed for an ALTER ... ADD COLUMN on
-- an already-granted table. Idempotent so it is safe to re-apply.

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS photo_treatment     jsonb,
  ADD COLUMN IF NOT EXISTS photo_composite_url text;
