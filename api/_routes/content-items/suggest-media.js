// POST /api/content-items/suggest-media
//
// The media→content matcher (Phase P0). Given a content_items draft id, returns
// ranked media candidates (photos + whole videos) for the producer to one-click
// attach. This is the draft→media direction of the same searchClips brain that
// api/editorial/pull-clips.js points the other way (clip→content).
//
// Ranking is topic/semantic relevance + "what's literally shown" (the asset's
// ai_tags / visual_narrative, already embedded in visual_memory_chunks). Per the
// locked design decisions we deliberately do NOT rank or warn on clinician/face
// match — any face is on-brand, and weak matches are simply rejectable (the
// producer doesn't pick them).
//
// Photos already attached to the workspace's other recent pieces (last
// RECENT_EXCLUDE_LIMIT, by created_at) are excluded from results, so a
// recurring topic doesn't keep resurfacing the same identical top-ranked shot
// on every new draft — the underlying vector search is otherwise fully
// deterministic for a given query.
//
// Body:
//   { id: string }                  — content_items.id to suggest media for
//   { query: string }               — raw query override (manual "refine search")
//   optional: { k?, minScore?, kind? ('photo'|'video') }
//
// Auth: Clerk JWT + workspace org-id check (workspaceContext). Cross-workspace
// queries are impossible by construction — the draft fetch is filtered by
// workspace_id and searchClips is scoped to ws.id.
//
// Response 200: { query, model, workspaceId, clips: [...] }
// Errors: 400 (validation), 401/403 (auth), 404 (no workspace / draft), 500.
//
// NOTE: unlike pull-clips.js this is NOT gated on ws.video_pipeline_enabled —
// the photo path is the turnkey P0 win and must work regardless of that flag.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { searchClips } from '../../_lib/clipSearch.js'
import { buildDraftMatchQuery } from '../../_lib/draftMatchQuery.js'
import { mediaKindForDraft } from '../../_lib/platformMedia.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const DEFAULT_K = 8
// Permissive threshold: surface 3–5 options even for niche topics; the cards
// show similarity so the producer can judge, and weak picks are rejectable.
const DEFAULT_MIN_SCORE = 0.3

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  // --- Workspace + auth ---
  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  // --- Resolve the query ---
  const body = req.body || {}
  const id = body.id ? String(body.id) : null
  if (id && !UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })
  let query = body.query ? String(body.query).trim() : ''
  // The draft's platform AND its already-attached media together drive which
  // media kinds are valid to suggest (see `kind`, below) — platform alone can't
  // tell a Reel from a carousel, since both are stored as platform:'instagram'.
  // A caller may pass platform for a query-only call; the draft fetch overrides
  // it (and is the only way media_urls is known).
  let draft = { platform: body.platform ? String(body.platform) : null, media_urls: [] }

  // When an id is given (the common path), build the query from the draft.
  // The fetch is workspace-scoped, so a caller can't pull another tenant's row.
  if (id && !query) {
    const r = await sb(
      `content_items?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws.id}&select=id,topic,content,platform,media_urls&limit=1`,
    )
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      console.error(`[content-items/suggest-media] draft fetch failed ${r.status}: ${detail.slice(0, 200)}`)
      return res.status(500).json({ error: 'draft_fetch_failed' })
    }
    const rows = await r.json()
    const item = rows?.[0]
    if (!item) return res.status(404).json({ error: 'draft_not_found' })
    query = buildDraftMatchQuery(item)
    draft = { platform: item.platform || draft.platform, media_urls: item.media_urls }
  }

  if (!query) return res.status(400).json({ error: 'query_required' })
  if (query.length > 2000) query = query.slice(0, 2000)

  const k = Math.min(Math.max(parseInt(body.k, 10) || DEFAULT_K, 1), 50)
  // Default the kind from the draft so we never suggest media it can't use (no
  // photos for YouTube/TikTok; no raw video for a blog hero; and no photos for
  // an Instagram Reel, which is platform:'instagram' + a video, not a distinct
  // platform value — see mediaKindForDraft). An explicit body.kind still wins,
  // so a manual "show me photos" (the carousel strip, the Swap-photo panel)
  // keeps working on any draft.
  const kind = body.kind && ['photo', 'video'].includes(body.kind)
    ? body.kind
    : mediaKindForDraft(draft)
  const minScore = typeof body.minScore === 'number'
    ? Math.min(Math.max(body.minScore, 0), 1)
    : DEFAULT_MIN_SCORE

  // --- Search the workspace's visual memory via the shared helper ---
  //
  // This route used to hard-exclude every asset appearing on the 20 most recent
  // pieces, to stop a recurring topic resurfacing the same top-ranked shot. That
  // was a blunt instrument: it could remove the ONLY good match for a topic and
  // leave nothing but weak alternatives, and it was invisible — a suggestion
  // that never appears can't be judged. searchClips now applies a proportional
  // freshness discount instead, which handles the same problem without ever
  // making a good option unreachable.
  let clips
  try {
    clips = await searchClips({ query, workspaceId: ws.id, k, kind, minScore })
  } catch (e) {
    console.error('[content-items/suggest-media] search failed:', e?.message)
    return res.status(500).json({ error: 'search_failed'})
  }

  // `clips` already carry `usage` — searchClips attaches it, because it now
  // ranks on it (see the freshness notes in clipSearch.js). This route used to
  // do its own usage lookup on top; that duplicate was removed when the ranking
  // moved into the shared helper, so the counter and the ordering can never
  // disagree about how used an asset is.
  return res.status(200).json({
    query,
    model: 'text-embedding-3-small',
    workspaceId: ws.id,
    clips,
  })
}
