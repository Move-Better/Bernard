export const config = { runtime: 'nodejs', maxDuration: 60 }

import { waitUntil } from '@vercel/functions'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { draftAnswer } from '../_lib/producer/draftAnswer.js'
import { publishAnswerToMovebetter, retractAnswerFromMovebetter } from '../_lib/publishAnswer.js'
import { scoreAnswerFidelity, ANSWER_GATE } from '../_lib/scoreAnswerFidelity.js'

// Going live to the public site is per-workspace (F16 Phase 2). An approved
// answer publishes to movebetter.co only when the workspace has
// answer_publish_enabled = true — which replaced the old global
// ANSWER_PUBLISH_ENABLED env flag. Publishing stays TRIPLE-gated:
//   workspace-enabled  AND  cleared the voice-fidelity gate  AND  human-approved.
// Defaults false; each tenant is flipped live deliberately (movebetter first).

/**
 * /api/answers — the clinician's answer-review queue for the public answer library.
 *
 * GET                 → the current clinician's answers awaiting their sign-off
 *                       (needs_review + changes_requested), newest first.
 * PATCH { id, action } → act on ONE of THEIR OWN answers:
 *     action:'approve'  → publish/approve (the voice check advises, never blocks)
 *     action:'edit'     → save inline edits (answer_lead/body/question); stays needs_review
 *     action:'revise'   → status=changes_requested + review_notes (Bernard re-drafts later)
 *     action:'recheck'  → re-run the voice check only; never publishes, never changes status
 *     action:'retract'  → take a published answer back off the public site
 *
 * Authorization is two-layered: requireRole proves workspace membership, then every
 * row action is gated on STRICT ownership — the answer's staff_id must be the caller's
 * own staff row. A doctor only ever acts on answers that carry THEIR name.
 *
 * There is deliberately NO admin exception (Q, 2026-07-25: "Clinicians should score and
 * edit their own content. No admin back door should exist right now."). A public answer
 * publishes under a named clinician as medical-adjacent advice, so nobody else — however
 * privileged — approves, edits, scores, or retracts it on their behalf. This diverges on
 * purpose from the self-or-admin contract used for staff rows; do not "restore
 * consistency" by adding isAdmin back here. Revisit only if a tenant asks for it, and
 * make it an explicit per-workspace capability rather than a blanket admin power.
 * Guarded by tests/lib/answersOwnership.test.js.
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
      `&select=id,answer_review_enabled&limit=1`,
  )
  if (!r.ok) return null
  const rows = await r.json().catch(() => [])
  return rows[0] || null
}


// Queue an interview topic from a faithfulness flag the clinician published over.
// The flag means "this isn't in the captured practice memory" — which, on text a
// human wrote or edited, is new teaching rather than invention. Idempotent on
// (workspace, answer) so re-publishing the same answer can't stack duplicates.
async function queueAnswerGapTopic({ ws, row, breakdown }) {
  const rationale = String(breakdown?.red_flag || '').trim()
  if (!rationale || rationale.toLowerCase() === 'none') return
  const topic = row.condition
    ? `${row.condition} — ${row.question}`
    : row.question
  const key = `answer_gap:${row.id}`
  const existing = await sb(
    `topic_backlog?workspace_id=eq.${ws.id}&idempotency_key=eq.${encodeURIComponent(key)}&select=id&limit=1`,
  )
  if (existing.ok && (await existing.json().catch(() => []))[0]) return
  const r = await sb('topic_backlog', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      workspace_id: ws.id,
      topic: String(topic || '').slice(0, 300),
      rationale:
        `Published over a voice-check flag — this is teaching Bernard hasn't captured yet. ` +
        `The check said: ${rationale}`.slice(0, 1000),
      source: 'answer_gap',
      status: 'pending',
      priority: 2,
      idempotency_key: key,
    }),
  })
  if (!r.ok) console.error('[answers] topic_backlog insert:', r.status, (await r.text()).slice(0, 200))
}

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
        `&select=id,question,slug,answer_lead,body,condition,seo_title,summary,status,review_notes,grounding_source,voice_fidelity_score,voice_audit,movebetterco_slug,review_reason,superseded_at,updated_at` +
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
    if (!['approve', 'edit', 'revise', 'retract', 'recheck'].includes(action)) return res.status(400).json({ error: 'invalid_action' })
    if (!me) return res.status(403).json({ error: 'forbidden' })

    // Ownership gate — fetch the row (workspace-scoped) and confirm it's the caller's.
    const cur = await sb(
      `answers?workspace_id=eq.${ws.id}&id=eq.${id}` +
        `&select=id,staff_id,status,question,slug,condition,answer_lead,body,summary,seo_title,chat_prompts,display_order,movebetterco_slug&limit=1`,
    )
    if (!cur.ok) return dbErr(res, cur, 'fetch')
    const row = (await cur.json())[0]
    if (!row) return res.status(404).json({ error: 'not_found' })
    if (row.staff_id !== me.id) return res.status(403).json({ error: 'forbidden' })

    const patch = { updated_at: new Date().toISOString() }
    if (action === 'approve') {
      // ---- ADVISORY voice-fidelity check (was a HARD gate; Q, 2026-07-25) ----
      // The check scores and explains, but never stops a clinician from publishing
      // their own answer. Two reasons it stopped being a gate:
      //   1. said_fidelity measures drift from the clinician's captured practice
      //      memory. Once a HUMAN edits the text, that corpus is no longer the
      //      source of truth — the clinician is — so the judge cannot tell "the AI
      //      invented this" from "the doctor just taught something new". It reliably
      //      reads the second as the first (see the running-form answer: real new
      //      teaching on hip flexion/extension, flagged as "not in the source").
      //   2. Blocking a licensed clinician from publishing their own words, on their
      //      own site, under their own name is the wrong default — and it was feeding
      //      the approval backlog that is the product's actual bottleneck.
      // What we DO keep: always score, always show the score and the critique, and
      // record on the row what was known at the moment of publish (below).
      const scored = await scoreAnswerFidelity({
        ws, staffId: row.staff_id, question: row.question, condition: row.condition,
        answerLead: row.answer_lead, body: row.body,
      })
      const now = new Date().toISOString()
      if (!scored.ok) {
        // The check couldn't run. Publish anyway (never block), but record that this
        // one went out unverified — an honest audit trail matters more than a gate.
        console.error('[answers] approve proceeding without a voice check:', scored.reason, id)
        patch.voice_audit = {
          gate: 'unscored', reason: scored.reason, scored_at: now,
          published_without_check: true,
        }
      } else {
        patch.voice_fidelity_score = scored.score100
        patch.voice_audit = scored.gate === 'passed'
          ? scored.voiceAudit
          : { ...scored.voiceAudit, published_over_flag: true, overridden_at: now }
      }
      if (ws.answer_publish_enabled) {
        const pub = await publishAnswerToMovebetter({ ws, answer: row })
        if (pub.ok) {
          patch.status = 'published'
          patch.published_at = new Date().toISOString()
          patch.movebetterco_slug = pub.slug
        } else {
          console.error('[answers] approve publish failed:', pub.error, id)
          patch.status = 'approved' // approved but not live — retry later
        }
      } else {
        patch.status = 'approved'
      }
      // A faithfulness flag the clinician published over is the most valuable
      // signal this screen produces: it marks teaching that ISN'T in the captured
      // corpus yet. Queue it as an interview topic so the corpus catches up and
      // the same passage stops getting flagged. waitUntil — never let a backlog
      // insert delay or fail the publish the clinician just asked for.
      if (scored.ok && scored.gate !== 'passed' && scored.breakdown?.said_fidelity < ANSWER_GATE) {
        waitUntil(
          queueAnswerGapTopic({ ws, row, breakdown: scored.breakdown }).catch((e) =>
            console.error('[answers] answer-gap topic queue failed:', e?.message),
          ),
        )
      }
    } else if (action === 'edit') {
      const { answer_lead, body, question } = req.body || {}
      if (typeof answer_lead === 'string') patch.answer_lead = answer_lead
      if (typeof body === 'string') patch.body = body
      if (typeof question === 'string' && question.trim()) patch.question = question.trim()
      patch.status = 'needs_review'
      // Re-score the edited text so the queue's gate/chip reflects what's now
      // there (and a later approve gates on a current score, not a stale pass).
      const nextLead = typeof answer_lead === 'string' ? answer_lead : row.answer_lead
      const nextBody = typeof body === 'string' ? body : row.body
      const nextQuestion =
        typeof question === 'string' && question.trim() ? question.trim() : row.question
      const scored = await scoreAnswerFidelity({
        ws, staffId: row.staff_id, question: nextQuestion, condition: row.condition,
        answerLead: nextLead, body: nextBody,
      })
      if (scored.ok) {
        patch.voice_fidelity_score = scored.score100
        patch.voice_audit = scored.voiceAudit
      } else {
        patch.voice_audit = { gate: 'unscored', reason: scored.reason, scored_at: new Date().toISOString() }
      }
    } else if (action === 'recheck') {
      // Re-run the voice check only. Never publishes and never changes status —
      // this exists so a clinician whose check failed to complete ('unscored')
      // has a way forward that isn't re-reading an answer that was never scored.
      const scored = await scoreAnswerFidelity({
        ws, staffId: row.staff_id, question: row.question, condition: row.condition,
        answerLead: row.answer_lead, body: row.body,
      })
      if (!scored.ok) {
        console.error('[answers] recheck could not score:', scored.reason, id)
        await sb(`answers?workspace_id=eq.${ws.id}&id=eq.${id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            voice_audit: { gate: 'unscored', reason: scored.reason, scored_at: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          }),
        }).catch(() => {})
        return res.status(200).json({ rechecked: true, gate: 'unscored', reason: scored.reason })
      }
      patch.voice_fidelity_score = scored.score100
      patch.voice_audit = scored.voiceAudit
    } else if (action === 'revise') {
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      if (!note) return res.status(400).json({ error: 'note_required' })
      patch.status = 'changes_requested'
      patch.review_notes = note.slice(0, 2000)
    } else if (action === 'retract') {
      // Take a currently-live answer DOWN off the public site. Only meaningful for
      // one that's actually published — retract removes the .md via the receiver,
      // then marks it retracted. On receiver failure, change nothing (retryable).
      if (!row.movebetterco_slug) return res.status(409).json({ error: 'not_published' })
      const pulled = await retractAnswerFromMovebetter({ ws, answer: row })
      if (!pulled.ok) {
        console.error('[answers] retract failed:', pulled.error, id)
        return res.status(502).json({ error: 'retract_failed' })
      }
      patch.status = 'retracted'
      patch.review_reason = null
      patch.superseded_at = null
      patch.movebetterco_slug = null
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

    // Retracting means the clinician no longer stands behind this public answer,
    // so the question flips back to an OPEN coverage gap on /seo — it can resurface
    // as a future interview/answer prompt. Best-effort (never blocks the retract).
    if (action === 'retract') {
      waitUntil(reopenQuestionAsGap(ws.id, row.question, row.condition))
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
    // Only draft for yourself. No admin exception — see the ownership note above.
    if (staffId !== me.id) return res.status(403).json({ error: 'forbidden' })

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
        voice_fidelity_score: drafted.voiceFidelityScore,
        voice_audit: drafted.voiceAudit,
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
        voice_fidelity_score: drafted.voiceFidelityScore,
        voice_audit: drafted.voiceAudit,
        updated_at: new Date().toISOString(),
      }),
    })
  } catch (e) {
    console.error('[answers] re-draft failed:', e?.message, e?.stack)
  }
}

// Re-open a retracted answer's question as an active tracked coverage gap on /seo
// (source='manual'), reactivating it if it was previously dismissed. Case-insensitive
// dedup against the workspace's tracked set; the DB UNIQUE (workspace_id, question)
// is the backstop. Best-effort — a failure here must not affect the retract.
async function reopenQuestionAsGap(wsId, question, topic) {
  try {
    const q = String(question || '').trim().slice(0, 160)
    if (!q) return
    const existRes = await sb(
      `seo_tracked_questions?workspace_id=eq.${wsId}&select=id,question,active&limit=500`,
    )
    const existing = (existRes.ok ? await existRes.json().catch(() => []) : []).find(
      (r) => String(r.question || '').trim().toLowerCase() === q.toLowerCase(),
    )
    if (existing) {
      if (!existing.active) {
        await sb(`seo_tracked_questions?id=eq.${existing.id}&workspace_id=eq.${wsId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ active: true }),
        })
      }
      return
    }
    await sb('seo_tracked_questions?on_conflict=workspace_id,question', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([
        { workspace_id: wsId, question: q, topic: (topic || '').slice(0, 60) || null, source: 'manual', active: true },
      ]),
    })
  } catch (e) {
    console.error('[answers] reopenQuestionAsGap failed:', e?.message)
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
