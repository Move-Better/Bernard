// The Standing Producer's overdue-approval sensor + nudge ledger.
//
// WHY THIS EXISTS (.claude/decisions.md 2026-07-28 — "P5 (approve-once) NOT
// built"). Last 14 days on movebetter: 8 planned slots came and went with a
// FINISHED draft sitting in the queue (GBP idle 14.0d with 3 missed, Facebook
// idle 13.8d, Instagram 5 missed) — while the median time-to-approve WHEN
// SOMEONE LOOKS is 0.6 hours across 25 approvals in 30 days. Nobody is drowning
// in per-piece review; nobody is opening the queue. That is an ATTENTION
// problem, so the intervention is a nudge carrying a one-tap link straight to
// the piece — not a removal of the approval gate.
//
// WHAT COUNTS AS A MISSED SLOT, and why it is defined this way. The slot lives
// on `content_plan_atoms.scheduled_at`; the draft lives on the `content_items`
// row the atom points at via `content_piece_id`. Verified against prod
// 2026-07-28: no `content_items` row carries its own past `scheduled_at` while
// still a draft (that column is written at approve/schedule time), so the atom
// is the complete and only slot anchor. This definition reproduces the
// decision's evidence EXACTLY — 8 rows on movebetter, 3 gbp + 5 instagram.
//
// Deliberately NOT nudged: atoms with `content_piece_id IS NULL` (Bernard has
// not drafted them yet — there is nothing for a human to approve and no piece
// to link to). A large majority of past-slot atoms across the other six
// workspaces are exactly this, and emailing about them would be noise.
//
// PURE-ish: takes an `sb` fetcher from the caller (same posture as
// trustMetrics.js) so the cron owns credentials and this stays unit-testable.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Ledger `kind` for a sent nudge. `agent_actions.kind` is free text (no CHECK
// constraint — verified against the migration set), so this needs no migration.
export const NUDGE_KIND = 'approval_nudge'

// How far back a missed slot still counts as "act on this". Past this the piece
// is abandoned rather than overdue, and nagging about it forever is noise. Also
// bounds the query and matches the window the decision's evidence was measured
// over.
export const OVERDUE_WINDOW_DAYS = 14

// One nudge per workspace per day. 20h (not 24h) so a cron that drifts slightly
// later day-over-day never skips a day, while a same-day re-run or a manual
// re-trigger is still suppressed. Because recipients are workspace-scoped this
// also delivers the "at most one per recipient per day" cap — with one honest
// edge: a person who is staff on TWO workspaces can receive one email from each.
export const NUDGE_COOLDOWN_HOURS = 20

// Cap the list in a single email. Beyond this the email stops being a to-do list
// and becomes a wall; the count in the header still tells the whole truth.
export const MAX_ITEMS_PER_EMAIL = 25

/** Deep link to the piece's own review/editor screen — the whole point of the
 *  nudge is removing navigation friction, so never link to a generic /week. */
export function pieceUrl(slug, pieceId) {
  return `https://${slug}.withbernard.ai/publish/${pieceId}`
}

/**
 * Has this workspace already been nudged inside the cooldown?
 *
 * Reads the ledger itself rather than a dedicated `last_sent_at` column, so the
 * record of what was sent and the guard against re-sending can never disagree.
 *
 * Fails CLOSED (returns true ⇒ skip) when the read fails: an unreachable ledger
 * means we cannot prove we haven't already emailed today, and double-emailing
 * real clinicians is worse than missing one day's nudge.
 *
 * @returns {Promise<boolean>}
 */
