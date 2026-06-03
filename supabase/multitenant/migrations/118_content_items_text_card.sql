-- Text Post Studio (Option B), Phase 1.
--
-- A "text card" is a branded text-only post image baked from headline/subtext/
-- CTA blocks on a brand-colored background (no photo). The baked JPEG is
-- attached to content_items.media_urls like any other photo (the publish path
-- is unchanged). This column stores the *editable* studio state so the user can
-- re-open the studio and tweak the card later.
--
-- Shape (JSONB):
--   {
--     "layout":     "quote" | "stat" | "announce" | "cta",
--     "theme_id":   "<carousel theme slug/uuid>",
--     "background": { "preset": "brand"|"warm"|"light"|"white" } | { "type": "solid", "color": "#.." },
--     "blocks":     [ { "role": "hook"|"body"|"cta", "text": "..", "position": {"x":..,"y":..} } ],
--     "logo":       true|false
--   }
-- NULL = this post is not a studio-built text card (the common case).

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS text_card jsonb;

-- No new table/sequence/function, so the existing service_role grants on
-- content_items already cover this column. (REST selects/updates the row.)
