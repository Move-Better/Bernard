-- 181_content_items_edit_diff.sql
--
-- T4 learning loop, part 2 — edit-diff mining.
--
-- content_items.ai_original_content (migration 025) already captures the
-- AI-drafted body alongside the staff-edited `content`, but the diff between
-- them was never computed or looked at — the richest free signal Bernard has
-- (what staff actually change before approving) was discarded. This adds a
-- place to persist the computed diff.
--
-- edit_diff is written once per approve transition (api/_routes/db/content.js,
-- api/_lib/editDiffMining.js) — a structured summary (length delta, removed/
-- added phrase excerpts, hashtag/link changes), NOT the full diff object graph.
-- NULL when ai_original_content is absent or identical to content (no edit
-- happened). Surfaced in the weekly "Bernard learned" digest only — not read
-- by any generation path yet (see .claude/decisions.md 2026-07-21 T4 scoping).

alter table public.content_items
  add column if not exists edit_diff jsonb;

comment on column public.content_items.edit_diff is
  'T4 learning loop: computed diff between ai_original_content and content at approve time (computeEditDiff in api/_lib/editDiffMining.js). NULL if no edit occurred. Digest-only today — not read by generation.';

-- New column inherits the table's existing grants, but re-assert for parity
-- with the project's self-sufficient-migration convention (idempotent).
grant select, insert, update, delete on public.content_items to service_role;
