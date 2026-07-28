// GET /api/cron/sweep-past-weeks  (Vercel cron, weekly — before weekly-plan)
//
// Moment-bank sprint P1 (.claude/moment-bank-sprint.md). Nothing cleans up a
// closed week today: plan-week.js makes past weeks read-only and no cron ever
// touches content_plan_atoms, so a slot that was planned but never drafted —
// or drafted but never published — just strands there forever. 90 days on
// movebetter: 45 drafts open past 14 days, most of them anchored to weeks
// that already ended. This sweep is the janitor.
//
// For every active workspace, for every content_plan_atom whose plan_week is
// BEFORE the workspace's current week:
//   (a) undrafted (no content_piece_id, status pending/drafting) → return the
//       slot to backlog (held_at set, plan_week/scheduled_at cleared).
//   (b) drafted but never published (content_piece_id set, linked item's
//       status isn't 'published') → archive the draft (status='archived',
//       archived_at set — the existing content_items convention, see
//       content-items/split-into-series.js) and return the atom to backlog
//       too, detached (content_piece_id cleared) so it drafts fresh next
//       time. Locked decision (.claude/decisions.md 2026-07-27): return-to-
//       bank + archive, never roll-forward — a draft composed for a dead
//       week's context is stale by construction and regeneration is cheap.
//
// Published rows, and anything scheduled in the future, are never touched —
// both the atom-side query (plan_week < this week) and a belt-and-suspenders
// scheduled_at check on the item PATCH guard against a stale plan_week ever
// reaching a row that's still live. Every write is a conditional PATCH keyed
// on the state we just verified (held_at is.null / status != published), so
// a concurrent publish or an already-processed row can never be clobbered —
// same cooperative-cancel pattern as sweep-stuck-transcodes.js.
//
// Idempotent: re-running finds nothing left to do. Safe as a one-off manual
// backfill (same handler, no separate script) and as the steady-state cron.
//
// Auth: Bearer CRON_SECRET (same pattern as the other cron handlers).

export const config = { runtime: 'nodejs' }

import { withSentry } from '../../_lib/sentry.js'
import { verifyCronSecret } from '../../_lib/auth.js'
import { mondayOf } from '../../_lib/strategist.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Per-workspace cap on how many stale drafted-items get archived in one run.
// Sized well above the current one-time backlog (45 stale on movebetter) so
// the manual backfill clears in a single pass; steady-state weekly volume is
// far smaller. If a workspace ever hits the cap, the run logs it and the
// remainder clears on the next weekly invocation — no silent truncation.
const MAX_DRAFTED_PER_WORKSPACE = 500

// eslint-disable-next-line bernard/require-workspace-scope -- Cron — iterates all workspaces; every query below is scoped by workspace_id from the loop.
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(20_000),
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

// Case (a): undrafted planned atoms in a closed week → straight back to
// backlog. A single filtered PATCH — no id enumeration needed, so there's no
// URL-length concern no matter how large the backlog is.
async function returnUndraftedToBacklog(wsId, currentMonday, now) {
  const filter =
    `content_plan_atoms?workspace_id=eq.${wsId}` +
    `&plan_week=lt.${currentMonday}` +
    `&held_at=is.null` +
    `&content_piece_id=is.null` +
    `&status=in.(pending,drafting)`
  const r = await sb(filter, {
    method: 'PATCH',
    body: JSON.stringify({ held_at: now, plan_week: null, scheduled_at: null, status: 'pending', updated_at: now }),
  })
  if (!r.ok) {
    console.error(`[sweep-past-weeks] ${wsId} undrafted-backlog PATCH failed:`, r.status, await r.text().catch(() => ''))
    return { patched: 0, error: true }
  }
  const rows = await r.json().catch(() => [])
  return { patched: rows.length, error: false }
}

