// api/_lib/momentExtract.js
//
// Moment bank extraction (P2, .claude/moment-bank-sprint.md). On interview
// completion (and via scripts/backfill-moments.mjs for historical interviews):
//
//   1. One LLM pass over the clinician's raw transcript turns proposing
//      standalone moments — each with a VERBATIM excerpt.
//   2. Verbatim anchoring: every excerpt is located character-exactly inside
//      interviews.messages (whitespace/curly-quote-tolerant search, but the
//      STORED excerpt is always the exact on-disk slice). An excerpt the
//      locator can't find in the transcript is DROPPED — that's the
//      fabrication guard behind the one-source-anchor decision.
//   3. Scoring via the existing scoreSegments() rubric (same 0-100 scale +
//      moment_type taxonomy as the Moment Miner video feed). Only candidates
//      at/above MOMENT_BANK_MIN_SCORE bank — expect 10-15 per interview.
//   4. Dedup/clustering: embed each excerpt, match against the workspace's
//      existing banked moments (match_moments RPC, migration 191) AND against
//      earlier inserts in the same batch. A near-duplicate joins the existing
//      cluster; the highest-scoring member of a cluster is its exemplar and
//      the planner (P3) only ever draws exemplars.
//
// Never throws: returns a summary object either way, so the completion hook
// can waitUntil() it and the backfill can tally results. All awaits are real
// awaits inside the one promise (waitUntil only covers work it can see).

import { generateObject } from 'ai'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { scoreSegments } from './scoreMoments.js'
import { embedTexts } from './embeddings.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const MODEL = 'anthropic/claude-sonnet-4-6'

// Extraction bar — provisional until the first backfill's score distribution
// sets it empirically (spec open question). Env-overridable so tuning doesn't
// need a deploy.
export const MOMENT_BANK_MIN_SCORE = Number(process.env.MOMENT_BANK_MIN_SCORE || 60)
// Cosine similarity at/above which two moments are the same idea (one cluster).
// text-embedding-3-small near-duplicate territory; tune from the backfill's
// neighbor-similarity report.
export const MOMENT_DEDUP_SIM = Number(process.env.MOMENT_DEDUP_SIM || 0.85)

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(15_000),
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

/**
 * Clinician turns from an interviews.messages array, keeping the RAW message
 * index so anchors point into the canonical stored array (not a filtered copy).
 * @param {Array<{role?:string, content?:unknown}>} messages
 * @returns {Array<{msgIdx:number, content:string}>}
 */
export function clinicianTurns(messages) {
  if (!Array.isArray(messages)) return []
  const out = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m?.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      out.push({ msgIdx: i, content: m.content })
    }
  }
  return out
}

// Whitespace-collapsed, straight-quoted view of a string plus a map back to
// raw indices, so a model excerpt that differs only in whitespace/quote style
// still anchors to the exact on-disk characters.
function buildNormalized(content) {
  const map = []
  let norm = ''
  let lastWasSpace = false
  for (let i = 0; i < content.length; i++) {
    let ch = content[i]
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue
      ch = ' '
      lastWasSpace = true
    } else {
      lastWasSpace = false
      if (ch === '‘' || ch === '’') ch = "'"
      else if (ch === '“' || ch === '”') ch = '"'
    }
    map.push(i)
    norm += ch
  }
  return { norm, map }
}

/**
 * Locate an excerpt inside a message's content. Direct match first; falls back
 * to a whitespace/quote-normalized search. Returns the EXACT raw slice (which
 * is what gets stored — verbatim by construction), or null if the text simply
 * isn't in the message.
 * @param {string} content
 * @param {string} excerpt
 * @returns {{char_start:number, char_end:number, exact:string}|null}
 */
export function locateExcerpt(content, excerpt) {
  if (typeof content !== 'string' || typeof excerpt !== 'string') return null
  const wanted = excerpt.trim()
  if (!wanted) return null
  const direct = content.indexOf(wanted)
  if (direct >= 0) {
    return { char_start: direct, char_end: direct + wanted.length, exact: wanted }
  }
  const c = buildNormalized(content)
  const e = buildNormalized(wanted)
  if (!e.norm) return null
  const at = c.norm.indexOf(e.norm)
  if (at < 0) return null
  const start = c.map[at]
  const end = c.map[at + e.norm.length - 1] + 1
  return { char_start: start, char_end: end, exact: content.slice(start, end) }
}

/** Plain cosine similarity for batch-local dedup (server-side dedup uses the RPC). */
export function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0
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

const proposalSchema = z.object({
  moments: z.array(z.object({
    turn: z.number().int().min(0),
    excerpt: z.string().min(40).max(700),
    hook: z.string().min(3).max(120),
    why_it_stands_alone: z.string().min(3).max(300),
    topic: z.string().max(80).default(''),
    tags: z.array(z.string().max(40)).max(6).default([]),
  })).max(24).default([]),
})

