import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs', maxDuration: 300 }
// GET /api/cron/agent-tick  (every 5 min)
//
// The Standing Producer's heartbeat (Phase 1). For each workspace that has
// hired Bernard (producer_config.enabled && !paused):
//   1. Backfill-scan recent change-request comments into agent_inbox
//      (idempotent via UNIQUE dedupe_key — safe to re-scan every tick, and
//      the resilient path if a real-time enqueue were ever dropped).
//   2. Sweep stranded 'claimed' items (a tick that died mid-work) back to
//      pending, or to failed once attempts are exhausted.
//   3. Claim up to max_items_per_tick pending items with optimistic
//      concurrency and dispatch by kind. Phase 1 kind: revise_content_item.
//
// Continuity is DB state, not a live process. The human approval gate is
// untouched — the revision agent only moves a piece draft→in_review.
//
// Auth: Bearer CRON_SECRET. Global kill: env PRODUCER_GLOBAL_DISABLED=1.

import { verifyCronSecret } from '../../_lib/auth.js'
import { reviseContentItem } from '../../_lib/producer/reviseContentItem.js'
import { regradeContentItem } from '../../_lib/producer/regradeContentItem.js'
import { predraftWeek } from '../../_lib/producer/predraftWeek.js'
import { producerActive, laneEnabled } from '../../_lib/producer/config.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const DEFAULT_MAX_ITEMS   = 3
const DEFAULT_DAILY_CAP   = 40
const MAX_ATTEMPTS        = 3
// P3 — how many upcoming-week slots to pre-draft per workspace per tick (default;
// overridable via producer_config.predraft_per_tick). A 6-slot week drains over
// ~3 ticks, smoothing spend and staying well inside the 300s / deadline budget.
const DEFAULT_PREDRAFT_PER_TICK = 2
const STRANDED_MS         = 15 * 60 * 1000
const BACKFILL_WINDOW_MS  = 24 * 60 * 60 * 1000
// Stop STARTING new items here. A single revision can run ~150s worst case
// (90s revise + 60s judge timeouts) plus Supabase round-trips, so we leave
// ~180s of headroom under maxDuration:300 — an item begun at the deadline still
// finishes before Vercel's hard kill. (max_items_per_tick is the primary bound;
// this is the slow-item backstop. A killed item is reclaimed by sweepStranded.)
const DEADLINE_MS         = 120_000

// eslint-disable-next-line bernard/require-workspace-scope -- Cron — iterates enabled workspaces; every query below is scoped by workspace_id from the workspace list
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(12_000),
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

// Ensure every recent change-request comment has an inbox row. Idempotent:
// the UNIQUE(workspace_id, dedupe_key) makes re-inserts no-ops, so an already
// processed (done/failed) item is never resurrected.
async function backfillChangeRequests(wsId) {
  const since = new Date(Date.now() - BACKFILL_WINDOW_MS).toISOString()
  const r = await sb(
    `content_item_comments?workspace_id=eq.${wsId}&kind=eq.change_request&created_at=gte.${since}` +
    `&select=id,body,content_item_id&order=created_at.desc&limit=100`
  )
  if (!r.ok) return 0
  const comments = await r.json().catch(() => [])
  if (!comments.length) return 0
  const rows = comments
    .filter((c) => c.content_item_id)
    .map((c) => ({
      workspace_id:    wsId,
      kind:            'revise_content_item',
      dedupe_key:      `change_request:${c.id}`,
      content_item_id: c.content_item_id,
      payload:         { comment_id: c.id, body: c.body || '', content_item_id: c.content_item_id },
    }))
  if (!rows.length) return 0
  await sb('agent_inbox?on_conflict=workspace_id,dedupe_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  }).catch((e) => console.warn('[agent-tick] backfill upsert failed:', e?.message))
  return rows.length
}

// Ensure every held short-caption draft has a judge_low_score inbox row so the
// producer takes one voice-repair pass. Idempotent via the dedupe key; skips
// pieces already producer-attempted (voice_audit.producer_attempts set) so an
// escalated piece — which stays gate='held' so /week keeps flagging it — isn't
// re-enqueued.
async function backfillHeldCaptions(wsId) {
  const r = await sb(
    // Oldest-held first so a large backlog can't starve the earliest-flagged
    // drafts (the newest-50 would otherwise always be re-scanned under load).
    `content_items?workspace_id=eq.${wsId}&status=eq.draft&voice_audit->>gate=eq.held` +
    `&select=id,voice_audit&order=updated_at.asc&limit=50`
  )
  if (!r.ok) return 0
  const held = (await r.json().catch(() => []))
    .filter((p) => p.id && !p.voice_audit?.producer_attempts)
  if (!held.length) return 0
  const rows = held.map((p) => ({
    workspace_id:    wsId,
    kind:            'regrade_content_item',
    dedupe_key:      `judge_low_score:${p.id}`,
    content_item_id: p.id,
    payload:         { content_item_id: p.id, red_flag: p.voice_audit?.red_flag || 'voice drift' },
  }))
  await sb('agent_inbox?on_conflict=workspace_id,dedupe_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  }).catch((e) => console.warn('[agent-tick] held-caption backfill failed:', e?.message))
  return rows.length
}

// Reset items stuck in 'claimed' past the deadline (a prior tick died). Under
// the attempt cap → back to pending for retry; at the cap → failed.
async function sweepStranded(wsId) {
  const cutoff = new Date(Date.now() - STRANDED_MS).toISOString()
  await sb(
    `agent_inbox?workspace_id=eq.${wsId}&status=eq.claimed&claimed_at=lt.${cutoff}&attempts=lt.${MAX_ATTEMPTS}`,
    { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'pending' }) }
  ).catch(() => {})
  await sb(
    `agent_inbox?workspace_id=eq.${wsId}&status=eq.claimed&claimed_at=lt.${cutoff}&attempts=gte.${MAX_ATTEMPTS}`,
    { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', result: { error: 'stranded_exhausted' }, processed_at: new Date().toISOString() }) }
  ).catch(() => {})
}

// Today's LLM-backed actions for this workspace (the daily spend guardrail).
// Approximate by design: counts recorded actions (model IS NOT NULL). A
// revision that spent a Sonnet call but then skipped (model omitted the
// delimiter, or the piece was re-approved mid-revision) records no action, so
// the cross-tick baseline can undercount by the number of such rare races. Each
// is bounded to one call (the inbox item finalizes as 'skipped', never re-runs),
// and the early status guard in reviseContentItem prevents the common no-op
// spend — so this is a guardrail, not billing, and the small undercount is fine.
async function todaysAiCalls(wsId) {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0)
  const r = await sb(
    `agent_actions?workspace_id=eq.${wsId}&model=not.is.null&created_at=gte.${start.toISOString()}&select=id&limit=200`
  )
  if (!r.ok) return 0
  return (await r.json().catch(() => [])).length
}

