// publishLock — once a post is committed, its CONTENT stops being editable.
//
// Why this exists: opening a published post used to load the full slide/video
// editor, and every control in it wrote straight to the row. The live post on
// the network is untouched by that (it left our system at publish time), so the
// only thing an edit changes is *our record of what we published* — which is
// what metrics attribution, the exemplar pool (is_model_post → fetchTopExemplars)
// and the learning loop all read. Silent drift, no error, no signal.
//
// `scheduled` locks for the same reason with a twist: the payload is already
// committed to bundle.social, so editing the row after that point desyncs us
// from what will actually post. Unlike published, though, scheduled is
// recoverable — so there is exactly one legal way out (unschedule), and it is
// the ONLY status transition this module permits on a locked row. Without it a
// typo caught after scheduling would be unfixable until the post went live.
//
// JUDGMENT is never frozen. Rating a post ("the post came together", "the
// audience responded"),
// commenting on it and taking notes are the whole point of looking at a
// published post, and they don't claim anything about what shipped.
//
// This module is deliberately pure and shared by BOTH sides: the client router
// (src/pages/StoryboardPublish.jsx) and the API handler (api/_routes/db/content.js
// imports it across the boundary, as several api/_lib modules already do). One
// copy, so the screen and the server can never disagree about what's frozen —
// see the "Client/server mirror pairs" hazard in CLAUDE.md for what the two-copy
// version of this costs.

/** Statuses whose content is committed and must not change. */
export const LOCKED_STATUSES = Object.freeze(['scheduled', 'published'])

/** Statuses a locked-but-recoverable piece may be returned to. */
export const UNSCHEDULE_TARGETS = Object.freeze(['approved', 'draft'])

/**
 * The `error` key a refused write comes back with in the 409 body. Exported so
 * the client can RECOGNIZE the server's refusal instead of re-typing these
 * strings at the call site — they are produced here and consumed here, which is
 * the same one-copy argument the module header makes about the lock itself.
 */
export const LOCK_REJECTION_REASONS = Object.freeze(['locked_scheduled', 'locked_published'])

/** Single place the reason is derived, so the branches below can't drift apart. */
function lockReasonFor(currentStatus) {
  return currentStatus === 'published' ? 'locked_published' : 'locked_scheduled'
}

/**
 * Patch keys (camelCase, as the editor client sends them) that describe WHAT
 * WAS PUBLISHED. Anything here is rejected on a locked row.
 *
 * Deliberately excluded, because none of them restate the shipped artifact:
 *   performedWell / isModelPost / modelReasons / modelNote — human verdicts
 *   notes                                                  — internal annotation
 *   archivedAt                                             — filing, not content
 *   platformPostId / resolvedUrl / publishedAt             — receipts written by
 *     the publish pipeline (which bypasses this route entirely — it writes via
 *     sb() directly — but they are not content either way)
 */
export const FROZEN_PATCH_FIELDS = Object.freeze([
  'content',
  'overlayText',
  'slides',
  'textCard',
  'mediaUrls',
  'aspectRatio',
  'format',
  'seoTitle',
  'metaDescription',
  'targetLocations',
  'locationId',
  'locationOverrides',
])

export function isLockedStatus(status) {
  return LOCKED_STATUSES.includes(status)
}

export function isPieceLocked(piece) {
  return isLockedStatus(piece?.status)
}

/** Published is terminal; scheduled can be pulled back. */
export function canUnschedule(piece) {
  return piece?.status === 'scheduled'
}

/**
 * Is this patch the one legal escape — returning a scheduled piece to the
 * editable queue? Requires an explicit target status; clearing scheduled_at
 * alone would leave the row stranded as 'scheduled' with no time on it.
 */
export function isUnschedulePatch(patch) {
  return UNSCHEDULE_TARGETS.includes(patch?.status)
}

/**
 * Could this patch possibly be refused by the lock? Lets the handler skip the
 * status read for the common autosave-adjacent saves that touch only judgment
 * fields (a rating, a note), which are legal on every status.
 *
 * Must stay a strict over-approximation: a false negative here silently
 * disables the lock for that field, which is exactly the failure this whole
 * module exists to prevent.
 */
export function patchNeedsLockCheck(patch = {}) {
  if (patch.status !== undefined || patch.scheduledAt !== undefined) return true
  return FROZEN_PATCH_FIELDS.some((k) => patch[k] !== undefined)
}

/**
 * The single decision both sides call.
 *
 * @param {string} currentStatus - the row's status as stored, never as claimed
 *   by the caller (a client that sends `{status:'draft', content:'…'}` must not
 *   be able to unlock itself in the same breath).
 * @returns {{ok: true} | {ok: false, reason: string, fields: string[]}}
 */
export function checkPatchAgainstLock(currentStatus, patch = {}) {
  if (!isLockedStatus(currentStatus)) return { ok: true }

  const fields = FROZEN_PATCH_FIELDS.filter((k) => patch[k] !== undefined)

  if (currentStatus === 'scheduled') {
    // Unscheduling may carry scheduledAt:null, and nothing else.
    if (isUnschedulePatch(patch)) {
      if (fields.length === 0) return { ok: true }
      return { ok: false, reason: lockReasonFor(currentStatus), fields }
    }
    if (patch.scheduledAt !== undefined) {
      return { ok: false, reason: lockReasonFor(currentStatus), fields: [...fields, 'scheduledAt'] }
    }
  }

  if (currentStatus === 'published') {
    // Terminal: no route back to an editable status through this handler.
    if (patch.status !== undefined && patch.status !== 'published') {
      return { ok: false, reason: lockReasonFor(currentStatus), fields: [...fields, 'status'] }
    }
    if (patch.scheduledAt !== undefined) {
      return { ok: false, reason: lockReasonFor(currentStatus), fields: [...fields, 'scheduledAt'] }
    }
  }

  if (fields.length > 0) {
    return { ok: false, reason: lockReasonFor(currentStatus), fields }
  }
  return { ok: true }
}

/**
 * CLIENT side: is this thrown ApiError the server refusing a write because the
 * piece is already committed?
 *
 * This is the one save failure that is not a problem the producer can act on.
 * The row is scheduled or published, the write was correctly refused, and the
 * only honest resolution is to stop showing them an editor — so the caller
 * treats it as a silent no-op plus a refetch rather than an error toast.
 *
 * Matched on the reason key, not the status alone: a future 409 from this route
 * for some other conflict must NOT be swallowed as if it were the lock.
 */
export function isLockRejection(err) {
  if (!err || typeof err !== 'object') return false
  if (err.status !== 409) return false
  const reason = err.payload && typeof err.payload === 'object' ? err.payload.error : undefined
  return LOCK_REJECTION_REASONS.includes(reason)
}