function buildExtractionSystem(ws) {
  const who = ws?.clinic_context ? String(ws.clinic_context).slice(0, 240) : 'a clinical practice'
  return [
    `You mine standalone content moments from a real recorded interview with a clinician at ${ws?.display_name || 'a clinical practice'}.`,
    `Practice context: ${who}.`,
    '',
    'A moment is a passage of the CLINICIAN\'S OWN WORDS that could anchor a social post on its own: a teachable cue, a patient breakthrough, a counterintuitive insight, a concrete technique, a vivid story, a credibility-building explanation, or a scroll-stopping line.',
    '',
    'Rules:',
    '- excerpt: copied CHARACTER-FOR-CHARACTER from one clinician turn. Do not paraphrase, trim words mid-quote, fix grammar, or stitch text from two places. One contiguous span from one turn only. 1-4 sentences.',
    '- turn: the number of the clinician turn (as labeled below) the excerpt comes from.',
    '- hook: a short scroll-stopping framing line for the moment (your words).',
    '- why_it_stands_alone: one sentence on why it works without surrounding context.',
    '- topic: 2-5 word topic slug (e.g. "sciatica flare-ups", "knee pain squats").',
    '- tags: up to 6 short lowercase tags.',
    '- Propose every genuinely standalone moment you find (typically 10-20 in a full interview; fewer in a short one). Skip filler, logistics, mid-thought fragments, and anything that needs the interviewer\'s question to land.',
    '- Do NOT include patient-identifying details or case narratives specific enough to identify a person.',
    '',
    'Output JSON only.',
  ].join('\n')
}

function buildExtractionUser(turns) {
  const lines = ['Clinician turns:', '']
  turns.forEach((t, i) => {
    lines.push(`[turn ${i}]`)
    lines.push(t.content)
    lines.push('')
  })
  return lines.join('\n')
}

async function fetchClusterExemplar(clusterId) {
  const r = await sb(`moments?cluster_id=eq.${clusterId}&is_exemplar=eq.true&select=id,score&limit=1`)
  if (!r.ok) return null
  const rows = await r.json().catch(() => [])
  return rows[0] || null
}

/**
 * Extract, score, dedup, and bank moments for one completed interview.
 *
 * Idempotent per interview: if the interview already has moments rows, it
 * no-ops — safe against the completion PATCH firing twice and against a
 * backfill re-run.
 *
 * @param {object} args
 * @param {object} args.workspace  workspaces row (id, display_name, clinic_context at minimum)
 * @param {object} args.interview  { id, staff_id, topic, region, messages }
 * @returns {Promise<object>} summary — never throws
 */
