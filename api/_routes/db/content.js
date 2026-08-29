// Pinned to Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
// Uses Express-style (req, res) handler — the Web-style (req) → Response
// pattern silently hangs on Vercel's Node runtime (response never sent;
// function times out at 300s). Match the convention used by /api/content-pieces/*.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { captureServerException } from '../../_lib/sentry.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { classifyMediaChange } from '../../_lib/mediaOverride.js'
import { extractConcepts } from '../../_lib/conceptExtractor.js'
import { extractVoicePhrases } from '../../_lib/voicePhraseExtractor.js'
import { indexContentItem } from '../../_lib/practiceMemoryRag.js'
import { syncAtomSchedule } from '../../_lib/atomSchedule.js'
import { computeEditDiff } from '../../_lib/editDiffMining.js'
import { blogApprovalImpliesWords } from '../../_lib/blogApprovalImpliesWords.js'
import { waitUntil } from '@vercel/functions'
import { uuid, uuidCoerced, isoDateOrTimestamp } from '../../_lib/requestSchemas/primitives.js'
import {
  statusSchema,
  statusListSchema,
  platformSchema,
  rejectReasonSchema,
  originSchema,
  targetLocationsSchema,
  modelReasonsSchema,
  modelNoteSchema,
} from '../../_lib/requestSchemas/dbContent.js'
import { supabaseRest } from '../../_lib/supabaseRest.js'
// Shared with the editor client (src/pages/StoryboardPublish.jsx) so the screen
// and this handler can never disagree about what a committed post may change.
import { checkPatchAgainstLock, patchNeedsLockCheck } from '../../../src/lib/publishLock.js'
import { promoteFormatForMedia } from '../../../src/lib/platformFormats.js'

const MAX_LIMIT = 100

const sb = (path, init = {}) => supabaseRest(path, init, { contentType: 'application/json', prefer: 'return=representation' })

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

// Log a Supabase non-ok response body to function logs and return a generic
// 500 to the client. Public response stays opaque (no schema leak); details
// land in Vercel logs AND Sentry so a "Database error" report is diagnosable
// even after Vercel's short log retention window has already expired — which
// is exactly what happened to a real 500 here on 2026-08-10 (feedback
// a680d6c4): by the time the report was read, `vercel logs` covered barely the
// last hour, so the cause was gone and had to stay unexplained. This route is
// not withSentry-wrapped (it RETURNS an error response rather than throwing,
// so nothing would ever reach that wrapper's catch), so it has to report
// explicitly via the same captureServerException the Express central handler
// uses for everything else.
//
// `req` is required, not optional — every call site already has it in scope
// (there is exactly one handler in this file) — so a future call site can't
// silently skip reporting by forgetting to pass it.
//
// Exported (only) so tests/lib/dbErrReportsToSentry.test.js can invoke it
// directly with a mocked Sentry module rather than standing up the whole
// handler's auth/workspace/Supabase chain just to reach a 500 branch.
export async function dbErr(res, r, req, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  const detail = `supabase ${r.status}: ${body.slice(0, 500)}`
  console.error(`[db/content] ${msg} — ${detail}`)
  captureServerException(new Error(`[db/content] ${msg} — ${detail}`), req)
  return res.status(status).json({ error: msg })
}

// NOTE: a column added to the PATCH allowlist below is NOT readable until it is
// ALSO listed here. `format`/`format_source` shipped write-only in #2467 — the
// picker saved correctly and the row updated, but every reader (the picker's own
// selected state, the badge, and publishPiece's `piece.format`) got undefined,
// so the choice was invisible AND never reached the publish payload. Nothing
// errored; the feature was simply inert. Add both halves together.
// interview:interviews!interview_id(kind) — a direct (non-moment-chain) embed
// off content_items.interview_id, so the editor can tell whether this piece
// came from a kind='point' interview and render the Phase 2b safety chip
// only there. Distinct alias path from MOMENT_EMBED's nested
// moment.interview below — no collision, different attachment point.
const SELECT = 'id,interview_id,brief_id,staff_id,staff_name,topic,platform,content,overlay_text,slides,text_card,status,publish_error,scheduled_at,published_at,media_urls,platform_post_id,resolved_url,target_locations,location_id,location_overrides,notes,reviewed_by,approved_by,approved_at,reject_reason,reject_note,rejected_at,rejected_by,edit_diff,performed_well,is_model_post,model_reasons,model_note,model_marked_at,archived_at,hashtag_suggestions,provenance,voice_fidelity_score,voice_audit,point_safety_score,point_safety_audit,length_preset,series_id,series_part,series_total,photo_treatment,photo_composite_url,photo_template_id,aspect_ratio,seo_title,meta_description,format,format_source,media_source,created_at,updated_at,interview:interviews!interview_id(kind)'

