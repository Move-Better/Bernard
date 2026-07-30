-- 195_content_item_format.sql — explicit post format + provenance on content_items.
--
-- format: 'post' | 'carousel' | 'reel' | 'story' (nullable). NULL = legacy
-- derived behavior (any video on an instagram piece publishes as a Reel).
-- Making the format explicit is what lets a producer put a video INSIDE a
-- carousel (mixed photo+video, verified live against bundle.social 2026-07-29)
-- instead of every video hijacking the piece into a Reel.
--
-- format_source: 'bernard' | 'human' (nullable) — journals WHO chose the
-- format. This is deliberate day-one telemetry for the teach → run → check-in
-- confidence loop: a human override of Bernard's format choice is the learning
-- signal, so it must be recorded from the first shipped week, not bolted on.
--
-- No GRANT needed: content_items already grants service_role, and new columns
-- inherit table-level grants.

ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS format text;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS format_source text;

DO $$ BEGIN
  ALTER TABLE public.content_items ADD CONSTRAINT content_items_format_check
    CHECK (format IS NULL OR format = ANY (ARRAY['post','carousel','reel','story']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.content_items ADD CONSTRAINT content_items_format_source_check
    CHECK (format_source IS NULL OR format_source = ANY (ARRAY['bernard','human']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.content_items.format IS
  'Explicit publish format (post|carousel|reel|story). NULL = legacy derived (video on instagram => Reel). Vocabulary mirrors src/lib/platformFormats.js.';
COMMENT ON COLUMN public.content_items.format_source IS
  'Who chose format: bernard (drafter) or human (editor PATCH). Raw signal for the format-confidence loop.';
