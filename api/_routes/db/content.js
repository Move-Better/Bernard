// Pinned to Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
// Uses Express-style (req, res) handler — the Web-style (req) → Response
// pattern silently hangs on Vercel's Node runtime (response never sent;
// function times out at 300s). Match the convention used by /api/content-pieces/*.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { extractConcepts } from '../../_lib/conceptExtractor.js'
import { extractVoicePhrases } from '../../_lib/voicePhraseExtractor.js'
import { indexContentItem } from '../../_lib/practiceMemoryRag.js'
import { waitUntil } from '@vercel/functions'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Allowlists for query-param values interpolated into PostgREST query strings.
// Without these, a crafted value like `draft,approved)&limit=10000` would break
// out of the intended clause and override server-side constraints.
const VALID_STATUSES  = new Set(['draft', 'in_review', 'approved', 'published', 'scheduled'])
const VALID_PLATFORMS = new Set([
  // atom-namespace keys (ATOM_DEFINITIONS in api/_lib/atomPlan.js)
  'instagram', 'linkedin', 'facebook', 'gbp', 'tiktok', 'twitter',
  'threads', 'bluesky', 'mastodon',
  // single-output platforms
  'blog', 'email', 'landing_page', 'youtube', 'youtube_short',
  'google_ads', 'instagram_ads', 'ig_ads', 'instagram_post', 'instagram_reel',
])

const MAX_LIMIT = 100

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Accepts a date (YYYY-MM-DD) or a full ISO timestamp. Guards the from/to
// range filters so a garbage value (e.g. `from=is.null`) can't reach PostgREST
// and surface as an opaque 500.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/