// Optimistically claim one pending item (status=eq.pending guard → the loser of
// a race matches 0 rows). Returns the claimed row or null.
async function claimItem(item) {
  const r = await sb(
    `agent_inbox?id=eq.${item.id}&status=eq.pending`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'claimed', claimed_at: new Date().toISOString(), attempts: (item.attempts || 0) + 1 }),
    }
  )
  if (!r.ok) return null
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

async function finishItem(id, status, result) {
  await sb(`agent_inbox?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status, result: result ?? null, processed_at: new Date().toISOString() }),
  }).catch(() => {})
}

async function dispatch(ws, item) {
  const p = item.payload || {}
  const cfg = ws.producer_config || {}
  if (item.kind === 'revise_content_item') {
    if (!laneEnabled(cfg, 'answer_change_requests')) return { status: 'skipped', reason: 'lane_disabled' }
    return reviseContentItem({
      ws,
      contentItemId: p.content_item_id || item.content_item_id,
      changeRequest: p.body || '',
      commentId:     p.comment_id || null,
      inboxItemId:   item.id,
    })
  }
  if (item.kind === 'regrade_content_item') {
    if (!laneEnabled(cfg, 'auto_repair_captions')) return { status: 'skipped', reason: 'lane_disabled' }
    return regradeContentItem({
      ws,
      contentItemId: p.content_item_id || item.content_item_id,
      redFlag:       p.red_flag || null,
      inboxItemId:   item.id,
    })
  }
  return { status: 'skipped', reason: `unknown_kind:${item.kind}` }
}

async function processWorkspace(ws, deadline, summary) {
  const wsId = ws.id
  const cfg = ws.producer_config || {}
  const maxItems = Number.isFinite(cfg.max_items_per_tick) ? cfg.max_items_per_tick : DEFAULT_MAX_ITEMS
  const dailyCap = Number.isFinite(cfg.daily_ai_call_cap) ? cfg.daily_ai_call_cap : DEFAULT_DAILY_CAP

  // Lane-gated: only scan for new work in the lanes the owner has left on. The
  // dispatch loop below also re-checks per item (belt-and-suspenders for anything
  // already queued). Defaults are ON, so an existing {enabled:true} workspace is
  // unchanged; turning a lane off stops Bernard taking on that work.
  if (laneEnabled(cfg, 'answer_change_requests')) await backfillChangeRequests(wsId)
  if (laneEnabled(cfg, 'auto_repair_captions')) await backfillHeldCaptions(wsId)
  await sweepStranded(wsId)

  const spent = await todaysAiCalls(wsId)
  if (spent >= dailyCap) {
    summary.push({ slug: ws.slug, skipped: 'daily_cap', spent })
    return
  }

  const pendRes = await sb(
    `agent_inbox?workspace_id=eq.${wsId}&status=eq.pending&select=id,kind,payload,content_item_id,attempts&order=created_at.asc&limit=${maxItems}`
  )
  if (!pendRes.ok) { summary.push({ slug: ws.slug, error: 'pending_fetch_failed' }); return }
  const pending = await pendRes.json().catch(() => [])

  const wsResult = { slug: ws.slug, claimed: 0, revised: 0, passed: 0, escalated: 0, skipped: 0, failed: 0 }
  let remaining = dailyCap - spent
  for (const item of pending) {
    if (Date.now() > deadline) { wsResult.partial = true; break }
    if (remaining <= 0) { wsResult.budget_stop = true; break }
    const claimed = await claimItem(item)
    if (!claimed) continue // lost the race to another tick
    wsResult.claimed++
    remaining--
    try {
      const res = await dispatch(ws, claimed)
      const st = res?.status
      // All terminal outcomes finalize the inbox item as 'done' (only a thrown
      // transient error retries). revised/passed = success; escalated = we tried
      // and handed to the human; skipped = cooperative-cancel / not applicable.
      if (st === 'revised') { wsResult.revised++; await finishItem(claimed.id, 'done', res) }
      else if (st === 'passed') { wsResult.passed++; await finishItem(claimed.id, 'done', res) }
      else if (st === 'escalated') { wsResult.escalated++; await finishItem(claimed.id, 'done', res) }
      else { wsResult.skipped++; await finishItem(claimed.id, 'skipped', res) }
    } catch (e) {
      console.error('[agent-tick]', ws.slug, claimed.id, e?.message)
      const attempts = claimed.attempts || 0
      if (attempts >= MAX_ATTEMPTS) { wsResult.failed++; await finishItem(claimed.id, 'failed', { error: (e?.message || 'error').slice(0, 300) }) }
      else {
        // Back to pending for the next tick.
        await sb(`agent_inbox?id=eq.${claimed.id}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'pending', result: { error: (e?.message || 'error').slice(0, 300) } }),
        }).catch(() => {})
      }
    }
  }

  // P3 — pre-draft the upcoming week. OPT-IN per workspace (lane 'pre_draft_week'
  // defaults OFF), so no existing workspace pre-drafts until a human enables it.
  // Runs AFTER the inbox loop on whatever budget/time remains: bounded by the
  // per-tick pre-draft cap AND the leftover daily budget, and skipped once past the
  // deadline. Pre-drafts NEVER auto-approve/schedule — they land as status='draft'
  // for the human on /week. predraftWeek discovers the slots + drips them out.
  if (laneEnabled(cfg, 'pre_draft_week') && remaining > 0 && Date.now() <= deadline) {
    const perTick = Number.isFinite(cfg.predraft_per_tick) ? cfg.predraft_per_tick : DEFAULT_PREDRAFT_PER_TICK
    const predraftCap = Math.max(0, Math.min(perTick, remaining))
    if (predraftCap > 0) {
      try {
        const pre = await predraftWeek({ ws, cap: predraftCap })
        wsResult.predrafted = pre.drafted
        wsResult.predraftCandidates = pre.candidates
        if (pre.failed) wsResult.predraftFailed = pre.failed
        // Decrement budget by ATTEMPTS (drafts + failures) — a failed attempt
        // still spent model calls, so it must count against the daily cap.
        remaining -= (pre.drafted + (pre.failed || 0))
      } catch (e) {
        console.error('[agent-tick] predraft threw:', ws.slug, e?.message)
        wsResult.predraftError = true
      }
    }
  }

  summary.push(wsResult)
}

