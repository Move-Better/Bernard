// api/_lib/sweepDriftedAnswers.js
//
// Re-score LIVE answers on a schedule and re-queue the ones that have drifted
// from the clinician's voice (Q, 2026-07-25).
//
// Why this exists: a published answer only ever got scored at draft time. If the
// corpus grows and the clinician's captured thinking sharpens, a page that was
// fine at publish can end up not sounding like them — and nothing surfaced it,
// because published answers don't appear in the review queue. Found via the
// backfill scoring pass: Zach's live neck-pain page scored 7.33 for missing his
// own thoracic-spine signature. Safe, just not his.
//
// This is the drift twin of sweepSupersededAnswers.js: same re-queue mechanics
// (page STAYS live, review_reason marks why it came back), different trigger.
// That one fires when the clinician's thinking CHANGES; this one when the answer
// never matched it in the first place.
//
// Two rules keep it from nagging:
//   1. CADENCE — an answer is only eligible RECHECK_DAYS after the clinician last
//      acted on it (their publish, or the last sweep). Approving something never
//      bounces it straight back.
//   2. ACCEPTED FLAGS ARE RESPECTED — if they knowingly published over a flag,
//      that same flag does not come back. Only a MATERIAL drop below the score
//      they accepted re-queues it. Publishing over a flag is a considered
//      clinical judgement; re-litigating it on a timer would be the scheduled
//      version of the hard gate we just removed.

import { scoreAnswerFidelity, ANSWER_GATE } from './scoreAnswerFidelity.js'


import { supabaseRest } from './supabaseRest.js'
export const RECHECK_DAYS = 90
// How far below an ACCEPTED score the answer must fall before we re-raise a flag
// the clinician already stood behind. Judge scores move ±0.33 between runs on
// identical input, so anything smaller would re-queue on sampling noise alone.
export const MATERIAL_DROP = 0.5

const sb = (path, init = {}) => supabaseRest(path, init, { contentType: 'application/json' })


/**
 * The score this clinician has already seen and accepted for this answer, on the
 * 1–10 scale — or null if they never knowingly published over a flag.
 *
 * Prefers the explicit snapshot written at override time. Falls back to deriving
 * it from the row for answers that were overridden before that field existed:
 * there, voice_fidelity_score IS the accepted score, because the override is the
 * most recent thing that wrote it.
 */
export function acceptedBaseline(row) {
  const va = row?.voice_audit
  if (!va || typeof va !== 'object') return null
  if (typeof va.accepted_score === 'number') return va.accepted_score
  if (va.published_over_flag && typeof row.voice_fidelity_score === 'number') {
    return row.voice_fidelity_score / 10
  }
  return null
}

/**
 * Should a below-bar re-score be sent back to its author?
 *
 * @param {number}      overall   the fresh score (1–10)
 * @param {number|null} accepted  what they already accepted, if anything
 */
export function shouldRequeue(overall, accepted) {
  if (overall >= ANSWER_GATE) return false          // not flagged at all
  if (accepted === null) return true                // never accepted a flag here
  return overall <= accepted - MATERIAL_DROP        // materially worse than they accepted
}

/** Eligible for re-check? Paces off the clinician's own last action. */
export function isEligible(row, now = Date.now()) {
  const last = row.voice_rechecked_at || row.published_at
  if (!last) return false // never published — not a live answer, nothing to sweep
  return now - new Date(last).getTime() >= RECHECK_DAYS * 24 * 60 * 60 * 1000
}

/**
 * Sweep one workspace's live answers. Always returns a summary; never throws.
 */
export async function sweepDriftedAnswers(ws, { limit = 25, now = Date.now() } = {}) {
  const out = { checked: 0, requeued: 0, respected: 0, failed: 0 }
  if (!ws?.id) return out

  const r = await sb(
    `answers?workspace_id=eq.${ws.id}&status=eq.published&movebetterco_slug=not.is.null` +
      `&select=id,staff_id,question,condition,answer_lead,body,voice_audit,voice_fidelity_score,published_at,voice_rechecked_at` +
      `&order=voice_rechecked_at.asc.nullsfirst&limit=${limit}`,
  )
  if (!r.ok) {
    console.error('[sweepDriftedAnswers] fetch failed', r.status)
    return out
  }
  const rows = (await r.json().catch(() => [])) || []

  for (const row of rows) {
    if (!isEligible(row, now)) continue
    out.checked++

    const scored = await scoreAnswerFidelity({
      ws, staffId: row.staff_id, question: row.question, condition: row.condition,
      answerLead: row.answer_lead, body: row.body,
    })
    const nowIso = new Date(now).toISOString()

    if (!scored.ok) {
      // Couldn't score. Stamp the clock anyway so one persistently unscoreable
      // answer can't monopolise every future sweep, and leave the row untouched.
      out.failed++
      await sb(`answers?workspace_id=eq.${ws.id}&id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ voice_rechecked_at: nowIso }),
      }).catch(() => {})
      continue
    }

    const accepted = acceptedBaseline(row)
    const requeue = shouldRequeue(scored.overall, accepted)

    // Carry the accepted baseline forward, or this re-score would erase the
    // memory of what they signed off on and the next sweep would re-flag it.
    const audit = {
      ...scored.voiceAudit,
      voice_rechecked_at: nowIso,
      ...(accepted !== null ? { accepted_score: accepted } : {}),
    }

    const patch = {
      voice_fidelity_score: scored.score100,
      voice_audit: audit,
      voice_rechecked_at: nowIso,
      updated_at: nowIso,
    }
    if (requeue) {
      // Back to the author. The public page STAYS live (movebetterco_slug and
      // status of the live copy are untouched by review) — a drifted answer is
      // off-voice, not dangerous, so pulling it down unasked would be worse than
      // leaving it up while its author decides.
      patch.status = 'needs_review'
      patch.review_reason = 'voice_drift'
    }

    const upd = await sb(`answers?workspace_id=eq.${ws.id}&id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    })
    if (!upd.ok) {
      console.error('[sweepDriftedAnswers] patch failed', row.id, upd.status)
      out.failed++
      continue
    }
    if (requeue) out.requeued++
    else if (scored.overall < ANSWER_GATE) out.respected++
  }

  return out
}
