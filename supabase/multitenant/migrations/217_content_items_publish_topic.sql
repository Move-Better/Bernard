-- 217_content_items_publish_topic.sql
--
-- Records HOW a blog post's receiver topic was chosen at publish time, so the
-- monthly topic review can list the guesses instead of someone hunting through
-- frontmatter. Shape: { topic, via, confidence, raw, at }
--   via: 'exact' | 'alias' | 'phrase' | 'keyword' | 'classifier' | 'fallback'
-- Review queue = via in ('classifier','fallback') and no reviewed_at.
-- Written server-side only (api/publish/website.js), never through the PATCH
-- allowlist. Existing table, so no new grants are needed.

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS publish_topic jsonb;
