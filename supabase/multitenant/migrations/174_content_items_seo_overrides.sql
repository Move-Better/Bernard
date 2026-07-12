-- SEO title / meta description manual overrides for blog + landing_page.
-- api/publish/website.js already expects seoTitle/description in its publish
-- payload; today useContentWorkflow.js always auto-derives both client-side
-- (deriveSeoTitle(title), first body line capped at 200 chars) with no way
-- to override a bad auto-derived value. Nullable = auto-derive continues to
-- apply whenever these are unset.
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS seo_title text;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS meta_description text;