export async function extractAndBankMoments({ workspace, interview }) {
  const summary = {
    ok: false, interviewId: interview?.id, proposed: 0, located: 0,
    scored: [], banked: 0, belowBar: 0, dropped_unlocatable: 0,
    clustersJoined: 0, skipped: null, error: null,
  }
  try {
    if (!workspace?.id || !interview?.id) {
      summary.skipped = 'missing-args'
      return summary
    }
    // Idempotency: one extraction per interview, ever.
    const existing = await sb(`moments?interview_id=eq.${interview.id}&select=id&limit=1`)
    if (existing.ok && (await existing.json()).length > 0) {
      summary.skipped = 'already-extracted'
      summary.ok = true
      return summary
    }

    const turns = clinicianTurns(interview.messages)
    // Under ~200 chars of clinician speech there's nothing standalone to mine.
    const totalChars = turns.reduce((s, t) => s + t.content.length, 0)
    if (totalChars < 200) {
      summary.skipped = 'no-transcript'
      summary.ok = true
      return summary
    }

    // 1. Propose.
    const { object } = await generateObject({
      model: MODEL,
      schema: proposalSchema,
      instructions: buildExtractionSystem(workspace),
      messages: [{ role: 'user', content: buildExtractionUser(turns) }],
      temperature: 0.3,
      maxOutputTokens: 8000,
    })
    const proposals = object?.moments || []
    summary.proposed = proposals.length
    if (!proposals.length) {
      summary.ok = true
      return summary
    }

    // 2. Verbatim anchoring — drop anything the transcript doesn't contain.
    const located = []
    for (const p of proposals) {
      const candidates = []
      if (p.turn >= 0 && p.turn < turns.length) candidates.push(turns[p.turn])
      for (const t of turns) if (!candidates.includes(t)) candidates.push(t)
      let hit = null
      for (const t of candidates) {
        const loc = locateExcerpt(t.content, p.excerpt)
        if (loc) { hit = { ...loc, msgIdx: t.msgIdx }; break }
      }
      if (!hit) { summary.dropped_unlocatable++; continue }
      located.push({
        excerpt: hit.exact,
        anchor: { msg_idx: hit.msgIdx, char_start: hit.char_start, char_end: hit.char_end },
        hook: p.hook,
        why_it_stands_alone: p.why_it_stands_alone,
        topic: p.topic || null,
        tags: (p.tags || []).filter(Boolean),
      })
    }
    summary.located = located.length
    if (!located.length) {
      summary.ok = true
      return summary
    }

    // 3. Score on the shared Moment Miner rubric.
    const scores = await scoreSegments(
      located.map((m) => ({ hook: m.hook, why_it_stands_alone: m.why_it_stands_alone, transcript_excerpt: m.excerpt })),
      workspace,
    )
    for (let i = 0; i < located.length; i++) {
      located[i].score = scores[i]?.score ?? 55
      located[i].moment_type = scores[i]?.moment_type ?? 'insight'
    }
    summary.scored = located.map((m) => m.score)

    const bankable = located.filter((m) => m.score >= MOMENT_BANK_MIN_SCORE)
    summary.belowBar = located.length - bankable.length
    if (!bankable.length) {
      summary.ok = true
      return summary
    }

    // 4. Embed + dedup/cluster + insert, best-first so within a cluster the
    // strongest candidate is the one that claims exemplar.
    const vectors = await embedTexts(bankable.map((m) => m.excerpt))
    for (let i = 0; i < bankable.length; i++) bankable[i].embedding = vectors[i]
    bankable.sort((a, b) => b.score - a.score)

    const batchInserted = [] // { id, cluster_id, is_exemplar, score, embedding }
    for (const m of bankable) {
      if (!m.embedding) continue // embed failure for this row — don't bank unclusterable rows
      const vecLiteral = `[${m.embedding.join(',')}]`

      // Best existing-workspace neighbor…
      let match = null
      const rpc = await sb('rpc/match_moments', {
        method: 'POST',
        body: JSON.stringify({
          p_workspace: workspace.id,
          p_query_embedding: vecLiteral,
          p_match_count: 1,
          p_min_sim: MOMENT_DEDUP_SIM,
        }),
      })
      if (rpc.ok) {
        const rows = await rpc.json().catch(() => [])
        if (rows[0]) match = { cluster_id: rows[0].cluster_id, similarity: rows[0].similarity }
      }
      // …vs best batch-local neighbor (this session's own inserts).
      for (const b of batchInserted) {
        const sim = cosineSim(m.embedding, b.embedding)
        if (sim >= MOMENT_DEDUP_SIM && (!match || sim > match.similarity)) {
          match = { cluster_id: b.cluster_id, similarity: sim }
        }
      }

      let clusterId
      let isExemplar
      if (match?.cluster_id) {
        clusterId = match.cluster_id
        summary.clustersJoined++
        const exemplar = await fetchClusterExemplar(clusterId)
        isExemplar = !exemplar || m.score > (exemplar.score ?? 0)
        if (isExemplar) {
          // Demote the old exemplar(s) — covers batch-local ones too, since
          // they're already inserted rows.
          await sb(`moments?cluster_id=eq.${clusterId}&is_exemplar=eq.true`, {
            method: 'PATCH',
            body: JSON.stringify({ is_exemplar: false, updated_at: new Date().toISOString() }),
            headers: { Prefer: 'return=minimal' },
          })
          for (const b of batchInserted) if (b.cluster_id === clusterId) b.is_exemplar = false
        }
      } else {
        clusterId = randomUUID()
        isExemplar = true
      }

      const insRes = await sb('moments', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: workspace.id,
          interview_id: interview.id,
          staff_id: interview.staff_id ?? null,
          excerpt: m.excerpt,
          anchor: m.anchor,
          hook: m.hook,
          moment_type: m.moment_type,
          topic: m.topic,
          region: interview.region ?? null,
          tags: m.tags,
          score: m.score,
          embedding: vecLiteral,
          cluster_id: clusterId,
          is_exemplar: isExemplar,
        }),
        headers: { Prefer: 'return=representation' },
      })
      if (!insRes.ok) {
        const body = await insRes.text().catch(() => '')
        console.error(`[momentExtract] insert ${insRes.status} for interview=${interview.id}: ${body.slice(0, 300)}`)
        continue
      }
      const [row] = await insRes.json().catch(() => [])
      batchInserted.push({
        id: row?.id, cluster_id: clusterId, is_exemplar: isExemplar,
        score: m.score, embedding: m.embedding,
      })
      summary.banked++
    }

    summary.ok = true
    return summary
  } catch (e) {
    summary.error = e?.message || String(e)
    console.error(`[momentExtract] failed for interview=${interview?.id}:`, e?.stack || e?.message || e)
    return summary
  }
}
