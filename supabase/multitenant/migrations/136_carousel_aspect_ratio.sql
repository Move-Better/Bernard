-- Carousel output-format selector (Phase 2 aspect-adaptive editor).
-- Stores which aspect the carousel was designed for so the bake + publish
-- use the right pixel dimensions. Defaults to '4:5' (existing behaviour).
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS aspect_ratio text DEFAULT '4:5';

ALTER TABLE public.content_items
  DROP CONSTRAINT IF EXISTS content_items_aspect_ratio_check;

ALTER TABLE public.content_items
  ADD CONSTRAINT content_items_aspect_ratio_check
  CHECK (aspect_ratio IN ('1:1', '4:5', '9:16'));
