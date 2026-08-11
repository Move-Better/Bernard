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
//   (c) never-week-planned posts (no atom, or atom with plan_week null) that
//       have sat untouched in draft/in_review/approved for STALE_DRAFT_DAYS →
//       archive, re-bank/delete any week-less atom. Blog excluded, and see
//       SWEEPABLE_STALE_STATUSES for why `approved` belongs in that list.
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

// Case (c): how long a draft that was NEVER planned into a week (no atom, or
// atom with plan_week null — the pre-moment-bank pile, one-off drafts, orphan
// stories) may sit in draft/in_review before the sweep archives it. Cases (a)
// and (b) key on plan_week < current Monday, and PostgREST's lt never matches
// a null — so without this case those rows are permanently invisible to the
// janitor (2026-08-10: 9 such posts, oldest from May, nagging every weekly
// digest). 7d matches the weekly cadence — one full week untouched and the
// draft is stale (Q, 2026-08-11; was 14d at first ship). Blog is excluded:
// stale in_review blog drafts are finished pieces awaiting publish, and
// archiving them would destroy the thing the digest wants shipped (Q,
// 2026-08-10).
const STALE_DRAFT_DAYS = 7

// Statuses case (c) will archive. `approved` is here deliberately, added
// 2026-08-11 after Q found an Instagram post approved 2026-06-01 still sitting
// in the queue 72 days later — it survived every earlier sweep because
// `approved` was simply never in this list, and it carries no atom, so cases
// (a) and (b) could not see it either.
//
// Why archiving an approved post is safe rather than destroying a human's
// yes: the same locked decision that governs the rest of this sweep
// (.claude/decisions.md 2026-07-27) — "a draft composed for a dead week's
// context is stale by construction and regeneration is cheap." An approval
// from ten weeks ago is stale by exactly that argument, and the atom returns
// to the bank so the slot re-drafts fresh rather than being lost.
//
// The existing scheduled_at guard already reads correctly for this status
// with no special case: approved + no schedule is the stalled state (all 8
// such rows on movebetter had scheduled_at null), approved + a FUTURE
// schedule is live and excluded, and approved + a past schedule that never
// published is stuck and should be swept like any other.
const SWEEPABLE_STALE_STATUSES = 'draft,in_review,approved'

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
//
// Moment-composed atoms (moment_id set, moment-bank P3) are DELETED instead of
// re-banked: the moments table IS the bank — the moment stays drawable (its
// draft-time cooldown never started, since no piece was made), and re-banking
// the atom would double the inventory with a brief frozen in a dead week's
// context. Legacy atoms (moment_id null) keep the P1 return-to-backlog
// semantics so the pre-cutover pile drains via promotion.
async function returnUndraftedToBacklog(wsId, currentMonday, now) {
  const base =
    `content_plan_atoms?workspace_id=eq.${wsId}` +
    `&plan_week=lt.${currentMonday}` +
    `&held_at=is.null` +
    `&content_piece_id=is.null` +
    `&status=in.(pending,drafting)`
  const r = await sb(`${base}&moment_id=is.null`, {
    method: 'PATCH',
    body: JSON.stringify({ held_at: now, plan_week: null, scheduled_at: null, status: 'pending', updated_at: now }),
  })
  if (!r.ok) {
    console.error(`[sweep-past-weeks] ${wsId} undrafted-backlog PATCH failed:`, r.status, await r.text().catch(() => ''))
    return { patched: 0, deletedMomentAtoms: 0, error: true }
  }
  const rows = await r.json().catch(() => [])
  const del = await sb(`${base}&moment_id=not.is.null`, { method: 'DELETE' })
  if (!del.ok) {
    console.error(`[sweep-past-weeks] ${wsId} undrafted moment-atom DELETE failed:`, del.status, await del.text().catch(() => ''))
    return { patched: rows.length, deletedMomentAtoms: 0, error: true }
  }
  const deleted = await del.json().catch(() => [])
  return { patched: rows.length, deletedMomentAtoms: deleted.length, error: false }
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
      `&select=id,content_piece_id,moment_id` +
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

  // Detach + re-bank only the LEGACY atoms (moment_id null) whose item we just
  // confirmed archived. Moment-composed atoms are DELETED instead (see
  // returnUndraftedToBacklog's rationale): the moment itself stays in the bank
  // and comes off cooldown naturally, so the slot's inventory is never lost —
  // only the stale week-frozen brief is.
  const rebankRes = await sb(
    `content_plan_atoms?workspace_id=eq.${wsId}&content_piece_id=in.(${quotedArchivedIds})&held_at=is.null&moment_id=is.null`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        held_at: now, plan_week: null, scheduled_at: null, status: 'pending', content_piece_id: null, updated_at: now,
      }),
    },
  )
  if (!rebankRes.ok) {
    console.error(`[sweep-past-weeks] ${wsId} rebank PATCH failed:`, rebankRes.status, await rebankRes.text().catch(() => ''))
    return { archived: archivedItems.length, rebanked: 0, deletedMomentAtoms: 0, capped, error: true }
  }
  const rebanked = await rebankRes.json().catch(() => [])
  const delRes = await sb(
    `content_plan_atoms?workspace_id=eq.${wsId}&content_piece_id=in.(${quotedArchivedIds})&held_at=is.null&moment_id=not.is.null`,
    { method: 'DELETE' },
  )
  if (!delRes.ok) {
    console.error(`[sweep-past-weeks] ${wsId} drafted moment-atom DELETE failed:`, delRes.status, await delRes.text().catch(() => ''))
    return { archived: archivedItems.length, rebanked: rebanked.length, deletedMomentAtoms: 0, capped, error: true }
  }
  const deletedMoment = await delRes.json().catch(() => [])
  return { archived: archivedItems.length, rebanked: rebanked.length, deletedMomentAtoms: deletedMoment.length, capped, error: false }
}

