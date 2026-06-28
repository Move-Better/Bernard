-- F6 Phase 2 — recency-weighted practice-memory retrieval.
--
-- Applied to prod via the Supabase SQL path on 2026-06-27 (this file is the
-- record). Two parts:
--   1. A source_date column on practice_memory_chunks. chunk.created_at is the
--      INSERT timestamp — the 2026-06-27 content backfill stamped weeks-old
--      content with "today", so created_at cannot drive recency. source_date
--      holds the SOURCE's authored date (interview date, content date, blog
--      doc_date) and is the substrate Phase 3 (supersession) will reuse.
--   2. match_practice_memory_chunks gains a retrieve-then-rerank shape: the
--      inner query still fetches top candidates by pure cosine (HNSW index),
--      then re-ranks by similarity * exponential recency-decay on source_date.
--      New p_half_life_days param (default 365, gentle): NULL/<=0 disables decay
--      so Author Mode retrieval doesn't down-rank a clinician's older blogs.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a NULL-guarded backfill + CREATE OR
-- REPLACE. Safe to re-run.

BEGIN;

ALTER TABLE public.practice_memory_chunks
  ADD COLUMN IF NOT EXISTS source_date timestamptz;

-- Backfill source_date from each chunk's source row (blogs/drafts use doc_date,
-- the real authored date, not the ingest timestamp). Orphaned sources stay NULL
-- and fall back to created_at at query time.
UPDATE public.practice_memory_chunks c SET source_date = i.created_at
  FROM public.interviews i
  WHERE c.source_id = i.id
    AND c.source_type IN ('interview_summary','interview_transcript_full')
    AND c.source_date IS NULL;

UPDATE public.practice_memory_chunks c SET source_date = ci.created_at
  FROM public.content_items ci
  WHERE c.source_id = ci.id AND c.source_type = 'content_item' AND c.source_date IS NULL;

UPDATE public.practice_memory_chunks c SET source_date = COALESCE(scd.doc_date, scd.created_at)
  FROM public.staff_corpus_documents scd
  WHERE c.source_id = scd.id
    AND c.source_type IN ('original_blog','uploaded_draft')
    AND c.source_date IS NULL;

-- Signature changes (adds p_half_life_days) → drop the old 6-arg form first.
DROP FUNCTION IF EXISTS public.match_practice_memory_chunks(uuid, uuid, vector, integer, uuid[], text[]);

CREATE FUNCTION public.match_practice_memory_chunks(
  p_workspace_id uuid, p_staff_id uuid, p_query_embedding vector,
  p_match_count integer DEFAULT 6, p_exclude_source_ids uuid[] DEFAULT '{}'::uuid[],
  p_source_types text[] DEFAULT NULL::text[], p_half_life_days integer DEFAULT 365)
RETURNS TABLE(id uuid, source_type text, source_id uuid, source_label text, text text, similarity double precision)
LANGUAGE sql STABLE AS $function$
  -- Inner: top candidates by pure cosine (uses the HNSW index). Outer: re-rank
  -- by similarity * exponential recency-decay on source_date (fallback created_at)
  -- so newer thinking wins ties. p_half_life_days NULL/<=0 disables decay.
  -- 4x overfetch lets recency reorder without dropping relevant-but-older chunks.
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
    ORDER BY c.embedding <=> p_query_embedding
    LIMIT GREATEST(p_match_count, 1) * 4
  )
  SELECT id, source_type, source_id, source_label, text, similarity
  FROM candidates
  ORDER BY similarity * CASE
      WHEN p_half_life_days IS NULL OR p_half_life_days <= 0 THEN 1.0
      ELSE exp( -0.6931471805599453  -- ln(2)
                * GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(source_date, created_at))) / 86400.0)
                / p_half_life_days ) END DESC
  LIMIT GREATEST(p_match_count, 1);
$function$;

GRANT EXECUTE ON FUNCTION public.match_practice_memory_chunks(uuid, uuid, vector, integer, uuid[], text[], integer) TO service_role;

COMMIT;