function sb(path, init = {}) {
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

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

// Log a Supabase non-ok response body to function logs and return a generic
// 500 to the client. Public response stays opaque (no schema leak); details
// land in Vercel logs so the next "Database error" report is one log fetch
// away from a root cause.
async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[db/content] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

const SELECT = 'id,interview_id,brief_id,staff_id,staff_name,topic,platform,content,overlay_text,slides,text_card,status,scheduled_at,published_at,media_urls,platform_post_id,buffer_update_id,resolved_url,target_locations,location_id,location_overrides,notes,reviewed_by,approved_by,approved_at,performed_well,archived_at,hashtag_suggestions,buffer_metrics,buffer_metrics_fetched_at,provenance,voice_fidelity_score,voice_audit,length_preset,series_id,series_part,series_total,photo_treatment,photo_composite_url,photo_template_id,aspect_ratio,created_at,updated_at'

// Slim shape for the Stories list (Cards / Pipeline / Calendar / Themes views).
// Drops heavy columns (`content`, `media_urls`, `buffer_metrics`, `notes`, etc.)
// that the list views don't render — full row is still available via id-fetch
// or the per-piece review screen. See buildStories() in src/lib/stories.js for
// the consuming shape.
const SELECT_CARD = 'id,interview_id,brief_id,workspace_id,platform,status,scheduled_at,published_at,updated_at,provenance,series_id,series_part,series_total'

// Slim shape for the "What's working" top-performers widget. Only needs
// metrics + display fields — drops content body, media_urls, notes, etc.
const SELECT_PERFORMERS = 'id,interview_id,topic,platform,status,buffer_metrics,buffer_metrics_fetched_at,updated_at'

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const id = searchParams.get('id')

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  const allowedRoles = req.method === 'GET' ? null : EDITOR_ROLES
  const auth = await requireRole(req, allowedRoles, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // `id` is interpolated into the PostgREST id filter on the GET-by-id, PATCH,
  // and DELETE paths below. workspace_id is AND-combined so this is hardening,
  // not an isolation fix — see CLAUDE.md (PR #1391).
  if (id && !UUID_RE.test(id)) return err(res, 'Invalid id', 400)

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (id) {
      const r = await sb(`content_items?id=eq.${id}&${wsFilter}&select=${SELECT}`)
      if (!r.ok) return dbErr(res, r)
      const data = await r.json()
      return ok(res, data[0] ?? null)
    }

    // List with optional filters
    const status      = searchParams.get('status')
    const platform    = searchParams.get('platform')
    const from        = searchParams.get('from')        // ISO date
    const to          = searchParams.get('to')          // ISO date
    const interviewId = searchParams.get('interviewId')
    const staffId = searchParams.get('staffId')
    const archived    = searchParams.get('archived')    // 'true' | 'only' | 'all' — default excludes archived
    const limit       = Math.min(parseInt(searchParams.get('limit') || '100', 10) || MAX_LIMIT, MAX_LIMIT)
    const view        = searchParams.get('view')        // 'card' | 'performers' = slim shapes

    // Validate allowlisted params before interpolating into the PostgREST query.
    if (status) {
      const statuses = status.split(',')
      if (statuses.some((s) => !VALID_STATUSES.has(s.trim()))) return err(res, 'Invalid status', 400)
    }
    if (platform && !VALID_PLATFORMS.has(platform)) return err(res, 'Invalid platform', 400)
    if (interviewId && !UUID_RE.test(interviewId)) return err(res, 'Invalid interviewId', 400)
    if (staffId && !UUID_RE.test(staffId)) return err(res, 'Invalid staffId', 400)
    if (from && !ISO_DATE_RE.test(from)) return err(res, 'Invalid from date', 400)
    if (to && !ISO_DATE_RE.test(to)) return err(res, 'Invalid to date', 400)

    const sel = view === 'card' ? SELECT_CARD : view === 'performers' ? SELECT_PERFORMERS : SELECT
    let qs = `content_items?${wsFilter}&select=${sel}&order=created_at.desc&limit=${limit}`
    if (status) {
      if (status.includes(',')) {
        const trimmed = status.split(',').map((s) => s.trim()).join(',')
        qs += `&status=in.(${trimmed})`
      } else {
        qs += `&status=eq.${status}`
      }
    }
    if (platform)    qs += `&platform=eq.${platform}`
    if (from)        qs += `&scheduled_at=gte.${encodeURIComponent(from)}`
    if (to)          qs += `&scheduled_at=lte.${encodeURIComponent(to)}`
    if (interviewId) qs += `&interview_id=eq.${encodeURIComponent(interviewId)}`
    if (staffId) qs += `&staff_id=eq.${encodeURIComponent(staffId)}`
    // Archive filter — archived items are hidden by default so the Hub stays
    // focused on live work. `archived=only` flips to the Archived view;
    // `archived=all` returns both (used by callers that need totals).
    if (archived === 'only')      qs += `&archived_at=not.is.null`
    else if (archived !== 'all')  qs += `&archived_at=is.null`

    const r = await sb(qs)
    if (!r.ok) return dbErr(res, r)
    return ok(res, await r.json())
  }

  // ── POST (bulk create from interview outputs) ────────────────────────────
  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'media'))) return

    const body = req.body

    // Bulk insert
    if (Array.isArray(body)) {
      const interviewIds = [...new Set(body.map((row) => row.interview_id).filter(Boolean))]
      if (interviewIds.some((iid) => !UUID_RE.test(iid))) return err(res, 'Invalid interview_id', 400)
      if (interviewIds.length > 0) {
        const ck = await sb(`interviews?id=in.(${interviewIds.join(',')})&workspace_id=eq.${ws.id}&select=id`)
        if (!ck.ok) return dbErr(res, ck, 'Ownership check failed')
        if ((await ck.json()).length !== interviewIds.length) return err(res, 'Interview not found in workspace', 422)
      }
      const rows = body.map((r) => ({ ...r, workspace_id: ws.id }))
      const r = await sb('content_items', {
        method: 'POST',
        body: JSON.stringify(rows),
      })
      if (!r.ok) return dbErr(res, r, 'Insert failed')
      return ok(res, await r.json(), 201)
    }

    // Single insert
    const { interviewId, staffId, staffName, topic, platform, content, status } = body || {}
    if (!interviewId || !platform || !content) return err(res, 'Missing required fields')
    if (!UUID_RE.test(interviewId)) return err(res, 'Invalid interviewId', 400)

    const ck = await sb(`interviews?id=eq.${interviewId}&workspace_id=eq.${ws.id}&select=id`)
    if (!ck.ok) return dbErr(res, ck, 'Ownership check failed')
    if (!(await ck.json()).length) return err(res, 'Interview not found in workspace', 422)

    const row = { workspace_id: ws.id, interview_id: interviewId, staff_id: staffId, staff_name: staffName, topic, platform, content }
    if (status) row.status = status
    const r = await sb('content_items', {
      method: 'POST',
      body: JSON.stringify(row),
    })
    if (!r.ok) return dbErr(res, r, 'Insert failed')
    const data = await r.json()
    return ok(res, data[0], 201)
  }

  // ── PATCH ────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'media'))) return

    if (!id) return err(res, 'Missing id')
    const patch = req.body || {}

    // Map camelCase → snake_case. `archivedAt` accepts an ISO string to
    // archive or `null` to restore.
    const allowed = {
      content:         patch.content,
      overlay_text:    patch.overlayText,
      slides:          patch.slides,
      text_card:       patch.textCard,
      status:          patch.status,
      scheduled_at:    patch.scheduledAt,
      published_at:    patch.publishedAt,
      media_urls:      patch.mediaUrls,
      platform_post_id: patch.platformPostId,
      buffer_update_id: patch.bufferUpdateId,
      resolved_url:    patch.resolvedUrl,
      target_locations:   patch.targetLocations,
      location_id:        patch.locationId,
      location_overrides: patch.locationOverrides,
      reviewed_by:     patch.reviewedBy,
      approved_by:     patch.approvedBy,
      approved_at:     patch.approvedAt,
      performed_well:         patch.performedWell,
      archived_at:            patch.archivedAt,
      notes:                  patch.notes,
      buffer_metrics:         patch.bufferMetrics,
      buffer_metrics_fetched_at: patch.bufferMetricsFetchedAt,
      updated_at:             patch.updatedAt,
      aspect_ratio:           patch.aspectRatio,
    }
    const body = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))

    const r = await sb(`content_items?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!r.ok) return dbErr(res, r, 'Update failed')
    const data = await r.json()
    const updated = data[0]

    // Off-request enrichment on approval (positive signal) and change-request
    // (negative signal, demotes phrasings that got rejected). Registered with
    // waitUntil() — a bare floating promise is frozen once the response is sent
    // on Vercel's Node runtime, the same failure mode that stranded interview
    // summaries out of the RAG corpus (see api/_lib/interviewSummarizer.js).
    if (updated && patch.status === 'approved' && updated.content?.trim()) {
      waitUntil(extractConcepts({
        workspaceId:  ws.id,
        sourceKind:   'approved_edit',
        sourceId:     updated.id,
        text:         updated.content,
        staffId:  updated.staff_id ?? null,
        weightDelta:  1.5,
      }))
      // Phase C.3 — feed approved content into the per-clinician voice phrase
      // substrate. No-ops without a staff_id (group-level pieces don't
      // contribute to any one voice profile).
      if (updated.staff_id) {
        waitUntil(extractVoicePhrases({
          workspaceId: ws.id,
          staffId: updated.staff_id,
          content:     updated.content,
        }))
      }
      // Phase 5 Feature 2 PR3 — embed approved content into the RAG corpus.
      waitUntil(indexContentItem({ workspaceId: ws.id, contentItemId: updated.id }))
    } else if (updated && patch.status === 'in_review' && patch.notes?.trim() && updated.content?.trim()) {
      // Change request returned — mild negative signal on the rejected draft.
      waitUntil(extractConcepts({
        workspaceId:  ws.id,
        sourceKind:   'rejected_edit',
        sourceId:     updated.id,
        text:         updated.content,
        staffId:  updated.staff_id ?? null,
        weightDelta:  -0.5,
      }))
    }

    return ok(res, updated)
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!(await enforceLimit(req, res, 'media'))) return

    if (!id) return err(res, 'Missing id')
    const r = await sb(`content_items?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!r.ok) return dbErr(res, r, 'Delete failed')
    return ok(res, { deleted: true })
  }

  return err(res, 'Method not allowed', 405)
}
