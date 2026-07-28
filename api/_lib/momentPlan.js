// Moment-bank planning helpers (P3, .claude/moment-bank-sprint.md).
//
// When a workspace has moment_bank_planning_enabled, the weekly Strategist no
// longer composes from this week's interview summaries + a pile of pre-generated
// backlog atoms — it composes atoms ON DEMAND from banked EXEMPLAR moments
// (migration 191). This module owns everything bank-side of that plan:
//
//   • selectExemplarMoments — the topic/region/freshness/usage-aware pull of
//     candidate moments the Strategist may draw this week (cooldown-filtered so
//     the same moment isn't drawn twice in a window; interview-capped so one
//     seminar can't monopolize the prompt).
//   • checkCampaignBankCoverage — the demand-pull loop: each active campaign's
//     topic is embedded and matched against the bank. Hits ride the promo lane;
//     a ZERO-coverage campaign writes a topic_backlog row (source 'bank_gap')
//     so the next interview gets primed. This is the knee-seminar fix.
//   • bumpMomentUsage — usage accounting at DRAFT time (when an atom actually
//     becomes a content piece). Deliberately NOT at compose time: replanning is
//     replace-untouched and fires on every interview completion, so a
//     compose-time bump would cooldown-lock moments whose atoms the very next
//     replan deletes and recomposes.
//
// Everything DB-touching takes an injected `sb` and never throws — a bank-side
// failure must degrade the plan, not 500 the completion PATCH or the cron.

import { embedTexts } from './embeddings.js'

// A drafted moment is off the menu for this long. 8 weeks ≈ the bank (208
// moments at cutover) cycling well before any repeat, while still letting a
// strong evergreen moment come back around. Env-overridable for tuning.
export const MOMENT_COOLDOWN_DAYS = Number(process.env.MOMENT_COOLDOWN_DAYS || 56)
// Raw exemplar fetch bound (ranked down in code) and how many the Strategist
// prompt actually lists.
const BANK_FETCH_LIMIT = 200
export const BANK_PROMPT_LIMIT = 40
// No single interview may fill more than this many of the prompt's slots —
// cross-interview variety is an acceptance criterion of the bank design.
export const MAX_PER_INTERVIEW = 6
// Cosine floor for "the bank covers this campaign topic". Topical relatedness,
// not near-duplicate territory (dedup uses 0.85) — tune from real gap reports.
export const BANK_COVERAGE_MIN_SIM = Number(process.env.BANK_COVERAGE_MIN_SIM || 0.30)

/**
 * PURE: rank + diversify candidate moments for the Strategist prompt.
 * rank = extraction score − usage penalty + freshness bonus; then a greedy
 * top-down pick capped at MAX_PER_INTERVIEW per source interview.
 * @param {Array<object>} moments  rows with score, usage_count, created_at, interview_id
 * @param {string|Date} now
 * @param {number} limit
 */
export function rankExemplarMoments(moments, now, limit = BANK_PROMPT_LIMIT) {
  const nowMs = new Date(now).getTime()
  const ranked = (Array.isArray(moments) ? moments : [])
    .map((m) => {
      const ageDays = Math.max(0, (nowMs - new Date(m.created_at || 0).getTime()) / 86_400_000)
      const freshness = ageDays <= 21 ? 12 : 0 // recently banked = recently captured teaching
      const usagePenalty = 8 * (m.usage_count || 0)
      return { ...m, _rank: (m.score || 0) + freshness - usagePenalty }
    })
    .sort((a, b) => b._rank - a._rank)
  const perInterview = {}
  const out = []
  for (const m of ranked) {
    if (out.length >= limit) break
    const n = perInterview[m.interview_id] || 0
    if (n >= MAX_PER_INTERVIEW) continue
    perInterview[m.interview_id] = n + 1
    out.push(m)
  }
  return out
}

/**
 * Fetch the workspace's drawable exemplar moments: banked, exemplar, off
 * cooldown, and not already backing a live drafted piece (belt-and-suspenders
 * for a missed usage bump). Returns ranked, prompt-sized list; [] on any error.
 */
