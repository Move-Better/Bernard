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

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const DEFAULT_MAX_ITEMS   = 3
const DEFAULT_DAILY_CAP   = 40
const MAX_ATTEMPTS        = 3
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
  if (item.kind === 'revise_content_item') {
    const p = item.payload || {}
    return reviseContentItem({
      ws,
      contentItemId: p.content_item_id || item.content_item_id,
      changeRequest: p.body || '',
      commentId:     p.comment_id || null,
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

  await backfillChangeRequests(wsId)
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

  const wsResult = { slug: ws.slug, claimed: 0, revised: 0, skipped: 0, failed: 0 }
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
      if (res?.status === 'revised') { wsResult.revised++; await finishItem(claimed.id, 'done', res) }
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
  summary.push(wsResult)
}

async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase env not configured' })
  if (process.env.PRODUCER_GLOBAL_DISABLED === '1') return res.status(200).json({ skipped: 'globally_disabled' })

  const wsRes = await sb('workspaces?status=eq.active&select=id,slug,display_name,brand_guidelines,producer_config')
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = await wsRes.json().catch(() => [])
  // Fetch-all + filter in JS (robust for a JSONB boolean; the enabled set is tiny).
  const enabled = workspaces.filter((w) => w.producer_config?.enabled && !w.producer_config?.paused_at)

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