// Case (c): stale drafts that were never planned into a week → archive the
// draft, re-bank (or delete, for moment-composed) any week-less atom pointing
// at it. Only rows untouched for STALE_DRAFT_DAYS qualify — both created_at
// AND updated_at must be past the cutoff, so a post someone edited yesterday
// is never swept out from under them — and anything scheduled in the future
// is left alone. Items whose atom carries a real plan_week are explicitly
// skipped: past weeks are case (b)'s job, current/future weeks are live.
async function archiveWeeklessStale(wsId, now) {
  const cutoff = new Date(Date.now() - STALE_DRAFT_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const candRes = await sb(
    `content_items?workspace_id=eq.${wsId}` +
      `&status=in.(${SWEEPABLE_STALE_STATUSES})` +
      `&platform=neq.blog` +
      `&created_at=lt.${cutoff}` +
      `&updated_at=lt.${cutoff}` +
      `&or=(scheduled_at.is.null,scheduled_at.lt.${now})` +
      `&select=id` +
      `&limit=${MAX_DRAFTED_PER_WORKSPACE}`,
  )
  if (!candRes.ok) {
    console.error(`[sweep-past-weeks] ${wsId} weekless-stale candidate fetch failed:`, candRes.status)
    return { archived: 0, rebanked: 0, deletedMomentAtoms: 0, error: true }
  }
  const candidates = await candRes.json().catch(() => [])
  if (!candidates.length) return { archived: 0, rebanked: 0, deletedMomentAtoms: 0, error: false }

  const candIds = candidates.map((c) => c.id)
  const quotedCandIds = candIds.map((id) => `"${id}"`).join(',')

  // Any atom with a non-null plan_week disqualifies its item from this case.
  const atomRes = await sb(
    `content_plan_atoms?workspace_id=eq.${wsId}&content_piece_id=in.(${quotedCandIds})` +
      `&plan_week=not.is.null&select=content_piece_id`,
  )
  if (!atomRes.ok) {
    console.error(`[sweep-past-weeks] ${wsId} weekless-stale atom fetch failed:`, atomRes.status)
    return { archived: 0, rebanked: 0, deletedMomentAtoms: 0, error: true }
  }
  const planned = new Set((await atomRes.json().catch(() => [])).map((a) => a.content_piece_id))
  const targetIds = candIds.filter((id) => !planned.has(id))
  if (!targetIds.length) return { archived: 0, rebanked: 0, deletedMomentAtoms: 0, error: false }
  const quotedTargetIds = targetIds.map((id) => `"${id}"`).join(',')

  const archiveRes = await sb(
    // Same status list as the candidate fetch above — this is the conditional
    // re-check that makes the PATCH safe against a concurrent approve/publish,
    // so the two MUST stay in step. A test pins both sites for that reason.
    `content_items?workspace_id=eq.${wsId}&id=in.(${quotedTargetIds})&status=in.(${SWEEPABLE_STALE_STATUSES})` +
      `&or=(scheduled_at.is.null,scheduled_at.lt.${now})`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived', archived_at: now, updated_at: now }),
    },
  )
  if (!archiveRes.ok) {
    console.error(`[sweep-past-weeks] ${wsId} weekless-stale archive PATCH failed:`, archiveRes.status, await archiveRes.text().catch(() => ''))
    return { archived: 0, rebanked: 0, deletedMomentAtoms: 0, error: true }
  }
  const archivedItems = await archiveRes.json().catch(() => [])
  if (!archivedItems.length) return { archived: 0, rebanked: 0, deletedMomentAtoms: 0, error: false }
  const quotedArchivedIds = archivedItems.map((it) => `"${it.id}"`).join(',')

  const rebankRes = await sb(
    `content_plan_atoms?workspace_id=eq.${wsId}&content_piece_id=in.(${quotedArchivedIds})&moment_id=is.null`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        held_at: now, plan_week: null, scheduled_at: null, status: 'pending', content_piece_id: null, updated_at: now,
      }),
    },
  )
  if (!rebankRes.ok) {
    console.error(`[sweep-past-weeks] ${wsId} weekless-stale rebank PATCH failed:`, rebankRes.status, await rebankRes.text().catch(() => ''))
    return { archived: archivedItems.length, rebanked: 0, deletedMomentAtoms: 0, error: true }
  }
  const rebanked = await rebankRes.json().catch(() => [])
  const delRes = await sb(
    `content_plan_atoms?workspace_id=eq.${wsId}&content_piece_id=in.(${quotedArchivedIds})&moment_id=not.is.null`,
    { method: 'DELETE' },
  )
  if (!delRes.ok) {
    console.error(`[sweep-past-weeks] ${wsId} weekless-stale moment-atom DELETE failed:`, delRes.status, await delRes.text().catch(() => ''))
    return { archived: archivedItems.length, rebanked: rebanked.length, deletedMomentAtoms: 0, error: true }
  }
  const deletedMoment = await delRes.json().catch(() => [])
  return { archived: archivedItems.length, rebanked: rebanked.length, deletedMomentAtoms: deletedMoment.length, error: false }
}

