-- 160_answers_display_order.sql
-- Index sort position for the public answer library (movebetter.co /answers).
-- Named display_order (NOT "order") to avoid the SQL reserved word AND the
-- collision with PostgREST's `order=` sort query param. Carried in the publish
-- payload so a published answer keeps its place in the /answers list.
ALTER TABLE public.answers ADD COLUMN IF NOT EXISTS display_order int;
