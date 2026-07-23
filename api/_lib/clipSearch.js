// Shared clip-search helper for the Phase 2 Day 6-8 editorial pipeline.
//
// Both pull-clips (human-in-the-loop search) and generate-package (automated
// best-clip selection) need the same embed → RPC flow. This module centralises
// that logic so it doesn't need to be duplicated or maintained in two places.
//
// Callers: api/editorial/pull-clips.js, api/editorial/generate-package.js

import { embedTexts } from './embeddings.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// ── Freshness ranking ────────────────────────────────────────────────────────
//
// Similarity alone makes the picker deterministic in the worst way: the single
// best-matching shot for a recurring topic wins EVERY time it comes up, so one
// photo ends up on nine posts about the same condition while equally good
// alternatives never surface. generate-package takes top-1 with no reuse
// awareness at all, so its choice is fully repeatable.
//
// So rank on similarity discounted by how much the asset has already been used
// (the media_asset_usage view, migration 185). Deliberately a soft penalty, not
// a hard exclusion: when one shot really is the only good match for a topic,
// it should still win — it just has to be meaningfully better to keep winning.
//
// A published use counts double an unpublished one: a photo sitting in three
// drafts has not actually been in front of the audience three times, so it
// shouldn't be discounted as if it had.
const PENALTY_PER_USE = 0.05
const MAX_PENALTY     = 0.30
const DRAFT_WEIGHT    = 0.5

// The multiplier applied to an asset's similarity. 0 uses → 1.0 (untouched);
// the floor is 0.70, so a heavily-reused asset still wins when it is >~43%
// more relevant than the next option.
export function freshnessMultiplier(usage) {
  const published = Number(usage?.published) || 0
  const total     = Number(usage?.total) || 0
  const drafts    = Math.max(total - published, 0)
  const weighted  = published + drafts * DRAFT_WEIGHT
  return 1 - Math.min(weighted * PENALTY_PER_USE, MAX_PENALTY)
}

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

/**
 * Search the workspace's visual memory for clips relevant to a topic.
 *
 * @param {Object} params
 * @param {string} params.query           — topic / prompt text
 * @param {string} params.workspaceId     — workspace to scope the search to
 * @param {number} [params.k=8]           — max clips to return (capped at 50)
 * @param {string} [params.kind]          — 'photo' | 'video' | null (= any)
 * @param {number} [params.minScore=0.5]  — cosine similarity threshold
 * @param {string} [params.staffId]   — optional clinician-scoped search
 * @param {boolean} [params.preferFresh=true] — discount already-used assets so
 *   a recurring topic stops resolving to the same shot every time. See the
 *   freshness notes above. Pass false for a pure-similarity search.
 *
 * @returns {Promise<Array>} shaped clip objects (camelCase), each carrying
 *   `usage` ({ total, published }) and the `effectiveScore` it was ranked on.
 * @throws on embed failure or RPC failure
 */
export async function searchClips({
  query,
  workspaceId,
  k = 8,
  kind = null,
  minScore = 0.5,
  staffId = null,
  preferFresh = true,
}) {
  // Embed the query text
  const [queryEmbedding] = await embedTexts([query])
  if (!queryEmbedding || queryEmbedding.length !== 1536) {
    throw new Error('embedding_dim_mismatch')
  }

  const boundedK = Math.max(k, 1)
  // When ranking on freshness, over-fetch a real CANDIDATE POOL: re-ranking k
  // rows can only reorder the same k assets, it can never swap a tired one out
  // for a fresh alternative. That matters most exactly where the reuse problem
  // is worst — generate-package asks for k=1, so without a pool it would
  // re-rank a single candidate against itself and change nothing.
  const poolK = preferFresh ? Math.max(boundedK * 3, boundedK + 10) : boundedK
  const matchCount = Math.min(poolK, 50)

  // Call match_visual_memory_chunks RPC
  const rpcRes = await sb('rpc/match_visual_memory_chunks', {
    method: 'POST',
    body: JSON.stringify({
      query_embedding: queryEmbedding,
      match_count: matchCount,
      filter_workspace_id: workspaceId,
      filter_kind: kind || null,
      filter_min_score: minScore,
      filter_staff_id: staffId || null,
    }),
  })

  if (!rpcRes.ok) {
    const errText = await rpcRes.text().catch(() => '')
    throw new Error(`match_rpc_failed: ${rpcRes.status} ${errText.slice(0, 200)}`)
  }

  const rows = await rpcRes.json()

  // Usage is fetched regardless of preferFresh, because callers RENDER it (the
  // picker badges every tile from this field). Gating the lookup on the ranking
  // flag would hand a preferFresh:false caller a fabricated `{total: 0}` that is
  // indistinguishable from a genuinely unused asset — i.e. a confident "never
  // used" on a photo that has been out five times. preferFresh controls the
  // ORDER only; the counts are always real.
  const usageById = await fetchUsage(workspaceId, rows.map((r) => r.source_id))

  const ranked = rows
    .map((r) => {
      const usage = usageById.get(r.source_id) || { total: 0, published: 0 }
      const similarity = r.similarity ?? 0
      return {
        row: r,
        usage,
        effectiveScore: preferFresh ? similarity * freshnessMultiplier(usage) : similarity,
      }
    })
    .sort((a, b) => b.effectiveScore - a.effectiveScore)

  return ranked.slice(0, boundedK).map(({ row: r, usage, effectiveScore }) => ({
    chunkId:         r.chunk_id,
    assetId:         r.source_id,
    similarity:      r.similarity,
    kind:            r.asset_kind,
    blobUrl:         r.asset_blob_url,
    thumbnailUrl:    r.asset_thumbnail_url,
    filename:        r.asset_filename,
    durationS:       r.asset_duration_s,
    aspectRatio:     r.asset_aspect_ratio,
    capturedAt:      r.asset_captured_at,
    visualNarrative: r.asset_visual_narrative,
    aiTags:          r.asset_ai_tags,
    audioQuality:    r.audio_quality,
    videoQuality:    r.video_quality,
    storyRole:       r.story_role,
    staffId:         r.staff_id,
    displayTitle:    r.asset_display_title || null,
    usage,
    effectiveScore,
  }))
}

// Reuse counts for a set of candidate assets, from the media_asset_usage view
// (migration 185). Best-effort: if the lookup fails every asset reads as unused
// and ranking falls back to pure similarity — the same behavior as before this
// existed, which is a safe degradation rather than a failed search.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function fetchUsage(workspaceId, assetIds) {
  const byId = new Map()
  const ids = [...new Set((assetIds || []).filter((v) => UUID_RE.test(v || '')))]
  if (ids.length === 0) return byId

  try {
    const r = await sb(
      `media_asset_usage?select=asset_id,use_count,published_count` +
      `&workspace_id=eq.${workspaceId}&asset_id=in.(${ids.map(encodeURIComponent).join(',')})`
    )
    if (!r.ok) {
      console.error('[clipSearch] usage lookup failed:', r.status)
      return byId
    }
    for (const u of await r.json()) {
      byId.set(u.asset_id, { total: u.use_count || 0, published: u.published_count || 0 })
    }
  } catch (e) {
    console.error('[clipSearch] usage lookup failed:', e?.message)
  }
  return byId
}
