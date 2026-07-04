export const config = { runtime: 'nodejs', maxDuration: 60 }

import { waitUntil } from '@vercel/functions'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { draftAnswer } from '../_lib/producer/draftAnswer.js'

/**
 * /api/answers — the clinician's answer-review queue for the public answer library.
 *
 * GET                 → the current clinician's answers awaiting their sign-off
 *                       (needs_review + changes_requested), newest first.
 * PATCH { id, action } → act on ONE of THEIR OWN answers:
 *     action:'approve' → status=approved (ready to publish)
 *     action:'edit'    → save inline edits (answer_lead/body/question); stays needs_review
 *     action:'revise'  → status=changes_requested + review_notes (Bernard re-drafts later)
 *
 * Authorization is two-layered: requireRole proves workspace membership, then every
 * row action is gated on ownership (the answer's staff_id must be the caller's own
 * staff row) — a doctor only reviews answers that carry THEIR name. Admins may act on
 * any. Mirrors the staff-row self-or-admin contract (voice-clone authz fix).
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

function dbErr(res, r, tag) {
  r.text().then((t) => console.error(`[answers] ${tag}:`, r.status, t?.slice(0, 300))).catch(() => {})
  return res.status(500).json({ error: 'db_error' })
}

// Resolve the caller's staff row in this workspace (self-review gate + admin check).
async function resolveStaff(wsId, clerkUserId) {
  if (!clerkUserId) return null
  const r = await sb(
    `staff?workspace_id=eq.${wsId}&user_id=eq.${encodeURIComponent(clerkUserId)}` +
      `&select=id,permission_tier,answer_review_enabled&limit=1`,
  )
  if (!r.ok) return null
  const rows = await r.json().catch(() => [])
  return rows[0] || null
}

const isAdmin = (staff) => staff?.permission_tier === 'admin'

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const clerkUserId = auth.userId || auth.user?.id || null
  const me = await resolveStaff(ws.id, clerkUserId)

  // ---- GET: my review queue ----
  if (req.method === 'GET') {
    if (!me) return res.status(200).json({ answers: [], reviewEnabled: false })
    const r = await sb(
      `answers?workspace_id=eq.${ws.id}&staff_id=eq.${me.id}` +
        `&status=in.(needs_review,changes_requested)` +
        `&select=id,question,slug,answer_lead,body,condition,seo_title,summary,status,review_notes,grounding_source,updated_at` +
        `&order=updated_at.desc`,
    )
    if (!r.ok) return dbErr(res, r, 'list')
    const answers = await r.json()
    return res.status(200).json({ answers, reviewEnabled: !!me.answer_review_enabled })
  }

  // ---- PATCH: act on one of my own answers ----
  if (req.method === 'PATCH') {
    const { id, action } = req.body || {}
    if (!UUID_RE.test(id || '')) return res.status(400).json({ error: 'invalid_id' })
    if (!['approve', 'edit', 'revise'].includes(action)) return res.status(400).json({ error: 'invalid_action' })
    if (!me) return res.status(403).json({ error: 'forbidden' })

    // Ownership gate — fetch the row (workspace-scoped) and confirm it's the caller's.
    const cur = await sb(
      `answers?workspace_id=eq.${ws.id}&id=eq.${id}&select=id,staff_id,status,question,condition,answer_lead,body&limit=1`,
    )
    if (!cur.ok) return dbErr(res, cur, 'fetch')
    const row = (await cur.json())[0]
    if (!row) return res.status(404).json({ error: 'not_found' })
    if (row.staff_id !== me.id && !isAdmin(me)) return res.status(403).json({ error: 'forbidden' })

    const patch = { updated_at: new Date().toISOString() }
    if (action === 'approve') {
      patch.status = 'approved'
    } else if (action === 'edit') {
      const { answer_lead, body, question } = req.body || {}
      if (typeof answer_lead === 'string') patch.answer_lead = answer_lead
      if (typeof body === 'string') patch.body = body
      if (typeof question === 'string' && question.trim()) patch.question = question.trim()
      patch.status = 'needs_review'
    } else if (action === 'revise') {
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      if (!note) return res.status(400).json({ error: 'note_required' })
      patch.status = 'changes_requested'
      patch.review_notes = note.slice(0, 2000)
    }

    const upd = await sb(`answers?workspace_id=eq.${ws.id}&id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (!upd.ok) return dbErr(res, upd, 'update')

    // Ask-to-revise → Bernard re-drafts in the clinician's voice off the note,
    // then flips back to needs_review. Runs after the response (waitUntil keeps
    // the instance alive) since generation takes ~10s; the review surface polls
    // while the answer is changes_requested and shows the re-draft when it lands.
    if (action === 'revise') {
      waitUntil(reDraftAnswer(ws, id, row, patch.review_notes))
    }

    return res.status(200).json((await upd.json())[0] || { ok: true })
  }

  // ---- POST { question, condition, staffId }: draft a NEW answer into a queue ----
  if (req.method === 'POST') {
    if (!me) return res.status(403).json({ error: 'forbidden' })
    const { question, condition } = req.body || {}
    const staffId = req.body?.staffId || me.id
    if (typeof question !== 'string' || question.trim().length < 8) {
      return res.status(400).json({ error: 'question_required' })
    }
    if (!UUID_RE.test(staffId)) return res.status(400).json({ error: 'invalid_staff' })
    // Only draft for yourself, unless you're an admin authoring for a colleague.
    if (staffId !== me.id && !isAdmin(me)) return res.status(403).json({ error: 'forbidden' })

    const drafted = await draftAnswer({ ws, staffId, question: question.trim(), condition })
    if (!drafted) return res.status(502).json({ error: 'draft_failed' })

    const slug = slugify(question)
    const ins = await sb('answers', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        staff_id: staffId,
        question: question.trim(),
        slug,
        answer_lead: drafted.answer_lead,
        body: drafted.body,
        condition: condition || null,
        status: 'needs_review',
        source: 'manual',
        grounding_source: `Drafted in ${drafted.staffName}'s voice from their practice memory.`,
      }),
    })
    if (ins.status === 409) return res.status(409).json({ error: 'answer_exists', slug })
    if (!ins.ok) return dbErr(res, ins, 'insert')
    return res.status(201).json((await ins.json())[0] || { ok: true })
  }

  return res.status(405).json({ error: 'method_not_allowed' })
}

// Re-draft an answer against the clinician's change note, then return it to the
// queue. Best-effort: on any failure the answer stays changes_requested with the
// note intact so the doctor can retry.
async function reDraftAnswer(ws, id, row, note) {
  try {
    const drafted = await draftAnswer({
      ws,
      staffId: row.staff_id,
      question: row.question,
      condition: row.condition,
      existing: { answer_lead: row.answer_lead, body: row.body },
      reviseNote: note,
    })
    if (!drafted) {
      console.error('[answers] re-draft returned null for', id)
      return
    }
    await sb(`answers?workspace_id=eq.${ws.id}&id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        answer_lead: drafted.answer_lead,
        body: drafted.body,
        status: 'needs_review',
        review_notes: null,
        updated_at: new Date().toISOString(),
      }),
    })
  } catch (e) {
    console.error('[answers] re-draft failed:', e?.message, e?.stack)
  }
}

// kebab slug from a question, capped — deterministic, matches the answers UNIQUE.
function slugify(q) {
  return String(q)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}