async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase env not configured' })
  if (process.env.PRODUCER_GLOBAL_DISABLED === '1') return res.status(200).json({ skipped: 'globally_disabled' })

  // audience_options + story_type_options are read by draftAtom's label resolution
  // — the interactive route gets them via workspaceContext's select=*, so the
  // pre-draft path must select them too or the two callers diverge.
  const wsRes = await sb('workspaces?status=eq.active&select=id,slug,display_name,brand_guidelines,audience_options,story_type_options,producer_config')
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = await wsRes.json().catch(() => [])
  // Fetch-all + filter in JS (robust for a JSONB boolean; the enabled set is tiny).
  // producerActive = enabled AND not paused — pause stops all processing while
  // sensors keep queueing, so resume drains the backlog with nothing lost.
  const enabled = workspaces.filter((w) => producerActive(w.producer_config))

  const deadline = Date.now() + DEADLINE_MS
  const summary = []
  for (const ws of enabled) {
    if (Date.now() > deadline) { summary.push({ slug: ws.slug, skipped: 'deadline' }); continue }
    try {
      await processWorkspace(ws, deadline, summary)
    } catch (e) {
      console.error('[agent-tick] workspace threw:', ws.slug, e?.message)
      summary.push({ slug: ws.slug, error: 'workspace_error' })
    }
  }
  return res.status(200).json({ enabledWorkspaces: enabled.length, summary })
}

export default withSentry(handler)