// Slim shape for the Stories list (Cards / Pipeline / Calendar / Themes views).
// Drops heavy columns (`content`, `media_urls`, `notes`, etc.) that the list
// views don't render — full row is still available via id-fetch or the
// per-piece review screen. See buildStories() in src/lib/stories.js for the
// consuming shape.
const SELECT_CARD = 'id,interview_id,brief_id,workspace_id,platform,status,scheduled_at,published_at,updated_at,provenance,series_id,series_part,series_total,voice_fidelity_score,voice_audit,point_safety_score,point_safety_audit,performed_well,interview:interviews!interview_id(kind)'

// Moments IA ① — the detail read (and the PATCH echo that overwrites the
// client's detail cache) embed the piece's banked moment via its plan atom, so
// the publish editors can render MomentProvenance. Flattened to `moment` so
// consumers never see the join scaffolding; null for legacy/atom-less pieces.
const MOMENT_EMBED =
  'plan_atoms:content_plan_atoms!content_piece_id(moment:moments!moment_id(excerpt,score,interview:interviews!interview_id(topic,created_at)))'
function attachMoment(row) {
  if (!row) return row
  const m = (Array.isArray(row.plan_atoms) ? row.plan_atoms : []).find((pa) => pa?.moment)?.moment
  row.moment = m
    ? {
        excerpt: m.excerpt,
        score: m.score ?? null,
        interviewTopic: m.interview?.topic || null,
        interviewDate: m.interview?.created_at || null,
      }
    : null
  delete row.plan_atoms
  return row
}

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
  if (id && !uuid.safeParse(id).success) return err(res, 'Invalid id', 400)

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (id) {
      const r = await sb(`content_items?id=eq.${id}&${wsFilter}&select=${SELECT},${MOMENT_EMBED}`)
      if (!r.ok) return dbErr(res, r, req)
      const data = await r.json()
      return ok(res, attachMoment(data[0] ?? null))
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
    const view        = searchParams.get('view')        // 'card' = slim shape
    const origin      = searchParams.get('origin')      // 'post' = one-off Post/Brief content only

    // Validate allowlisted params before interpolating into the PostgREST query.
    if (origin && !originSchema.safeParse(origin).success) return err(res, 'Invalid origin', 400)
    if (status && !statusListSchema.safeParse(status).success) return err(res, 'Invalid status', 400)
    if (platform && !platformSchema.safeParse(platform).success) return err(res, 'Invalid platform', 400)
    if (interviewId && !uuid.safeParse(interviewId).success) return err(res, 'Invalid interviewId', 400)
    if (staffId && !uuid.safeParse(staffId).success) return err(res, 'Invalid staffId', 400)
    if (from && !isoDateOrTimestamp.safeParse(from).success) return err(res, 'Invalid from date', 400)
    if (to && !isoDateOrTimestamp.safeParse(to).success) return err(res, 'Invalid to date', 400)

    const sel = view === 'card' ? SELECT_CARD : SELECT
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
    // Posts tab: one-off content (a Post/Brief), which has a brief_id and no
    // interview. This is the content buildStories() drops, so it needs its own
    // interview-agnostic list.
    if (origin === 'post') qs += `&brief_id=not.is.null`
    // Archive filter — archived items are hidden by default so the Hub stays
    // focused on live work. `archived=only` flips to the Archived view;
    // `archived=all` returns both (used by callers that need totals).
    if (archived === 'only')      qs += `&archived_at=not.is.null`
    else if (archived !== 'all')  qs += `&archived_at=is.null`

    const r = await sb(qs)
    if (!r.ok) return dbErr(res, r, req)
    return ok(res, await r.json())
  }

  // ── POST (bulk create from interview outputs) ────────────────────────────
  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'media', ws.id))) return

    const body = req.body

    // Bulk insert
    if (Array.isArray(body)) {
      const interviewIds = [...new Set(body.map((row) => row.interview_id).filter(Boolean))]
      if (interviewIds.some((iid) => !uuidCoerced.safeParse(iid).success)) return err(res, 'Invalid interview_id', 400)
      if (interviewIds.length > 0) {
        const ck = await sb(`interviews?id=in.(${interviewIds.join(',')})&workspace_id=eq.${ws.id}&select=id`)
        if (!ck.ok) return dbErr(res, ck, req, 'Ownership check failed')
        if ((await ck.json()).length !== interviewIds.length) return err(res, 'Interview not found in workspace', 422)
      }
      const staffIds = [...new Set(body.map((row) => row.staff_id).filter(Boolean))]
      if (staffIds.some((sid) => !uuidCoerced.safeParse(sid).success)) return err(res, 'Invalid staff_id', 400)
      if (staffIds.length > 0) {
        const ck = await sb(`staff?id=in.(${staffIds.join(',')})&workspace_id=eq.${ws.id}&select=id`)
        if (!ck.ok) return dbErr(res, ck, req, 'Ownership check failed')
        if ((await ck.json()).length !== staffIds.length) return err(res, 'Staff not found in workspace', 422)
      }
      const briefIds = [...new Set(body.map((row) => row.brief_id).filter(Boolean))]
      if (briefIds.some((bid) => !uuidCoerced.safeParse(bid).success)) return err(res, 'Invalid brief_id', 400)
      if (briefIds.length > 0) {
        const ck = await sb(`briefs?id=in.(${briefIds.join(',')})&workspace_id=eq.${ws.id}&select=id`)
        if (!ck.ok) return dbErr(res, ck, req, 'Ownership check failed')
        if ((await ck.json()).length !== briefIds.length) return err(res, 'Brief not found in workspace', 422)
      }
      const BULK_ALLOWED = new Set([
      'interview_id', 'brief_id', 'staff_id', 'staff_name', 'topic', 'platform',
      'content', 'status', 'channel_override', 'ai_original_content',
    ])
    const rows = body.map((r) => {
      const row = { workspace_id: ws.id }
      for (const [k, v] of Object.entries(r)) {
        if (BULK_ALLOWED.has(k)) row[k] = v
      }
      if (row.status !== undefined && !statusSchema.safeParse(row.status).success) row.status = 'draft'
      return row
    })
      const r = await sb('content_items', {
        method: 'POST',
        body: JSON.stringify(rows),
      })
      if (!r.ok) return dbErr(res, r, req, 'Insert failed')
      return ok(res, await r.json(), 201)
    }

    // Single insert
    const { interviewId, staffId, staffName, topic, platform, content, status } = body || {}
    if (!interviewId || !platform || !content) return err(res, 'Missing required fields')
    if (!uuidCoerced.safeParse(interviewId).success) return err(res, 'Invalid interviewId', 400)
    if (staffId && !uuidCoerced.safeParse(staffId).success) return err(res, 'Invalid staffId', 400)

    if (staffId) {
      const sk = await sb(`staff?id=eq.${staffId}&workspace_id=eq.${ws.id}&select=id`)
      if (!sk.ok) return dbErr(res, sk, req, 'Staff ownership check failed')
      if (!(await sk.json()).length) return err(res, 'Staff not found in workspace', 422)
    }

    const ck = await sb(`interviews?id=eq.${interviewId}&workspace_id=eq.${ws.id}&select=id`)
    if (!ck.ok) return dbErr(res, ck, req, 'Ownership check failed')
    if (!(await ck.json()).length) return err(res, 'Interview not found in workspace', 422)

    if (status && !statusSchema.safeParse(status).success) return err(res, 'Invalid status', 400)
    const row = { workspace_id: ws.id, interview_id: interviewId, staff_id: staffId, staff_name: staffName, topic, platform, content }
    if (status) row.status = status
    const r = await sb('content_items', {
      method: 'POST',
      body: JSON.stringify(row),
    })
    if (!r.ok) return dbErr(res, r, req, 'Insert failed')
    const data = await r.json()
    return ok(res, data[0], 201)
  }

  // ── PATCH ────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'media', ws.id))) return

    if (!id) return err(res, 'Missing id')
    const patch = req.body || {}

    if (patch.status !== undefined && !statusSchema.safeParse(patch.status).success) return err(res, 'Invalid status', 400)
    // T4 learning loop — a reject must always carry a reason from the fixed
    // enum, or the whole point (capturing WHY) is lost. Note is optional.
    if (patch.status === 'rejected' && !rejectReasonSchema.safeParse(patch.rejectReason).success) {
      return err(res, 'Invalid rejectReason', 400)
    }
    if (patch.locationId && !uuidCoerced.safeParse(patch.locationId).success) return err(res, 'Invalid locationId', 400)
    if (patch.targetLocations !== undefined && patch.targetLocations !== null) {
      if (!targetLocationsSchema.safeParse(patch.targetLocations).success) {
        return err(res, 'Invalid targetLocations', 400)
      }
    }
    if (patch.modelReasons !== undefined && patch.modelReasons !== null) {
      if (!modelReasonsSchema.safeParse(patch.modelReasons).success) {
        return err(res, 'Invalid modelReasons', 400)
      }
    }
    if (patch.modelNote !== undefined && patch.modelNote !== null) {
      if (!modelNoteSchema.safeParse(patch.modelNote).success) {
        return err(res, 'Invalid modelNote', 400)
      }
    }
    // ── Media override capture (learning loop, migration 196) ────────────
    // A photo swap is the third override dimension, and the only one with no
    // signal at all before this: media_urls is overwritten in place and
    // edit_diff is text-only.
    //
    // Classified from the CHANGE, never from a caller claim. The editor's own
    // auto-attach-on-open and a human's deliberate swap arrive through this
    // same PATCH from the same client, so a client-supplied provenance flag
    // would be wrong in both directions (and trivially able to suppress real
    // overrides). What IS unambiguous server-side:
    //   empty  → non-empty  = a first attach. Nobody's choice was overridden.
    //   non-empty → different = a REPLACEMENT. That is the override signal,
    //                            and it is exactly what the panel reports
    //                            ("you swapped the photo on 21 of 48").
    // Identical arrays (a no-op re-save, e.g. an autosave round-trip) must not
    // count — that would inflate the rate every time an editor is opened.
    // One read serves two jobs: the publish lock (below) needs the row's STORED
    // status, and the media-override classifier needs its current media_urls.
    // Read once — this route is the editor's autosave path, so an extra
    // round-trip per keystroke-batch is not free.
    let curRow = null
    if (Array.isArray(patch.mediaUrls) || patchNeedsLockCheck(patch)) {
      const curRes = await sb(`content_items?id=eq.${id}&workspace_id=eq.${ws.id}&select=status,media_urls,platform,format&limit=1`)
      if (!curRes.ok) return dbErr(res, curRes, req, 'Update failed')
      curRow = (await curRes.json().catch(() => []))[0] || null
    }

    // ── Publish lock ─────────────────────────────────────────────────────
    // A scheduled or published row's CONTENT is committed: the payload is
    // already with bundle.social (scheduled) or already live (published), so an
    // edit here changes nothing downstream and only desyncs our record of what
    // shipped. Judgment fields (ratings, notes) stay open — see publishLock.js.
    // Checked against the STORED status, never patch.status, so a body claiming
    // 'draft' can't unlock itself in the same request.
    if (curRow) {
      const verdict = checkPatchAgainstLock(curRow.status, patch)
      if (!verdict.ok) {
        console.error('[db/content] blocked edit to a locked piece:', id, verdict.reason, verdict.fields.join(','))
        return res.status(409).json({ error: verdict.reason })
      }
    }

    let mediaOverride
    if (Array.isArray(patch.mediaUrls) && curRow) {
      const before = Array.isArray(curRow.media_urls) ? curRow.media_urls : []
      mediaOverride = classifyMediaChange(before, patch.mediaUrls)
    }

    // ── Auto-promote the format when attached media outgrows it ──────────────
    // A single-photo "Post" that just gained more photos should become a
    // "Carousel", not fail to publish (feedback 14ba3329). Fires only on a media
    // write, only for a genuine count overflow (Post → Carousel; never a kind
    // change like a video on a photo Post — that stays with the editor's
    // block + message), and never overrides a format the SAME patch set by hand.
    // media_urls is a frozen field, so the lock check above already 409'd any
    // scheduled/published edit — this can only run on an unlocked row, exactly
    // when a format change is legal. Stamped 'bernard' (auto-derived, not human).
    let autoFormat
    if (Array.isArray(patch.mediaUrls) && curRow && patch.format === undefined) {
      const promoted = promoteFormatForMedia(curRow.platform, curRow.format, patch.mediaUrls)
      if (promoted !== curRow.format) autoFormat = promoted
    }

    if (patch.locationId) {
      const locChk = await sb(`workspace_locations?id=eq.${patch.locationId}&workspace_id=eq.${ws.id}&select=id&limit=1`)
      if (!locChk.ok || !(await locChk.json()).length) return err(res, 'Location not found in workspace', 404)
    }

    // Reject a malformed scheduledAt before it lands in content_items or reaches
    // the atom sync below (its mondayOf() throws RangeError on an Invalid Date,
    // which would surface a 500 AFTER the row already saved). null/undefined =
    // leave as-is or unschedule, both allowed.
    if (patch.scheduledAt && !isoDateOrTimestamp.safeParse(patch.scheduledAt).success) return err(res, 'Invalid scheduledAt', 400)

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
      resolved_url:    patch.resolvedUrl,
      target_locations:   patch.targetLocations,
      location_id:        patch.locationId !== undefined ? (patch.locationId || null) : undefined,
      location_overrides: patch.locationOverrides,
      performed_well:         patch.performedWell,
      archived_at:            patch.archivedAt,
      notes:                  patch.notes,
      updated_at:             new Date().toISOString(),
      aspect_ratio:           patch.aspectRatio,
      // Explicit publish format. format_source is server-stamped, never
      // client-supplied: this route is the human editor's path, so any format
      // set here is a HUMAN choice — that provenance is the raw signal for the
      // format-confidence loop (server-side drafters stamp 'bernard' directly).
      // When the client didn't set a format but attached media outgrew the
      // stored one, autoFormat carries the Bernard-derived promotion (above).
      format:                 patch.format !== undefined ? patch.format : autoFormat,
      // Server-stamped from the classification above; never read from the body.
      media_source:           mediaOverride,
      format_source:          patch.format !== undefined
        ? (patch.format === null ? null : 'human')
        : (autoFormat !== undefined ? 'bernard' : undefined),
      seo_title:              patch.seoTitle,
      meta_description:       patch.metaDescription,
      reject_reason:          patch.status === 'rejected' ? patch.rejectReason : undefined,
      reject_note:            patch.status === 'rejected' ? (patch.rejectNote || null) : undefined,
    }
    // Audit fields are server-set only — never accept from the client.
    // approved_by/approved_at are set when status transitions to 'approved';
    // reviewed_by is set when status transitions to 'in_review';
    // rejected_by/rejected_at when status transitions to 'rejected' (T4).
    if (patch.status === 'approved') {
      allowed.approved_by = auth.userId
      allowed.approved_at = new Date().toISOString()
    }
    if (patch.status === 'in_review') {
      allowed.reviewed_by = auth.userId
    }
    if (patch.status === 'rejected') {
      allowed.rejected_by = auth.userId
      allowed.rejected_at = new Date().toISOString()
    }
    // The "came together well" craft signal (pre-publish, see modelRating.js).
    // Marking stamps model_marked_at server-side and stores the reasons/note
    // given at that moment; unmarking ("Undo") clears all three together so a
    // later re-mark starts from a clean slate rather than resurrecting stale
    // chips. isModelPost is the only field the client toggles — reasons/note
    // are only meaningful attached to a mark, never set independently.
    if (patch.isModelPost === true) {
      allowed.is_model_post = true
      allowed.model_marked_at = new Date().toISOString()
      allowed.model_reasons = patch.modelReasons || []
      allowed.model_note = patch.modelNote || null
    } else if (patch.isModelPost === false) {
      allowed.is_model_post = false
      allowed.model_marked_at = null
      allowed.model_reasons = null
      allowed.model_note = null
    }
    const body = Object.fromEntries(
      Object.entries(allowed).filter(([_k, v]) => v !== undefined)
    )

    // select=* + the moment embed: the PATCH echo lands straight in the
    // client's detail cache (useUpdateContentItem's setQueryData), so it must
    // carry the same `moment` field as the GET-by-id read or provenance would
    // vanish from the editor after every save.
    const r = await sb(`content_items?id=eq.${id}&${wsFilter}&select=*,${MOMENT_EMBED}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!r.ok) return dbErr(res, r, req, 'Update failed')
    const data = await r.json()
    const updated = attachMoment(data[0])

    // Keep the linked plan atom's schedule in sync — the /week board renders
    // from the ATOM, so a (re)schedule that writes only content_items leaves the
    // post on its old day (user feedback 2026-07-13). This is the editor's
    // schedule path; the dispatch paths call the same helper. See
    // api/_lib/atomSchedule.js for the full rationale — one copy on purpose.
    if (updated && patch.scheduledAt !== undefined) {
      await syncAtomSchedule({
        pieceId: id,
        workspaceId: ws.id,
        scheduledAt: patch.scheduledAt,
        timezone: ws.cadence_policy?.timezone,
      })
    }

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
      // Blog collapses to ONE approval (Q, 2026-08-29) — approving the article
      // IS the story's words approval, because blog fans out 1:1 from its story
      // and the clinician has just read the whole long-form piece. See
      // api/_lib/blogApprovalImpliesWords.js for the full rationale and why it
      // is blog-only. The hard publish gate (wordsApprovalGate.js) is untouched:
      // this changes who SETS words_approved_at, never who may skip it.
      //
      // Only ever fills a NULL — never overwrites an existing approval, so an
      // earlier approver keeps the credit and the summary-edit-clears-approval
      // invariant (api/_routes/db/interviews.js) can't be quietly undone by a
      // later blog approve. Awaited, not waitUntil'd: the client publishes off
      // the back of this response, so a race would leave Publish disabled on a
      // piece the server already considers cleared.
      if (blogApprovalImpliesWords(updated, patch.status)) {
        try {
          const wRes = await sb(
            `interviews?id=eq.${updated.interview_id}&workspace_id=eq.${ws.id}` +
            `&words_approved_at=is.null`,
            {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify({
                words_approved_at: new Date().toISOString(),
                // Approver identity is ALWAYS server-derived, never taken from
                // the request body — same rule as approved_by above and as the
                // words screen's own approveWords path (db/interviews.js).
                words_approved_by: auth.userId || null,
              }),
            },
          )
          if (!wRes.ok) {
            console.error(
              `[db/content] blog approve → words approval PATCH ${wRes.status} for interview=${updated.interview_id} ws=${ws.slug}`,
            )
          }
        } catch (e) {
          // Non-fatal: the piece is still approved. The clinician would meet
          // the words gate at publish, which is the pre-existing behaviour —
          // strictly no worse than before this change.
          console.error(`[db/content] blog approve → words approval threw: ${e?.message}`)
        }
      }

      // T4 learning loop, part 2 — persist the diff between the AI's original
      // draft and what staff actually approved. Digest-only today (see
      // api/_lib/editDiffMining.js); not read by any generation path. Same
      // fire-and-forget waitUntil discipline as the enrichment calls above —
      // must never delay the approve response.
      const editDiff = computeEditDiff(updated.ai_original_content, updated.content)
      if (editDiff.changed) {
        waitUntil(
          sb(`content_items?id=eq.${updated.id}&${wsFilter}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ edit_diff: editDiff }),
          }).catch((e) => console.error('[db/content] edit_diff persist failed:', e?.message))
        )
      }
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

    // F6 — embed approved/published content into the RAG practice-memory corpus.
    // Decoupled from the approval-signal enrichment above (which deliberately
    // gates on the `approved` transition): indexing must ALSO fire when a piece
    // is published directly (the old `=== 'approved'` gate silently missed
    // publish-direct items — ~half of recent published rows had no chunk) and
    // when an already-eligible body is EDITED (keeps chunks fresh). indexContentItem
    // self-guards on status, upserts, and prunes orphan chunks, so an over-eager
    // call (e.g. a metadata-only PATCH on a draft) is a cheap no-op.
    const enteredCorpus = patch.status === 'approved' || patch.status === 'published'
    const corpusEligible = updated && ['approved', 'published'].includes(updated.status) && updated.content?.trim()
    if (corpusEligible && (enteredCorpus || patch.content !== undefined)) {
      waitUntil(indexContentItem({ workspaceId: ws.id, contentItemId: updated.id }))
    }

    return ok(res, updated)
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!(await enforceLimit(req, res, 'media', ws.id))) return

    if (!id) return err(res, 'Missing id')
    const r = await sb(`content_items?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!r.ok) return dbErr(res, r, req, 'Delete failed')
    return ok(res, { deleted: true })
  }

  return err(res, 'Method not allowed', 405)
}
