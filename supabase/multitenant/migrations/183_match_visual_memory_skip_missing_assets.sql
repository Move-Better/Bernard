-- 183_match_visual_memory_skip_missing_assets.sql
--
-- Fix: archived/deleted media assets still came back as suggestion candidates.
--
-- The LEFT JOIN added in 128 attaches asset columns only when the asset exists
-- and is un-archived — but a chunk whose asset is archived (or whose asset row
-- is gone entirely) still satisfies the WHERE clause. It returns with every
-- asset field NULL: no kind, no blob_url, no filename. That consumes one of the
-- caller's `match_count` slots and reaches the client as a blank card, pushing
-- a real candidate out of the results.
--
-- Only bites when filter_kind IS NULL, because `m.kind = filter_kind` already
-- discards NULL-asset rows when a kind filter is passed. So it hit exactly the
-- common path: instagram / facebook / gbp / linkedin drafts, which accept both
-- photo and video and therefore pass no kind filter (see platformMedia.js).
--
-- Observed on movebetter 2026-07-22: 17 of 981 embedded chunks were affected
-- (15 pointing at archived assets, 2 fully orphaned), and one surfaced at rank
-- 6 of 8 on a live LinkedIn draft, ahead of two real candidates.
--
-- Fix is the added guard in the WHERE clause. Deliberately NOT a plain INNER
-- JOIN: source_type is a general column and the join is already conditioned on
-- source_type = 'media_asset', so an INNER JOIN would silently drop any future
-- non-media_asset chunk. The guard only requires a matched asset for rows that
-- claim to BE a media_asset.
--
-- Signature and return columns are unchanged from 128; no caller is affected.

DROP FUNCTION IF EXISTS public.match_visual_memory_chunks(vector, integer, uuid, text, real, uuid);
CREATE FUNCTION public.match_visual_memory_chunks(
  query_embedding vector, match_count integer DEFAULT 8, filter_workspace_id uuid DEFAULT NULL::uuid,
  filter_kind text DEFAULT NULL::text, filter_min_score real DEFAULT 0.0, filter_staff_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(chunk_id uuid, workspace_id uuid, staff_id uuid, source_type text, source_id uuid,
  source_blob_url text, chunk_tags jsonb, audio_quality real, video_quality real, story_role text,
  similarity real, asset_kind text, asset_blob_url text, asset_thumbnail_url text, asset_filename text,
  asset_duration_s numeric, asset_aspect_ratio text, asset_visual_narrative text, asset_ai_tags jsonb,
  asset_captured_at timestamp with time zone, asset_display_title text)
LANGUAGE sql STABLE AS $function$
  SELECT v.id AS chunk_id, v.workspace_id, v.staff_id, v.source_type, v.source_id, v.source_blob_url,
    v.tags AS chunk_tags, v.audio_quality, v.video_quality, v.story_role,
    (1 - (v.embedding <=> query_embedding))::real AS similarity,
    m.kind AS asset_kind, m.blob_url AS asset_blob_url, m.thumbnail_url AS asset_thumbnail_url,
    m.filename AS asset_filename, m.duration_s AS asset_duration_s, m.aspect_ratio AS asset_aspect_ratio,
    m.visual_narrative AS asset_visual_narrative, m.ai_tags AS asset_ai_tags, m.captured_at AS asset_captured_at,
    m.display_title AS asset_display_title
  FROM public.visual_memory_chunks v
  LEFT JOIN public.media_assets m ON m.id = v.source_id AND v.source_type = 'media_asset' AND m.archived_at IS NULL
  WHERE v.embedding IS NOT NULL
    -- A chunk that claims to be a media_asset must have a live, un-archived one.
    AND (v.source_type <> 'media_asset' OR m.id IS NOT NULL)
    AND (filter_workspace_id IS NULL OR v.workspace_id = filter_workspace_id)
    AND (filter_kind IS NULL OR m.kind = filter_kind)
    AND (filter_staff_id IS NULL OR v.staff_id = filter_staff_id)
    AND (1 - (v.embedding <=> query_embedding))::real >= filter_min_score
  ORDER BY v.embedding <=> query_embedding
  LIMIT match_count;
$function$;

GRANT EXECUTE ON FUNCTION public.match_visual_memory_chunks(vector, integer, uuid, text, real, uuid) TO service_role;
