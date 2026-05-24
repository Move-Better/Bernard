-- Phase 5 Feature 2 PR3 RAG — retrieval RPC.
--
-- PostgREST exposes table CRUD but not vector ops; expose retrieval via a
-- stored function the practice-memory resolver calls through /rest/v1/rpc/.
--
-- Returns the top-K chunks closest to the query embedding for a workspace,
-- optionally filtered by clinician_id and excluding caller-specified source
-- IDs (used to dedupe against rows already in the hot-tier block).

CREATE OR REPLACE FUNCTION public.match_practice_memory_chunks(
  p_workspace_id        uuid,
  p_clinician_id        uuid,
  p_query_embedding     vector(1536),
  p_match_count         int      DEFAULT 6,
  p_exclude_source_ids  uuid[]   DEFAULT '{}'::uuid[]
)
RETURNS TABLE (
  id            uuid,
  source_type   text,
  source_id     uuid,
  source_label  text,
  text          text,
  similarity    float
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    c.source_type,
    c.source_id,
    c.source_label,
    c.text,
    1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM public.practice_memory_chunks c
  WHERE c.workspace_id = p_workspace_id
    AND (p_clinician_id IS NULL OR c.clinician_id = p_clinician_id)
    AND c.embedding IS NOT NULL
    AND NOT (c.source_id = ANY (COALESCE(p_exclude_source_ids, '{}'::uuid[])))
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT GREATEST(p_match_count, 1);
$$;

GRANT EXECUTE ON FUNCTION public.match_practice_memory_chunks(uuid, uuid, vector, int, uuid[]) TO service_role;
