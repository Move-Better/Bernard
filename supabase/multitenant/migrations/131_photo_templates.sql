-- Rename carousel-theme artifacts to photo-template equivalents.
-- Unifying single-photo and carousel slide templates into one system.
--
-- Safe to run multiple times (IF EXISTS / IF NOT EXISTS guards throughout).

-- 1. Rename the custom-templates table
ALTER TABLE IF EXISTS public.workspace_carousel_themes
  RENAME TO workspace_photo_templates;

-- 2. Rename the partial unique index
ALTER INDEX IF EXISTS uq_one_carousel_default_per_workspace
  RENAME TO uq_one_photo_template_default_per_workspace;

-- 3. Rename the column on content_items
ALTER TABLE public.content_items
  RENAME COLUMN carousel_theme_id TO photo_template_id;

-- 4. Grants (idempotent — covers the renamed table)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_photo_templates TO service_role;