async function sweepWorkspace(ws, now) {
  const currentMonday = mondayOf(now, ws.cadence_policy?.timezone)
  const [undrafted, stale] = await Promise.all([
    returnUndraftedToBacklog(ws.id, currentMonday, now),
    archiveStaleDrafts(ws.id, currentMonday, now),
  ])
  // Runs AFTER case (b) so a past-week atom's item is archived+detached there
  // first, never double-counted here (case (c) skips any item whose atom still
  // carries a plan_week).
  const weekless = await archiveWeeklessStale(ws.id, now)
  return {
    slug: ws.slug,
    currentMonday,
    returnedToBacklog: undrafted.patched,
    archivedDrafts: stale.archived,
    rebanked: stale.rebanked,
    archivedWeekless: weekless.archived,
    rebankedWeekless: weekless.rebanked,
    deletedMomentAtoms:
      (undrafted.deletedMomentAtoms || 0) + (stale.deletedMomentAtoms || 0) + (weekless.deletedMomentAtoms || 0) || undefined,
    cappedThisRun: stale.capped || undefined,
    error: undrafted.error || stale.error || weekless.error || undefined,
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
      archivedWeekless: acc.archivedWeekless + (s.archivedWeekless || 0),
    }),
    { returnedToBacklog: 0, archivedDrafts: 0, rebanked: 0, archivedWeekless: 0 },
  )
  console.info(`[sweep-past-weeks] ${workspaces.length} workspaces — returned ${totals.returnedToBacklog} undrafted, archived ${totals.archivedDrafts} stale drafts, archived ${totals.archivedWeekless} week-less stale`)

  return res.status(200).json({ workspaces: workspaces.length, totals, summary })
}

export default withSentry(handler)
