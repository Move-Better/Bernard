// authorAnswers — the Standing Producer's `author_answers` lane.
//
// Closes the citation flywheel: for each tracked question the practice hasn't
// answered yet (a scoreboard gap), draft an answer in the best-fit clinician's
// voice (draftAnswer) and drop it into their review queue as needs_review /
// source='producer'. Nothing publishes — the clinician still approves. Bounded
// by the caller's per-tick cap + the daily AI-call budget.

import { draftAnswer } from './draftAnswer.js'
import { recordAgentAction } from '../agentActions.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

function slugify(q) {
  return String(q)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

// Route a gap to the clinician with the most topic-relevant practice memory.
// Returns null when NO clinician has coverage — the lane then skips the gap
// rather than drafting an ungrounded answer (e.g. "body tempering" that nobody
// has documented, or an off-topic question). Grounded drafts only.
async function pickClinician(wsId, topic, clinicians) {
  // Longest word = most specific: 'tempering' over 'body', 'herniation' over 'disc'.
  // A generic first word ('body') would falsely match coverage the topic lacks.
  const kw = (String(topic || '').toLowerCase().match(/[a-z]{4,}/g) || []).sort((a, b) => b.length - a.length)[0]
  if (!kw) return null
  const clinIds = new Set(clinicians.map((c) => c.id))
  const r = await sb(
    `practice_memory_chunks?workspace_id=eq.${wsId}&text=ilike.*${encodeURIComponent(kw)}*&select=staff_id&limit=400`,
  )
  if (!r.ok) return null
  const rows = await r.json().catch(() => [])
  const counts = {}
  for (const row of rows) {
    if (row.staff_id && clinIds.has(row.staff_id)) counts[row.staff_id] = (counts[row.staff_id] || 0) + 1
  }
  // Tie-break deterministically by staff id (not DB row order) so a coverage tie
  // always resolves the same way instead of depending on query result ordering.
  // Rule: smallest UUID wins a tie, not first-seen — the `sid < bestId` check
  // only swaps when the new id sorts lower, so this stays correct regardless
  // of Object.entries() iteration order. Don't refactor this loop to `Map` or
  // reorder it assuming "first inserted wins" semantics.
  let bestId = null
  let bestN = 0
  for (const [sid, n] of Object.entries(counts)) {
    if (n > bestN || (n === bestN && bestId && sid < bestId)) { bestN = n; bestId = sid }
  }
  return bestId ? clinicians.find((c) => c.id === bestId) : null
}

/**
 * Draft answers for up to `maxDrafts` open scoreboard-gap questions.
 * @returns {Promise<{drafted:number, candidates:number}>}
 */
export async function authorAnswersForGaps({ ws, maxDrafts }) {
  if (!maxDrafts || maxDrafts < 1) return { drafted: 0, candidates: 0 }

  // Active tracked questions (the scoreboard gap list). Table may not exist on
  // older tenants — treat any failure as "no gaps".
  const gapRes = await sb(
    `seo_tracked_questions?workspace_id=eq.${ws.id}&active=is.true&select=question,topic&order=created_at.asc&limit=40`,
  ).catch(() => null)
  if (!gapRes || !gapRes.ok) return { drafted: 0, candidates: 0 }
  const gaps = await gapRes.json().catch(() => [])
  if (!gaps.length) return { drafted: 0, candidates: 0 }

  // Skip a gap if an existing answer already covers it — by exact question OR by
  // topic/condition. The topic check catches near-duplicate phrasings (e.g. a
  // tracked "What causes disc herniation and how is it treated?" when an answer
  // with condition "Disc herniation" already exists), which exact-text can't.
  const ansRes = await sb(`answers?workspace_id=eq.${ws.id}&select=question,condition`)
  const ansRows = ansRes.ok ? await ansRes.json().catch(() => []) : []
  const norm = (s) => String(s || '').trim().toLowerCase()
  const answeredQ = new Set(ansRows.map((a) => norm(a.question)))
  const answeredTopic = new Set(ansRows.map((a) => norm(a.condition)).filter(Boolean))
  const open = gaps.filter(
    (g) => g.question && !answeredQ.has(norm(g.question)) && !(g.topic && answeredTopic.has(norm(g.topic))),
  )
  if (!open.length) return { drafted: 0, candidates: 0 }

  // Clinicians who can own an answer (have a login + a voice).
  const clinRes = await sb(
    `staff?workspace_id=eq.${ws.id}&staff_type=eq.clinician&user_id=not.is.null&select=id,name`,
  )
  const clinicians = clinRes.ok ? await clinRes.json() : []
  if (!clinicians.length) return { drafted: 0, candidates: open.length }

  let drafted = 0
  let skippedNoCoverage = 0
  for (const g of open) {
    if (drafted >= maxDrafts) break
    const clinician = await pickClinician(ws.id, g.topic || g.question, clinicians)
    if (!clinician) { skippedNoCoverage++; continue }

    const d = await draftAnswer({ ws, staffId: clinician.id, question: g.question, condition: g.topic })
    if (!d) continue

    const ins = await sb('answers', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        staff_id: clinician.id,
        question: g.question,
        slug: slugify(g.question),
        answer_lead: d.answer_lead,
        body: d.body,
        condition: g.topic || null,
        status: 'needs_review',
        source: 'producer',
        grounding_source: `Bernard drafted this from ${d.staffName}'s practice memory — a question you're not cited on yet.`,
      }),
    })
    if (ins.status === 409) continue // slug already taken — skip
    if (!ins.ok) {
      console.error('[authorAnswers] insert failed', ins.status)
      continue
    }
    drafted++

    await recordAgentAction({
      workspaceId: ws.id,
      producerConfig: ws.producer_config,
      kind: 'answer_drafted',
      title: `Drafted answer "${String(g.question).slice(0, 60)}" for ${d.staffName}`,
      detail: { question: g.question, topic: g.topic || null, staff_id: clinician.id },
      model: 'anthropic/claude-sonnet-4-6', // counts as 1 AI call against the daily cap
    })
  }

  if (skippedNoCoverage > 0) {
    console.info(
      `[authorAnswers] workspace_id=${ws.id} skipped ${skippedNoCoverage} gap(s) — no clinician has practice-memory coverage`,
    )
  }

  return { drafted, candidates: open.length, skippedNoCoverage }
}