export async function selectExemplarMoments({ workspaceId, sb, now = new Date().toISOString() }) {
  try {
    const cutoff = new Date(new Date(now).getTime() - MOMENT_COOLDOWN_DAYS * 86_400_000).toISOString()
    const res = await sb(
      `moments?workspace_id=eq.${workspaceId}&status=eq.banked&is_exemplar=eq.true` +
        `&or=(last_used_at.is.null,last_used_at.lt.${encodeURIComponent(cutoff)})` +
        `&select=id,interview_id,staff_id,excerpt,hook,moment_type,topic,region,tags,score,usage_count,last_used_at,created_at` +
        `&order=score.desc&limit=${BANK_FETCH_LIMIT}`,
    )
    if (!res.ok) {
      console.error(`[momentPlan] exemplar fetch failed: ${res.status}`)
      return []
    }
    let moments = await res.json()
    // Belt-and-suspenders: exclude moments whose atom already became a live
    // piece (cooldown normally covers this via the draft-time bump, but the
    // bump is best-effort). Current-week PENDING atoms are NOT excluded — the
    // replan replaces those, and the recompose may legitimately re-pick them.
    const liveRes = await sb(
      `content_plan_atoms?workspace_id=eq.${workspaceId}&moment_id=not.is.null` +
        `&content_piece_id=not.is.null&select=moment_id`,
    )
    if (liveRes.ok) {
      const live = new Set((await liveRes.json()).map((a) => a.moment_id))
      if (live.size) moments = moments.filter((m) => !live.has(m.id))
    }
    return rankExemplarMoments(moments, now)
  } catch (e) {
    console.error('[momentPlan] selectExemplarMoments threw:', e?.message)
    return []
  }
}

// Don't queue a duplicate gap for a topic that's already pending capture.
async function hasPendingBacklogTopic(sb, workspaceId, topic) {
  const res = await sb(
    `topic_backlog?workspace_id=eq.${workspaceId}&status=in.(pending,in_progress)` +
      `&topic=eq.${encodeURIComponent(topic)}&select=id&limit=1`,
  )
  if (!res.ok) return true // fail closed: don't spam rows when we can't check
  return (await res.json()).length > 0
}

/**
 * Demand-pull: match each active campaign's topic against the bank.
 * Returns { promoMomentIds: Set<string>, gaps: [{campaignId, topic}] }.
 * A zero-coverage campaign writes a topic_backlog row (source 'bank_gap',
 * priority 80 — an active campaign outranks routine suggestions) so the next
 * interview gets primed. Best-effort throughout; never throws.
 */
export async function checkCampaignBankCoverage({ workspaceId, activeCampaigns, sb }) {
  const out = { promoMomentIds: new Set(), gaps: [] }
  try {
    const campaigns = (activeCampaigns || []).filter((c) => c?.name)
    if (!campaigns.length) return out
    const topics = campaigns.map((c) =>
      [c.name, c.theme_notes].filter(Boolean).join(' — ').slice(0, 500),
    )
    const vectors = await embedTexts(topics)
    for (let i = 0; i < campaigns.length; i++) {
      const vec = vectors[i]
      if (!vec) continue // embed failure — say nothing rather than a false gap
      const rpc = await sb('rpc/match_moments', {
        method: 'POST',
        body: JSON.stringify({
          p_workspace: workspaceId,
          p_query_embedding: `[${vec.join(',')}]`,
          p_match_count: 8,
          p_min_sim: BANK_COVERAGE_MIN_SIM,
        }),
      })
      if (!rpc.ok) {
        console.error(`[momentPlan] coverage RPC failed for campaign=${campaigns[i].id}: ${rpc.status}`)
        continue
      }
      const rows = await rpc.json().catch(() => [])
      const exemplarHits = rows.filter((r) => r.is_exemplar)
      if (exemplarHits.length) {
        for (const r of exemplarHits) out.promoMomentIds.add(r.id)
      } else {
        const topic = campaigns[i].name.slice(0, 200)
        out.gaps.push({ campaignId: campaigns[i].id, topic })
        if (!(await hasPendingBacklogTopic(sb, workspaceId, topic))) {
          const ins = await sb('topic_backlog', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              workspace_id: workspaceId,
              topic,
              rationale:
                `Active campaign "${campaigns[i].name}" has no coverage in the moment bank — ` +
                `record an interview on this so the planner can compose campaign pieces.`,
              source: 'bank_gap',
              priority: 80,
            }),
          })
          if (!ins.ok) console.error(`[momentPlan] bank_gap insert failed: ${ins.status}`)
        }
      }
    }
    return out
  } catch (e) {
    console.error('[momentPlan] checkCampaignBankCoverage threw:', e?.message)
    return out
  }
}