export async function hasRecentNudge({ workspaceId, sb, now = new Date() }) {
  const since = new Date(now.getTime() - NUDGE_COOLDOWN_HOURS * 3600_000).toISOString()
  try {
    const r = await sb(
      `agent_actions?workspace_id=eq.${workspaceId}&kind=eq.${NUDGE_KIND}` +
      `&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`
    )
    if (!r.ok) {
      console.error('[approvalEscalation] cooldown read failed:', r.status, '— skipping to avoid a double send')
      return true
    }
    const rows = (await r.json().catch(() => [])) || []
    return rows.length > 0
  } catch (e) {
    console.error('[approvalEscalation] cooldown read threw:', e?.message, '— skipping to avoid a double send')
    return true
  }
}

/**
 * Pieces sitting unapproved whose slot is today or already past.
 *
 * @param {{ workspaceId: string, sb: Function, now?: Date }} input
 * @returns {Promise<Array<{
 *   pieceId: string, atomId: string, platform: string|null, format: string|null,
 *   topic: string|null, scheduledAt: string, daysPast: number
 * }>>}  most-overdue first; [] on any read failure (never throws)
 */
export async function findOverdueApprovals({ workspaceId, sb, now = new Date() }) {
  const nowMs = now.getTime()
  const nowIso = now.toISOString()
  const floorIso = new Date(nowMs - OVERDUE_WINDOW_DAYS * 86_400_000).toISOString()

  // 1. Atoms whose slot has passed inside the window AND that already carry a
  //    drafted piece.
  const aRes = await sb(
    `content_plan_atoms?workspace_id=eq.${workspaceId}` +
    `&content_piece_id=not.is.null` +
    `&scheduled_at=lte.${encodeURIComponent(nowIso)}` +
    `&scheduled_at=gte.${encodeURIComponent(floorIso)}` +
    `&select=id,platform,format,scheduled_at,content_piece_id` +
    `&order=scheduled_at.asc&limit=200`
  )
  if (!aRes.ok) {
    console.error('[approvalEscalation] atom fetch failed:', aRes.status)
    return []
  }
  const atoms = (await aRes.json().catch(() => [])) || []
  if (atoms.length === 0) return []

  const pieceIds = [...new Set(
    atoms.map((a) => a.content_piece_id).filter((id) => id && UUID_RE.test(id))
  )]
  if (pieceIds.length === 0) return []

  // 2. Of those pieces, the ones still awaiting a human. `status=eq.draft` is
  //    the whole filter: prod's content_items statuses are draft / approved /
  //    published / archived, so this excludes archived and already-actioned
  //    rows without a second predicate. ("held" is a voice_audit gate, not a
  //    status — a held piece is still `draft` and still needs a human, which is
  //    exactly right for a nudge.)
  const iRes = await sb(
    `content_items?workspace_id=eq.${workspaceId}&status=eq.draft` +
    `&id=in.(${pieceIds.join(',')})` +
    `&select=id,topic,platform&limit=200`
  )
  if (!iRes.ok) {
    console.error('[approvalEscalation] content_items fetch failed:', iRes.status)
    return []
  }
  const drafts = new Map(
    ((await iRes.json().catch(() => [])) || []).map((ci) => [ci.id, ci])
  )
  if (drafts.size === 0) return []

  // 3. Join. Several atoms can point at one piece; keep the EARLIEST slot so the
  //    reported overdue age is the honest one. Atoms are already ordered
  //    scheduled_at ascending, so first-wins gives that for free.
  const byPiece = new Map()
  for (const a of atoms) {
    const ci = drafts.get(a.content_piece_id)
    if (!ci || byPiece.has(a.content_piece_id)) continue
    byPiece.set(a.content_piece_id, {
      pieceId:     a.content_piece_id,
      atomId:      a.id,
      platform:    ci.platform || a.platform || null,
      format:      a.format || null,
      topic:       ci.topic || null,
      scheduledAt: a.scheduled_at,
      daysPast:    Math.max(0, (nowMs - Date.parse(a.scheduled_at)) / 86_400_000),
    })
  }

  return [...byPiece.values()].sort(
    (x, y) => Date.parse(x.scheduledAt) - Date.parse(y.scheduledAt)
  )
}
