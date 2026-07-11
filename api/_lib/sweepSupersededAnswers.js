// sweepSupersededAnswers — F16 Phase 3.
//
// When a clinician CONFIRMS a supersession (their thinking on a topic changed),
// find their PUBLISHED public answers that are semantically ON that topic, re-draft
// each in the now-updated voice (draftAnswer's RAG suppresses the superseded chunk
// once the edge is confirmed), re-run the voice-fidelity gate, and drop the fresh
// draft back into their review queue as needs_review — WITHOUT touching the live
// movebetter.co page. The clinician approves (replace) or retracts (take down).
//
// Matching is semantic (cosine of the answer text vs the superseding chunk's
// embedding) so only genuinely-related answers get re-surfaced — a false "your
// answer is stale" is expensive to the clinician's trust. Never throws; runs in a
// waitUntil off the confirm handler.

import { embedText } from './embeddings.js'
import { draftAnswer } from './producer/draftAnswer.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Below this cosine, the answer isn't "on the topic that changed" — leave it live.
// Answer prose vs a memory chunk is a cross-genre comparison, so the bar sits a
// little under the chunk-to-chunk detector threshold (0.6 in supersessionDetect).
const AFFECTED_SIM = 0.55
const MAX_ANSWERS = 12 // safety cap on re-draft calls per confirmed supersession

function sb(path, init = {}) {
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

function parseEmbedding(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  return null
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * Sweep one confirmed supersession's clinician for affected published answers,
 * re-draft them, and re-queue for review.
 * @param {object} args.ws              resolved workspace ({ id, ... })
 * @param {string} args.supersessionId  practice_memory_supersessions.id (confirmed)
 * @returns {Promise<{checked:number, affected:number, error?:string}>}
 */
export async function sweepSupersededAnswers({ ws, supersessionId }) {
  if (!ws?.id || !supersessionId) return { checked: 0, affected: 0, skipped: 'bad-args' }
  try {
    // 1. The confirmed edge — need the clinician + the superseding (new) chunk.
    const sRes = await sb(
      `practice_memory_supersessions?id=eq.${supersessionId}&workspace_id=eq.${ws.id}` +
        `&status=eq.confirmed&select=id,staff_id,new_chunk_id,new_excerpt&limit=1`,
    )
    if (!sRes.ok) throw new Error(`supersession fetch ${sRes.status}`)
    const sup = (await sRes.json())[0]
    if (!sup || !sup.staff_id) return { checked: 0, affected: 0, skipped: 'not-confirmed' }

    // 2. The superseding chunk's embedding = the "topic that changed" vector.
    const cRes = await sb(
      `practice_memory_chunks?id=eq.${sup.new_chunk_id}&workspace_id=eq.${ws.id}&select=embedding&limit=1`,
    )
    const newEmbedding = cRes.ok ? parseEmbedding((await cRes.json())[0]?.embedding) : null
    if (!newEmbedding) return { checked: 0, affected: 0, skipped: 'no-embedding' }

    // 3. The clinician's currently-live answers (published, still on the site).
    const aRes = await sb(
      `answers?workspace_id=eq.${ws.id}&staff_id=eq.${sup.staff_id}&status=eq.published` +
        `&movebetterco_slug=not.is.null&select=id,question,condition,answer_lead,body`,
    )
    if (!aRes.ok) throw new Error(`answers fetch ${aRes.status}`)
    const answers = await aRes.json()
    if (answers.length === 0) return { checked: 0, affected: 0 }

    let checked = 0
    let affected = 0
    const nowIso = new Date().toISOString()
    const reviseNote =
      `Your thinking on this topic has shifted. Your current position: "${String(sup.new_excerpt || '').slice(0, 400)}". ` +
      `Update this answer to reflect it and drop anything that reflects your older approach.`

    for (const a of answers) {
      if (affected >= MAX_ANSWERS) break
      checked++

      // Is this answer on the topic that changed?
      const text = `${a.question}\n${a.answer_lead || ''}`.slice(0, 1200)
      let sim = 0
      try {
        const ae = await embedText(text)
        sim = cosine(ae, newEmbedding)
      } catch {
        continue // embedding hiccup — leave this answer live, don't guess
      }
      if (sim < AFFECTED_SIM) continue

      // Re-draft in the updated voice (RAG now suppresses the superseded chunk).
      const drafted = await draftAnswer({
        ws,
        staffId: sup.staff_id,
        question: a.question,
        condition: a.condition,
        existing: { answer_lead: a.answer_lead, body: a.body },
        reviseNote,
      })
      if (!drafted) continue

      // Re-queue the fresh draft for review. Keep movebetterco_slug set (the old
      // page stays live) and mark WHY it re-surfaced so the UI can show the
      // "still live — approve to replace, or retract" treatment.
      const upd = await sb(`answers?workspace_id=eq.${ws.id}&id=eq.${a.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          answer_lead: drafted.answer_lead,
          body: drafted.body,
          status: 'needs_review',
          review_reason: 'superseded',
          superseded_by: sup.id,
          superseded_at: nowIso,
          review_notes: null,
          voice_fidelity_score: drafted.voiceFidelityScore,
          voice_audit: drafted.voiceAudit,
          updated_at: nowIso,
        }),
      })
      if (upd.ok) affected++
      else console.error('[sweepSupersededAnswers] patch failed', a.id, upd.status)
    }

    if (affected) {
      console.info(
        `[sweepSupersededAnswers] ws=${ws.id} sup=${supersessionId}: ${affected} answer(s) re-drafted from ${checked} live`,
      )
    }
    return { checked, affected }
  } catch (e) {
    console.error(`[sweepSupersededAnswers] threw: ${e?.stack || e?.message}`)
    return { checked: 0, affected: 0, error: e?.message || String(e) }
  }
}
