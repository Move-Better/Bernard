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
// Reuse is handled two ways. Workspace-wide, all-time reuse is a soft
// discount applied inside searchClips (clipSearch.js) — a heavily-used asset
// ranks lower but can still win if it's the clearly best match. Within the
// SAME plan week and SAME platform, reuse is a hard exclusion instead (see
// the plan_week lookup below): every post for a platform in a given week gets
// a distinct photo, full stop, because a topically-strong match can easily
// beat the soft discount 2-3 times in one week (2026-07-28).
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

  // --- Same-platform, same-week exclusion (Q, 2026-07-28) ---
  //
  // The freshness discount above is soft and workspace-wide — it doesn't stop
  // a strong topical match from winning 2-3 posts in the same week. Q's call:
  // no repeats within a platform's own posts for the week (e.g. every
  // Instagram post this week uses a different photo), so this is a hard
  // exclusion, scoped to the draft's plan_week + platform, not a discount.
  //
  // Only applies when the draft is actually on the plan board (has a linked
  // content_plan_atoms row with a plan_week) — an ad-hoc/unscheduled draft has
  // no week to scope against, so it falls back to the plain freshness ranking.
  let excludeAssetIds = null
  if (id && draft.platform) {
    try {
      const weekRes = await sb(
        `content_plan_atoms?workspace_id=eq.${ws.id}&content_piece_id=eq.${encodeURIComponent(id)}` +
        `&select=plan_week&limit=1`,
      )
      const planWeek = weekRes.ok ? (await weekRes.json())?.[0]?.plan_week : null
      if (planWeek) {
        const siblingsRes = await sb(
          `content_plan_atoms?workspace_id=eq.${ws.id}&plan_week=eq.${encodeURIComponent(planWeek)}` +
          `&platform=eq.${encodeURIComponent(draft.platform)}&content_piece_id=not.is.null` +
          `&select=content_piece_id,content_item:content_items!content_piece_id(media_urls)`,
        )
        if (siblingsRes.ok) {
          const siblings = await siblingsRes.json()
          const ids = new Set()
          for (const s of Array.isArray(siblings) ? siblings : []) {
            if (s.content_piece_id === id) continue // don't exclude the draft's own already-attached media
            const urls = Array.isArray(s.content_item?.media_urls) ? s.content_item.media_urls : []
            for (const m of urls) {
              if (m?.mediaAssetId) ids.add(m.mediaAssetId)
            }
          }
          if (ids.size) excludeAssetIds = ids
        } else {
          console.error('[content-items/suggest-media] week-sibling lookup failed:', siblingsRes.status)
        }
      }
    } catch (e) {
      // Best-effort: a failed week-scoping lookup falls back to the plain
      // freshness ranking rather than failing the whole suggestion request.
      console.error('[content-items/suggest-media] week-scope exclusion failed:', e?.message)
    }
  }

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
  // This route once hard-excluded every asset on the 20 most recent pieces
  // workspace-wide, found to be a blunt instrument (it could remove the ONLY
  // good match for a topic) and replaced with searchClips' proportional
  // freshness discount. excludeAssetIds (above) reintroduces a hard exclusion,
  // but narrowly scoped to this platform's OTHER posts in this same plan
  // week — small enough a set that it can't strand a topic with nothing but
  // weak alternatives, since it's never excluding more than a handful of
  // recent same-week, same-platform picks.
  let clips
  try {
    clips = await searchClips({ query, workspaceId: ws.id, k, kind, minScore, excludeAssetIds })
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
