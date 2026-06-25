// POST /api/corpus/ingest
//
// Ingest a piece of authored text into the clinician's corpus (Source Library).
// Creates a staff_corpus_documents row then indexes it into practice_memory_chunks
// for voice training and Book KB. Idempotent — re-posting the same title+staff
// upserts the body and re-indexes.
//
// Also fixes the AuthorMode "save draft" dead path — that page already calls
// this endpoint with { docType: 'uploaded_draft', title, body }.
//
// Body:
//   docType     — 'uploaded_draft' | 'original_blog'   (required)
//   title       — string                               (required, max 300 chars)
//   body        — string                               (required, non-empty)
//   staffId     — uuid (optional; owner/producer only — supply to attribute a post
//                 to a specific staff member, e.g. for batch ingest scripts)
//   sourceUrl   — string (optional; original_blog only)
//   docDate     — ISO date string (optional; original_blog only)
//
// Returns: { id, title, docType, staffId, chunksIndexed }
export const config = { runtime: 'nodejs' }

import { waitUntil } from '@vercel/functions'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { indexOriginalBlog, indexUploadedDraft } from '../../_lib/practiceMemoryRag.js'

const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY

const ALLOWED_DOC_TYPES = new Set(['uploaded_draft', 'original_blog'])
const MAX_TITLE_LEN     = 300
const MAX_BODY_LEN      = 200_000   // ~50k words; well above any real post

const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

async function dbErr(res, r, msg = 'Database error') {
  const body = await r.text().catch(() => '')
  console.error(`[corpus/ingest] ${msg} — supabase ${r.status}: ${body.slice(0, 300)}`)
  return res.status(500).json({ error: msg })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed')

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  // ── Validate body ───────────────────────────────────────────────────────
  const {
    docType,
    title,
    body,
    staffId: requestedStaffId = null,
    sourceUrl = null,
    docDate   = null,
  } = req.body || {}

  if (!docType || !ALLOWED_DOC_TYPES.has(docType)) {
    return err(res, `docType must be one of: ${[...ALLOWED_DOC_TYPES].join(', ')}`)
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    return err(res, 'title is required')
  }
  if (!body || typeof body !== 'string' || !body.trim()) {
    return err(res, 'body is required')
  }
  if (title.length > MAX_TITLE_LEN) {
    return err(res, `title must be ${MAX_TITLE_LEN} characters or fewer`)
  }
  if (body.length > MAX_BODY_LEN) {
    return err(res, `body exceeds maximum length (${MAX_BODY_LEN} chars)`)
  }

  // ── Resolve staff row ───────────────────────────────────────────────────
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (requestedStaffId && !UUID_RE.test(requestedStaffId)) return err(res, 'Invalid staffId', 400)

  // An explicit staffId may only be supplied by owners/producers (batch scripts,
  // admin import). Other roles always ingest against their own staff row.
  let staffId
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (requestedStaffId && !UUID_RE.test(requestedStaffId)) {
    return err(res, 'invalid_staff_id', 400)
  }
  if (requestedStaffId && (auth.role === 'owner' || auth.role === 'producer')) {
    // Verify the supplied staffId belongs to this workspace.
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staff?id=eq.${requestedStaffId}&workspace_id=eq.${ws.id}&select=id&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    )
    if (!checkRes.ok) return dbErr(res, checkRes, 'Staff lookup failed')
    const rows = await checkRes.json().catch(() => [])
    if (!rows.length) return err(res, 'staffId not found in this workspace', 404)
    staffId = requestedStaffId
  } else {
    // Fall back to the authenticated user's own staff row.
    const staffRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staff?workspace_id=eq.${ws.id}&user_id=eq.${auth.userId}&select=id&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    )
    if (!staffRes.ok) return dbErr(res, staffRes, 'Staff lookup failed')
    const rows = await staffRes.json().catch(() => [])
    if (!rows.length) return err(res, 'No staff profile found for this user', 404)
    staffId = rows[0].id
  }

  // ── Upsert corpus document ──────────────────────────────────────────────
  // Unique constraint: (workspace_id, staff_id, doc_type, title) WHERE archived_at IS NULL.
  // Prefer-merge-duplicates upserts on conflict — updates body + timestamps for re-ingests.
  const docPayload = {
    workspace_id: ws.id,
    staff_id:     staffId,
    doc_type:     docType,
    title:        title.trim(),
    body:         body.trim(),
    ...(sourceUrl && { source_url: sourceUrl }),
    ...(docDate   && { doc_date:   docDate }),
    updated_at:   new Date().toISOString(),
  }

  const upsertRes = await fetch(
    `${SUPABASE_URL}/rest/v1/staff_corpus_documents`,
    {
      method: 'POST',
      headers: {
        apikey:          SUPABASE_KEY,
        Authorization:   `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
        Prefer:          'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify(docPayload),
    }
  )
  if (!upsertRes.ok) return dbErr(res, upsertRes, 'Failed to save corpus document')
  const [doc] = await upsertRes.json()
  if (!doc?.id) return res.status(500).json({ error: 'Upsert returned no document' })

  // ── Respond immediately; index in background ────────────────────────────
  // waitUntil keeps the Vercel instance alive for the async work after the
  // response is sent. The index call MUST be awaited inside the promise — a
  // bare floating promise would be killed the instant the response flushes.
  res.status(201).json({ id: doc.id, title: doc.title, docType, staffId })
  return waitUntil((async () => {
    try {
      if (docType === 'original_blog') {
        await indexOriginalBlog({
          workspaceId: ws.id,
          staffId,
          blogId:      doc.id,
          title:       doc.title,
          body:        doc.body,
          publishedAt: doc.doc_date,
        })
      } else {
        await indexUploadedDraft({
          workspaceId: ws.id,
          staffId,
          docId:       doc.id,
          title:       doc.title,
          body:        doc.body,
          uploadedAt:  doc.created_at,
        })
      }
    } catch (e) {
      console.error(`[corpus/ingest] background index failed for doc ${doc.id}: ${e?.stack || e?.message}`)
    }
  })())
}
