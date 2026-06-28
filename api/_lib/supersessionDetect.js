// F6 Phase 3 — supersession candidate detector (workspace-scoped).
//
// For recently-added chunks, find the same clinician's OLDER high-similarity
// chunks (via the match RPC), run the validated conflict judge, and insert a
// `pending` row in practice_memory_supersessions for any genuine "supersedes".
// The clinician confirms before anything is suppressed (only `confirmed` edges
// affect retrieval). Derivations/duplicates are filtered by the judge, not here
// (validated 2026-06-27: 0 false-positives on real derivation pairs).
//
// Cheap on a young corpus: candidate pairs (high-sim + older + not-already-judged)
// are rare, and maxPairs caps the judge calls. Never throws.

import { judgeSupersessionStable } from './supersessionJudge.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const SIM_THRESHOLD = 0.6     // below this, "same topic" is too weak to be a supersession
const EXCERPT_LEN   = 600

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

/**
 * Detect supersession candidates for one workspace.
 * @returns {Promise<{checked:number, judged:number, candidates:number, error?:string}>}
 */
export async function detectSupersessions({ workspaceId, sinceDays = 8, maxPairs = 20, samples = 3, fullScan = false, dryRun = false }) {
  if (!workspaceId) return { checked: 0, judged: 0, candidates: 0, skipped: 'no-workspace' }
  try {
    // 1. "Newer" chunks to check against history (recent unless fullScan).
    const sinceClause = fullScan
      ? ''
      : `&source_date=gte.${new Date(Date.now() - sinceDays * 86400_000).toISOString()}`
    const nwRes = await sb(
      `practice_memory_chunks?workspace_id=eq.${workspaceId}` +
      `&staff_id=not.is.null&embedding=not.is.null&source_date=not.is.null${sinceClause}` +
      `&select=id,staff_id,source_id,source_label,source_date,text,embedding&order=source_date.desc`
    )
    if (!nwRes.ok) throw new Error(`newer fetch ${nwRes.status}`)
    const newer = await nwRes.json()
    if (newer.length === 0) return { checked: 0, judged: 0, candidates: 0 }

    // 2. Existing edges (dedupe so we never re-judge or duplicate a candidate).
    const edgeRes = await sb(
      `practice_memory_supersessions?workspace_id=eq.${workspaceId}&select=old_chunk_id,new_chunk_id`
    )
    const edges = edgeRes.ok ? await edgeRes.json() : []
    const seen = new Set(edges.map((e) => `${e.old_chunk_id}:${e.new_chunk_id}`))

    let checked = 0
    let judged = 0
    let candidates = 0

    for (const nw of newer) {
      if (judged >= maxPairs) break
      checked++
      const emb = typeof nw.embedding === 'string' ? nw.embedding : `[${nw.embedding.join(',')}]`

      // Nearest same-staff neighbors (recency OFF so direction is unbiased).
      const mRes = await sb('rpc/match_practice_memory_chunks', {
        method: 'POST',
        body: JSON.stringify({
          p_workspace_id: workspaceId, p_staff_id: nw.staff_id, p_query_embedding: emb,
          p_match_count: 6, p_exclude_source_ids: [nw.source_id], p_source_types: null, p_half_life_days: null,
        }),
      })
      if (!mRes.ok) continue
      const neighbors = (await mRes.json()).filter((n) => n.id !== nw.id && (n.similarity ?? 0) >= SIM_THRESHOLD)
      if (neighbors.length === 0) continue

      // Need source_date per neighbor to confirm OLDER direction (RPC omits it).
      const ids = neighbors.map((n) => n.id)
      const dRes = await sb(`practice_memory_chunks?id=in.(${ids.join(',')})&select=id,source_date`)
      const dates = dRes.ok ? Object.fromEntries((await dRes.json()).map((r) => [r.id, r.source_date])) : {}

      for (const nb of neighbors) {
        if (judged >= maxPairs) break
        const nbDate = dates[nb.id]
        if (!nbDate || new Date(nbDate) >= new Date(nw.source_date)) continue   // must be strictly older
        if (seen.has(`${nb.id}:${nw.id}`)) continue
        seen.add(`${nb.id}:${nw.id}`)

        judged++
        const verdict = await judgeSupersessionStable({
          newerText: nw.text, olderText: nb.text,
          newerLabel: nw.source_label, olderLabel: nb.source_label, samples,
        })
        if (verdict.relationship !== 'supersedes') continue
        candidates++
        if (dryRun) continue

        await sb('practice_memory_supersessions?on_conflict=workspace_id,old_chunk_id,new_chunk_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            staff_id: nw.staff_id,
            old_chunk_id: nb.id,
            new_chunk_id: nw.id,
            old_source_id: nb.source_id,
            new_source_id: nw.source_id,
            old_source_label: nb.source_label,
            new_source_label: nw.source_label,
            old_excerpt: String(nb.text || '').slice(0, EXCERPT_LEN),
            new_excerpt: String(nw.text || '').slice(0, EXCERPT_LEN),
            relationship: 'supersedes',
            confidence: verdict.meanConfidence,
            rationale: verdict.runs ? `${verdict.votes}/${verdict.samples} agree` : null,
            status: 'pending',
          }),
        })
      }
    }

    return { checked, judged, candidates }
  } catch (e) {
    console.error(`[supersessionDetect] ws=${workspaceId} threw: ${e?.stack || e?.message}`)
    return { checked: 0, judged: 0, candidates: 0, error: e?.message || String(e) }
  }
}
