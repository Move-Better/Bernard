-- F6 Phase 3 — supersession: newer thinking overrides older (clinician-confirmed).
--
-- Applied to prod via the Supabase SQL path on 2026-06-27 (this file is the record).
--   1. practice_memory_supersessions — candidate edges (old_chunk superseded by
--      new_chunk). A weekly cron (api/cron/detect-supersessions) runs the
--      conflict judge (api/_lib/supersessionJudge.js, validated 2026-06-27) over
--      same-staff newer/older high-similarity pairs and inserts `pending` rows.
--      The clinician confirms/rejects (one-tap); only `confirmed` edges suppress.
--      Denormalized source labels/excerpts so the confirm UI needs no joins.
--   2. match_practice_memory_chunks gains a suppression filter: chunks that are
--      the OLD side of a CONFIRMED supersession are excluded from retrieval.
--      pending/rejected edges have NO effect (recency P2 still gently down-weights).
--
-- Idempotent: IF NOT EXISTS + CREATE OR REPLACE.

BEGIN;

CREATE TABLE IF NOT EXISTS public.practice_memory_supersessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL,
  staff_id         uuid,
  old_chunk_id     uuid NOT NULL REFERENCES public.practice_memory_chunks(id) ON DELETE CASCADE,
  new_chunk_id     uuid NOT NULL REFERENCES public.practice_memory_chunks(id) ON DELETE CASCADE,
  old_source_id    uuid,
  new_source_id    uuid,
  old_source_label text,
  new_source_label text,
  old_excerpt      text,
  new_excerpt      text,
  relationship     text NOT NULL DEFAULT 'supersedes',
  confidence       double precision,
  rationale        text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  detected_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      text,
  UNIQUE (workspace_id, old_chunk_id, new_chunk_id)
);

CREATE INDEX IF NOT EXISTS pms_workspace_status_idx ON public.practice_memory_supersessions (workspace_id, status);
CREATE INDEX IF NOT EXISTS pms_old_chunk_confirmed_idx ON public.practice_memory_supersessions (old_chunk_id) WHERE status = 'confirmed';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_memory_supersessions TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Retrieval suppresses the OLD side of CONFIRMED supersessions (else unchanged
-- from migration 150's recency-weighted retrieve-then-rerank).
CREATE OR REPLACE FUNCTION public.match_practice_memory_chunks(
  p_workspace_id uuid, p_staff_id uuid, p_query_embedding vector,
  p_match_count integer DEFAULT 6, p_exclude_source_ids uuid[] DEFAULT '{}'::uuid[],
  p_source_types text[] DEFAULT NULL::text[], p_half_life_days integer DEFAULT 365)
RETURNS TABLE(id uuid, source_type text, source_id uuid, source_label text, text text, similarity double precision)
LANGUAGE sql STABLE AS $function$
  WITH candidates AS (
    SELECT c.id, c.source_type, c.source_id, c.source_label, c.text,
           c.source_date, c.created_at,
           1 - (c.embedding <=> p_query_embedding) AS similarity
    FROM public.practice_memory_chunks c
    WHERE c.workspace_id = p_workspace_id
      AND (p_staff_id IS NULL OR c.staff_id = p_staff_id)
      AND (p_source_types IS NULL OR c.source_type = ANY (p_source_types))
      AND c.embedding IS NOT NULL
      AND NOT (c.source_id = ANY (COALESCE(p_exclude_source_ids, '{}'::uuid[])))
      AND NOT EXISTS (SELECT 1 FROM public.practice_memory_supersessions s
                      WHERE s.old_chunk_id = c.id AND s.status = 'confirmed')
    ORDER BY c.embedding <=> p_query_embedding
    LIMIT GREATEST(p_match_count, 1) * 4
  )
  SELECT id, source_type, source_id, source_label, text, similarity
  FROM candidates
  ORDER BY similarity * CASE
      WHEN p_half_life_days IS NULL OR p_half_life_days <= 0 THEN 1.0
      ELSE exp( -0.6931471805599453
                * GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(source_date, created_at))) / 86400.0)
                / p_half_life_days ) END DESC
  LIMIT GREATEST(p_match_count, 1);
$function$;

GRANT EXECUTE ON FUNCTION public.match_practice_memory_chunks(uuid, uuid, vector, integer, uuid[], text[], integer) TO service_role;

COMMIT;
