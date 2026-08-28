-- 213 — blog_citations: verified, human-approved research citations for blog
-- and series-part content_items.
--
-- Per .claude/blog-research-citations-spec.md (feedback 1cd775a1 follow-up to
-- #2665, which removed the fabrication-inducing "find supporting research and
-- link it" instruction because blog generation runs with no retrieval tool).
--
-- Rows are proposed by the enrichment pass (api/_lib/citations/pipeline.js —
-- retrieval + content-level verification, see that file's header for how the
-- anti-fabrication invariant is enforced) and land here as 'suggested'. A
-- human reviews each in the publish editor; ONLY 'approved' rows are ever
-- inserted into a published post body (api/_lib/citations/insertCitations.js,
-- Phase 4). 'rejected' rows are KEPT, not deleted — this table doubles as the
-- audit trail of what was proposed and what a human accepted, per the spec's
-- "Data model" section.
--
-- One workspace_id column even though content_item_id already implies a
-- workspace, mirroring every other tenant-scoped table in this schema (see
-- clip_render_jobs, 212) — every API handler filters on workspace_id directly
-- rather than joining through content_items to prove tenant isolation.

CREATE TABLE IF NOT EXISTS public.blog_citations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_item_id   uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,

  -- The specific assertion this citation backs, and the verbatim substring of
  -- the post it was drawn from (for traceability — lets a reviewer see WHERE
  -- in the post this claim came from, not just what it says).
  claim_text        text NOT NULL,
  claim_quote       text NOT NULL DEFAULT '',

  -- Retrieval-sourced, never model-recalled — see pipeline.js. source_url is
  -- always a real URL a retrieval client actually returned (a real PMID, a
  -- real Semantic Scholar paper page, or a real web-search citation), filtered
  -- through the hard allowlist (api/_lib/citations/allowlist.js) before this
  -- row is ever written.
  source            text NOT NULL CHECK (source IN ('pubmed', 'semantic_scholar', 'web')),
  source_url        text NOT NULL,
  source_title      text,
  source_type       text, -- allowlist tier: peer_reviewed | major_institution | professional_guidelines | reputable_health_ed

  -- The judge's verdict (why + confidence) and the real fetched content it was
  -- judged against, kept for audit — a reviewer or a future re-check can see
  -- exactly what evidence justified the "supports" call.
  why_match         text NOT NULL DEFAULT '',
  confidence        numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  verify_evidence   text NOT NULL DEFAULT '',

  -- The human gate. 'suggested' → reviewer decides → 'approved' | 'rejected'.
  -- Publish only ever reads 'approved' rows for this content_item_id.
  status            text NOT NULL DEFAULT 'suggested'
                      CHECK (status IN ('suggested', 'approved', 'rejected')),
  decided_at        timestamptz,
  decided_by        text, -- Clerk user id of the reviewer; text (not a staff FK) since any workspace member with EDITOR_ROLES can decide, same identity shape as content_items.approved_by

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- The review panel's main query: all suggestions for one piece.
CREATE INDEX IF NOT EXISTS blog_citations_content_item_idx
  ON public.blog_citations (content_item_id, status);

-- Dedup guard for re-running enrichment on the same piece (the "find
-- supporting research" on-demand action, Phase 5) — never propose the exact
-- same source twice for the same piece, regardless of status.
CREATE UNIQUE INDEX IF NOT EXISTS blog_citations_content_item_source_url_idx
  ON public.blog_citations (content_item_id, source_url);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_citations TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