// Total character budget for the verbatim window a moment-anchored draft is
// generated from and judged against. Tight by design: the one-source-anchor
// decision means the piece may only draw from the moment's surrounding
// conversation, and the fidelity judge's reference must match what the
// generator saw — a judge scoring against a NARROWER reference than the
// generation source is a false-positive machine, and vice versa a leak.
export const MOMENT_WINDOW_MAX_CHARS = 6000

/**
 * PURE: the tight verbatim window around a moment's anchor inside
 * interviews.messages. Returns { messages, clinicianText } — a contiguous
 * conversation slice centered on the anchored turn (the interviewer's question
 * before it included for meaning), budgeted to maxChars — or null when the
 * anchor can't be resolved (time-coded {t_start,t_end} anchors, out-of-range
 * msg_idx, non-string content), in which case callers fall back to the legacy
 * full-transcript path.
 *
 * If the anchored turn ALONE exceeds the budget (seminar-length turns), it is
 * center-sliced around the excerpt's char range so the excerpt always survives.
 *
 * @param {Array<{role?:string, content?:unknown}>} messages
 * @param {{msg_idx?:number, char_start?:number, char_end?:number}} anchor
 */
export function momentWindow(messages, anchor, { maxChars = MOMENT_WINDOW_MAX_CHARS } = {}) {
  if (!Array.isArray(messages) || !anchor || !Number.isInteger(anchor.msg_idx)) return null
  const idx = anchor.msg_idx
  if (idx < 0 || idx >= messages.length) return null
  const anchored = messages[idx]
  if (typeof anchored?.content !== 'string' || !anchored.content.trim()) return null

  let anchoredContent = anchored.content
  if (anchoredContent.length > maxChars) {
    const s = Number.isInteger(anchor.char_start) ? Math.max(0, anchor.char_start) : 0
    const e = Number.isInteger(anchor.char_end) ? Math.min(anchoredContent.length, anchor.char_end) : Math.min(anchoredContent.length, s + 200)
    const pad = Math.max(0, Math.floor((maxChars - (e - s)) / 2))
    anchoredContent = anchoredContent.slice(Math.max(0, s - pad), Math.min(anchoredContent.length, e + pad))
  }

  // Expand a CONTIGUOUS range outward from the anchor while under budget —
  // earlier context first (the question that prompted the moment), alternating
  // sides. Stop at the first turn that would blow the budget (rather than
  // skipping it) so the slice never has holes.
  const parts = [{ i: idx, role: anchored.role === 'assistant' ? 'assistant' : 'user', content: anchoredContent }]
  let used = anchoredContent.length
  let lo = idx - 1
  let hi = idx + 1
  let side = 'lo'
  while (lo >= 0 || hi < messages.length) {
    const useLo = (side === 'lo' && lo >= 0) || hi >= messages.length
    const i = useLo ? lo : hi
    const m = messages[i]
    const content = typeof m?.content === 'string' ? m.content.trim() : ''
    side = side === 'lo' ? 'hi' : 'lo'
    if (!content) {
      if (useLo) lo--; else hi++
      continue
    }
    if (used + content.length > maxChars) break
    parts.push({ i, role: m.role === 'assistant' ? 'assistant' : 'user', content })
    used += content.length
    if (useLo) lo--; else hi++
  }

  parts.sort((a, b) => a.i - b.i)
  return {
    messages: parts.map(({ role, content }) => ({ role, content })),
    clinicianText: parts.filter((p) => p.role === 'user').map((p) => p.content).join('\n\n'),
  }
}

/**
 * Usage accounting at draft time: the atom became a real content piece, so the
 * moment goes on cooldown. Read-modify-write (usage is advisory; a lost race
 * costs a count of one, not correctness). Best-effort; never throws.
 */
export async function bumpMomentUsage({ workspaceId, momentId, sb }) {
  try {
    if (!workspaceId || !momentId) return
    const res = await sb(`moments?id=eq.${momentId}&workspace_id=eq.${workspaceId}&select=usage_count`)
    if (!res.ok) return
    const rows = await res.json()
    if (!rows.length) return
    const now = new Date().toISOString()
    await sb(`moments?id=eq.${momentId}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        usage_count: (rows[0].usage_count || 0) + 1,
        last_used_at: now,
        updated_at: now,
      }),
    })
  } catch (e) {
    console.error('[momentPlan] bumpMomentUsage threw:', e?.message)
  }
}
