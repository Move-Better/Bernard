-- 191_moments.sql
-- Moment bank (P2 of the moment-bank sprint, .claude/moment-bank-sprint.md).
--
-- An interview's long tail: 10-15 scored VERBATIM excerpts banked per
-- interview, deduplicated across the workspace via embedding clusters. The
-- weekly planner (P3) composes pieces on demand from EXEMPLAR moments only;
-- non-exemplars stay linked to their cluster but are never drawn.
--
-- staff_id is ON DELETE SET NULL deliberately (NOT cascade): a banked moment
-- is content inventory, not per-staff learning — deleting a staff row must not
-- silently destroy the workspace's bank. (Interview deletion DOES cascade:
-- the moment's verbatim anchor points into interviews.messages, so a moment
-- cannot outlive its transcript.) merge_staff below repoints moments as the
-- 13th staff_id table (plain repoint — no staff_id-bearing unique index).

CREATE TABLE IF NOT EXISTS public.moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  interview_id uuid NOT NULL REFERENCES public.interviews(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  excerpt text NOT NULL,                                  -- VERBATIM from interviews.messages
  anchor jsonb NOT NULL,                                  -- {msg_idx,char_start,char_end} or {t_start,t_end}
  clip_asset_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL, -- Lane A cut clip, if video
  hook text,                                              -- scroll-stopping one-liner (display + scoring)
  moment_type text,                                       -- scoreMoments.js taxonomy (coaching_cue, hook, ...)
  topic text,
  region text,
  tags text[],
  score int,                                              -- 0-100 at extraction
  embedding vector(1536),
  cluster_id uuid,                                        -- dedup cluster (self-assigned uuid per cluster)
  is_exemplar boolean NOT NULL DEFAULT true,              -- best-of-cluster; planner only draws exemplars
  status text NOT NULL DEFAULT 'banked'
    CHECK (status IN ('banked','retired')),               -- usage is a counter, not a status
  usage_count int NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  review_by date,                                         -- freshness/expiry pass
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moments_workspace_idx ON public.moments (workspace_id);
CREATE INDEX IF NOT EXISTS moments_interview_idx ON public.moments (interview_id);
CREATE INDEX IF NOT EXISTS moments_cluster_idx ON public.moments (cluster_id);
-- hnsw (not ivfflat): builds fine on an empty table and needs no re-train as
-- the bank grows — same call as practice_memory_chunks (migration 073).
CREATE INDEX IF NOT EXISTS moments_embedding_idx
  ON public.moments USING hnsw (embedding vector_cosine_ops);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.moments TO service_role;

-- Cosine-similarity RPC for dedup at ingest (PostgREST can't express `<=>`).
-- Mirrors match_visual_memory_chunks (migration 087). Matches banked rows only
-- — a retired moment shouldn't absorb a fresh near-duplicate into a dead
-- cluster.
CREATE OR REPLACE FUNCTION public.match_moments(
  p_workspace uuid,
  p_query_embedding vector(1536),
  p_match_count int DEFAULT 5,
  p_min_sim real DEFAULT 0.0
) RETURNS TABLE (
  id uuid,
  interview_id uuid,
  cluster_id uuid,
  is_exemplar boolean,
  score int,
  excerpt text,
  similarity real
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.id,
    m.interview_id,
    m.cluster_id,
    m.is_exemplar,
    m.score,
    m.excerpt,
    (1 - (m.embedding <=> p_query_embedding))::real AS similarity
  FROM public.moments m
  WHERE m.workspace_id = p_workspace
    AND m.status = 'banked'
    AND m.embedding IS NOT NULL
    AND (1 - (m.embedding <=> p_query_embedding))::real >= p_min_sim
  ORDER BY m.embedding <=> p_query_embedding
  LIMIT p_match_count
$$;

GRANT EXECUTE ON FUNCTION public.match_moments(uuid, vector, int, real) TO service_role;

-- merge_staff gains moments as its 13th staff_id repoint (plain repoint: no
-- staff_id-bearing unique index on moments). Full function re-stated from
-- migration 112 — CREATE OR REPLACE needs the whole body.
create or replace function public.merge_staff(
  p_source    uuid,
  p_target    uuid,
  p_workspace uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src_ws uuid;
  v_tgt_ws uuid;
begin
  if p_source = p_target then
    raise exception 'merge_staff: source and target are identical (%)', p_source;
  end if;

  select workspace_id into v_src_ws from staff where id = p_source;
  select workspace_id into v_tgt_ws from staff where id = p_target;
  if v_src_ws is null then raise exception 'merge_staff: source % not found', p_source; end if;
  if v_tgt_ws is null then raise exception 'merge_staff: target % not found', p_target; end if;
  if v_src_ws <> p_workspace or v_tgt_ws <> p_workspace then
    raise exception 'merge_staff: cross-workspace merge blocked (src ws %, tgt ws %, expected %)',
      v_src_ws, v_tgt_ws, p_workspace;
  end if;

  -- ── Collision-prone repoints: drop the source rows that would violate a
  --    (…, staff_id, …) unique index on the target, then move the rest. ──

  -- staff_voice_phrases — uniq (workspace_id, staff_id, phrase_normalized)
  delete from staff_voice_phrases s
   where s.staff_id = p_source
     and exists (
       select 1 from staff_voice_phrases t
        where t.staff_id = p_target
          and t.phrase_normalized = s.phrase_normalized
     );
  update staff_voice_phrases set staff_id = p_target where staff_id = p_source;

  -- staff_corpus_documents — uniq (workspace_id, staff_id, doc_type, title) where archived_at is null
  delete from staff_corpus_documents s
   where s.staff_id = p_source
     and s.archived_at is null
     and exists (
       select 1 from staff_corpus_documents t
        where t.staff_id = p_target
          and t.archived_at is null
          and t.doc_type = s.doc_type
          and t.title = s.title
     );
  update staff_corpus_documents set staff_id = p_target where staff_id = p_source;

  -- staff_recipes — one default per staff_id; also drop source recipes whose
  -- name already exists on the target so the merged row has no confusing
  -- duplicate-named recipes (matches scripts/merge-duplicate-staff.mjs).
  if exists (select 1 from staff_recipes where staff_id = p_target and is_default) then
    update staff_recipes set is_default = false where staff_id = p_source and is_default;
  end if;
  delete from staff_recipes s
   where s.staff_id = p_source
     and exists (
       select 1 from staff_recipes t
        where t.staff_id = p_target
          and lower(t.name) = lower(s.name)
     );
  update staff_recipes set staff_id = p_target where staff_id = p_source;

  -- ── Plain repoints (no staff_id-bearing unique index → no collision). ──
  update concept_mentions                set staff_id = p_target where staff_id = p_source;
  update content_items                   set staff_id = p_target where staff_id = p_source;
  update interviews                      set staff_id = p_target where staff_id = p_source;
  update media_assets                    set staff_id = p_target where staff_id = p_source;
  update moments                         set staff_id = p_target where staff_id = p_source;
  update practice_memory_chunks          set staff_id = p_target where staff_id = p_source;
  update story_packages                  set staff_id = p_target where staff_id = p_source;
  update video_segments                  set staff_id = p_target where staff_id = p_source;
  update visual_memory_chunks            set staff_id = p_target where staff_id = p_source;
  update workspace_onboarding_interviews set staff_id = p_target where staff_id = p_source;

  -- Denormalized uuid[] (no FK): replace source→target, then de-dup in case the
  -- target was already present in the same campaign's target list.
  update campaigns
     set target_staff_ids = (
       select array(select distinct x
                      from unnest(array_replace(target_staff_ids, p_source, p_target)) as x)
     )
   where p_source = any(target_staff_ids);

  -- Source now has zero references — safe to delete (no cascade can fire).
  delete from staff where id = p_source;
end;
$$;

grant execute on function public.merge_staff(uuid, uuid, uuid) to service_role;
