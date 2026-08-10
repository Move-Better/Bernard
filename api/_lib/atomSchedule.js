// Mirror a content_items schedule onto its linked content_plan_atoms row.
//
// WHY THIS EXISTS
// /week is driven ENTIRELY by the atom: week-summary.js filters
// content_plan_atoms by plan_week and lays the board out by the ATOM's
// scheduled_at; content_items is joined only for status/thumbnail. So a path
// that commits a schedule to the ITEM and stops there leaves the atom pinned to
// its original slot, and the board renders that post on the wrong day
// indefinitely — no error, nothing to notice, until someone compares the board
// against what actually went out.
//
// This is the one copy of that mirror. It used to live inline in
// api/_routes/db/content.js, which was fine while the client echoed the schedule
// back through /api/db/content after a dispatch. #2553 removed that echo (it
// 409'd against the publish lock) and moved the commit server-side into
// dispatchCommitFields — but the atom sync rode on the echo and was not carried
// across, so every dispatch that commits a schedule has silently skipped it
// since 2026-08-04. Confirmed live on movebetter 2026-08-10: an atom read Wed
// 08:00 PT while its item was queued at bundle.social for Tue 09:00 PT.
//
// Keeping it in one module (rather than re-implementing per path) is the point:
// this is the client/server mirror-pair class from CLAUDE.md, and the whole bug
// was a second copy that never got written.
//
// SCOPE — the SCHEDULE, never the publish instant.
// Only call this where a real scheduled_at is committed. A published row's
// scheduled_at is deliberately overwritten with the actual post time by the
// post.published webhook (verified in prod: all 7 published rows carry
// scheduled_at within seconds of published_at, drifting 47–473 min from the
// planned slot). That is history, not a schedule — mirroring it onto the atom
// would overwrite the record of what was PLANNED and move nothing on the board,
// since none of that drift crosses a day boundary.

import { mondayOf } from './strategist.js'
import { supabaseRest } from './supabaseRest.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const sb = (path, init = {}) => supabaseRest(path, init, { timeoutMs: 15_000, contentType: 'application/json' })

/**
 * The columns to write on the atom for a given committed schedule. Pure, so the
 * plan_week recompute and the held_at rule are unit-testable without a DB.
 *
 * @param {string|null} scheduledAt  ISO timestamp, or null to UNSCHEDULE
 * @param {string|undefined} timezone  workspace cadence timezone (undefined = UTC, matching mondayOf)
 * @param {string} [nowIso]
 */
export function atomSchedulePatch(scheduledAt, timezone, nowIso = new Date().toISOString()) {
  return {
    scheduled_at: scheduledAt ?? null,
    // Recompute the week bucket with the SAME tz-aware mondayOf the board uses,
    // or a schedule moved across a week boundary lands in the wrong bucket. On
    // UNSCHEDULE, return the atom to the CURRENT week so the freed draft
    // reappears on this week's board instead of staying pinned to the week it
    // was last scheduled to.
    plan_week: mondayOf(scheduledAt || nowIso, timezone),
    // A piece actively being scheduled can no longer be "held" backlog. Only on
    // an actual (non-null) schedule — unscheduling isn't a hold action, so it
    // leaves held_at untouched.
    ...(scheduledAt ? { held_at: null } : {}),
    updated_at: nowIso,
  }
}

/**
 * Mirror a committed schedule onto the atom linked to this content item.
 *
 * Best-effort by design: the item is already committed by the time this runs
 * (and on the dispatch paths the post has already left for bundle.social), so a
 * failure here must never fail the caller. It is logged, not thrown.
 *
 * A piece with no atom (a one-off Post, a blog) matches zero rows — a no-op,
 * not an error.
 *
 * @param {object} a
 * @param {string} a.pieceId       content_items.id
 * @param {string} a.workspaceId   workspaces.id — always filtered (tenant scope)
 * @param {string|null} a.scheduledAt  the schedule just committed; null = unscheduled
 * @param {string|undefined} a.timezone
 */
export async function syncAtomSchedule({ pieceId, workspaceId, scheduledAt, timezone }) {
  // `undefined` means the caller committed no schedule at all — mirroring it
  // would null the atom's slot, which is the opposite of the intent.
  if (scheduledAt === undefined) return
  if (!UUID_RE.test(pieceId || '') || !UUID_RE.test(workspaceId || '')) {
    console.error('[atomSchedule] refusing to sync on a non-uuid id')
    return
  }
  try {
    await sb(`content_plan_atoms?content_piece_id=eq.${pieceId}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(atomSchedulePatch(scheduledAt, timezone)),
    })
  } catch (e) {
    console.error('[atomSchedule] sync failed:', e?.message)
  }
}