// Case (b): drafted-but-unpublished pieces in a closed week → archive the
// draft, detach + re-bank the atom.
async function archiveStaleDrafts(wsId, currentMonday, now) {
  // Candidates: atoms in a closed week that still point at a drafted piece
  // and haven't already been swept (held_at is.null).
  const candRes = await sb(
    `content_plan_atoms?workspace_id=eq.${wsId}` +
      `&plan_week=lt.${currentMonday}` +
      `&held_at=is.null` +
      `&content_piece_id=not.is.null` +
      `&select=id,content_piece_id` +
      `&limit=${MAX_DRAFTED_PER_WORKSPACE}`,
  )
  if (!candRes.ok) {
    console.error(`[sweep-past-weeks] ${wsId} stale-draft candidate fetch failed:`, candRes.status)
    return { archived: 0, rebanked: 0, capped: false, error: true }
  }
  const candidates = await candRes.json().catch(() => [])
  if (!candidates.length) return { archived: 0, rebanked: 0, capped: false, error: false }

  const capped = candidates.length >= MAX_DRAFTED_PER_WORKSPACE
  const itemIds = [...new Set(candidates.map((a) => a.content_piece_id))]
  const quotedItemIds = itemIds.map((id) => `"${id}"`).join(',')

  // Archive every linked item that ISN'T published — guarded on status!=
  // published (so a piece published in the gap between the plan and this
  // write is never touched) and a belt-and-suspenders scheduled_at check
  // (never archive something scheduled in the future, even off a stale
  // plan_week). Prefer: return=representation tells us exactly which ids
  // actually matched, so we only detach atoms whose item really got archived.
  const archiveRes = await sb(
    `content_items?workspace_id=eq.${wsId}&id=in.(${quotedItemIds})&status=neq.published` +
      `&or=(scheduled_at.is.null,scheduled_at.lt.${now})`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived', archived_at: now, updated_at: now }),
    },
  )
  if (!archiveRes.ok) {
    console.error(`[sweep-past-weeks] ${wsId} archive PATCH failed:`, archiveRes.status, await archiveRes.text().catch(() => ''))
    return { archived: 0, rebanked: 0, capped, error: true }
  }
  const archivedItems = await archiveRes.json().catch(() => [])
  if (!archivedItems.length) return { archived: 0, rebanked: 0, capped, error: false }

  const archivedIds = archivedItems.map((it) => it.id)
  const quotedArchivedIds = archivedIds.map((id) => `"${id}"`).join(',')

  // Detach + re-bank only the atoms whose item we just confirmed archived.
  const rebankRes = await sb(
    `content_plan_atoms?workspace_id=eq.${wsId}&content_piece_id=in.(${quotedArchivedIds})&held_at=is.null`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        held_at: now, plan_week: null, scheduled_at: null, status: 'pending', content_piece_id: null, updated_at: now,
      }),
    },
  )
  if (!rebankRes.ok) {
    console.error(`[sweep-past-weeks] ${wsId} rebank PATCH failed:`, rebankRes.status, await rebankRes.text().catch(() => ''))
    return { archived: archivedItems.length, rebanked: 0, capped, error: true }
  }
  const rebanked = await rebankRes.json().catch(() => [])
  return { archived: archivedItems.length, rebanked: rebanked.length, capped, error: false }
}

async function sweepWorkspace(ws, now) {
  const currentMonday = mondayOf(now, ws.cadence_policy?.timezone)
  const [undrafted, stale] = await Promise.all([
    returnUndraftedToBacklog(ws.id, currentMonday, now),
    archiveStaleDrafts(ws.id, currentMonday, now),
  ])
  return {
    slug: ws.slug,
    currentMonday,
    returnedToBacklog: undrafted.patched,
    archivedDrafts: stale.archived,
    rebanked: stale.rebanked,
    cappedThisRun: stale.capped || undefined,
    error: undrafted.error || stale.error || undefined,
  }
}

async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase env not configured' })

  const wsRes = await sb('workspaces?status=eq.active&select=id,slug,cadence_policy')
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = await wsRes.json().catch(() => [])

  const now = new Date().toISOString()
  const summary = []
  for (const ws of workspaces) {
    try {
      summary.push(await sweepWorkspace(ws, now))
    } catch (e) {
      console.error(`[sweep-past-weeks] ${ws.slug} threw: ${e?.message}\n${e?.stack || ''}`)
      summary.push({ slug: ws.slug, error: 'failed' })
    }
  }

  const totals = summary.reduce(
    (acc, s) => ({
      returnedToBacklog: acc.returnedToBacklog + (s.returnedToBacklog || 0),
      archivedDrafts: acc.archivedDrafts + (s.archivedDrafts || 0),
      rebanked: acc.rebanked + (s.rebanked || 0),
    }),
    { returnedToBacklog: 0, archivedDrafts: 0, rebanked: 0 },
  )
  console.info(`[sweep-past-weeks] ${workspaces.length} workspaces — returned ${totals.returnedToBacklog} undrafted, archived ${totals.archivedDrafts} stale drafts`)

  return res.status(200).json({ workspaces: workspaces.length, totals, summary })
}

export default withSentry(handler)
