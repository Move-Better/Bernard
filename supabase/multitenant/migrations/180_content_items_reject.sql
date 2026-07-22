-- 180_content_items_reject.sql
--
-- T4 learning loop, part 1 — reject-with-reason.
--
-- Today a draft that's wrong can only be silently ignored or deleted; nothing
-- captures WHY, so Bernard repeats the same misses. This adds a real terminal
-- status ('rejected') plus a small fixed reason enum + optional free-text note,
-- captured from the piece editor at the moment staff reject.
--
-- Modeling choice:
--   * status='rejected' — content_items.status is free text with NO check
--     constraint (see migration 138), so the new value needs no DDL on status.
--     Validated at the API layer (api/_routes/db/content.js VALID_STATUSES),
--     matching the existing 'failed' status (migration 143).
--   * reject_reason — small fixed enum (wrong_visuals | wrong_words |
--     wrong_topic | wrong_timing | other), validated at the API layer rather
--     than a DB CHECK constraint, matching the project's status-validation
--     convention (no CHECK constraints on content_items anywhere today).
--   * reject_note — optional free text, shown verbatim in the weekly digest.
--   * rejected_at / rejected_by — mirrors approved_at/approved_by (032) and
--     words_approved_at/words_approved_by (173).

alter table public.content_items
  add column if not exists reject_reason text,
  add column if not exists reject_note   text,
  add column if not exists rejected_at   timestamptz,
  add column if not exists rejected_by   text;

comment on column public.content_items.reject_reason is
  'T4 learning loop: fixed reason enum staff picks when rejecting a draft (wrong_visuals | wrong_words | wrong_topic | wrong_timing | other). NULL unless status=rejected. Validated in api/_routes/db/content.js.';
comment on column public.content_items.reject_note is
  'T4 learning loop: optional free-text note accompanying a reject. NULL unless provided.';

-- New columns inherit the table's existing grants, but re-assert for parity
-- with the project's self-sufficient-migration convention (idempotent).
grant select, insert, update, delete on public.content_items to service_role;
