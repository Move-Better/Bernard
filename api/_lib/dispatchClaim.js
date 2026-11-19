// Cross-path dispatch lock for a content_items row.
//
// A single content_items row can be dispatched to bundle.social from more than
// one place:
//   - the /week Approve path        (api/_lib/dispatchContentItem.js)
//   - the editor Publish/Schedule   (api/_routes/publish/social.js handleBundlePublish)
//   - the manual "Retry" action     (api/_routes/producer/retry-publish.js)
// Without a shared lock two of these can run concurrently against the SAME piece
// and post it twice to the customer's live channel (GBP / Instagram / …) — the
// cross-path double-publish race (audit P1, 2026-07-15).
//
// This module is that lock. It is the ONE mechanism (per the audit's "don't
// invent a second mechanism"): an atomic PATCH that flips
// content_items.dispatching_at from null-or-stale to now(). Postgres serializes
// the conditional UPDATE, so exactly one caller gets its row back and proceeds;
// every other caller gets 0 rows and MUST NOT publish. dispatchContentItem.js
// already used this pattern inline; it (and the two other publish paths) now
// share this code so the claim semantics can never drift between them.

import { supabaseRest } from './supabaseRest.js'


// A dispatch shouldn't outlive the function's max duration; a claim older than
// this is treated as abandoned (crashed request) and is reclaimable. Kept in
// one place so every path uses the same abandonment window.
export const CLAIM_STALE_MS = 5 * 60 * 1000

const sb = (path, init = {}) => supabaseRest(path, init, { timeoutMs: 15_000, contentType: 'application/json' })


/**
 * Atomically claim a content_items row for dispatch.
 *
 * @param {string} pieceId      content_items.id
 * @param {string} workspaceId  workspaces.id (tenant scope — always filtered)
 * @returns {Promise<
 *   | { ok: true, row: object }                    // claim acquired; row is the AUTHORITATIVE post-claim row
 *   | { ok: false, reason: 'in_progress' }         // another dispatch holds a fresh claim — do NOT publish
 *   | { ok: false, reason: 'claim_failed' }        // the PATCH returned a non-2xx — do NOT publish
 * >}
 *
 * A network/timeout error rejects (same as the original inline claim) so the
 * caller's own error handling / Sentry wrapper sees it — never publish on throw.
 */
export async function claimDispatch(pieceId, workspaceId) {
  const nowIso = new Date().toISOString()
  const staleIso = new Date(Date.now() - CLAIM_STALE_MS).toISOString()
  const res = await sb(
    `content_items?id=eq.${pieceId}&workspace_id=eq.${workspaceId}&or=(dispatching_at.is.null,dispatching_at.lt.${staleIso})`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ dispatching_at: nowIso }),
    },
  )
  if (!res.ok) return { ok: false, reason: 'claim_failed' }
  const row = (await res.json().catch(() => []))?.[0]
  if (!row) return { ok: false, reason: 'in_progress' }
  return { ok: true, row }
}

/**
 * Release a dispatch claim (dispatching_at = null). Best-effort: a failed
 * release is logged, not thrown — the stale-claim window is the backstop.
 *
 * Pass a terminal `status` (+ `scheduled_at`, etc.) in `extra` to commit it in
 * the SAME PATCH as the release, so there is no dispatching_at=null /
 * status=approved gap that a concurrent path could re-claim and re-post into.
 *
 * @param {string} pieceId
 * @param {string} workspaceId
 * @param {object} [extra]  extra columns to set alongside the release (e.g. { status: 'scheduled' })
 */
export async function releaseDispatch(pieceId, workspaceId, extra = {}) {
  await sb(`content_items?id=eq.${pieceId}&workspace_id=eq.${workspaceId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ dispatching_at: null, updated_at: new Date().toISOString(), ...extra }),
  }).catch((e) => console.warn('[dispatchClaim] release failed:', e?.message))
}

/**
 * Persist a content_items row's dispatch_state (the append-only record of which
 * targets have been posted — shape in migration 157). Called after EACH post of
 * a GBP fan-out so a failure part-way through leaves the already-posted
 * locations recorded, and the next attempt from ANY path (Approve, the editor's
 * Publish button, the producer retry) skips them instead of posting twice to a
 * public listing.
 *
 * Returns whether the write landed. A non-2xx response counts as a failure, not
 * only a thrown fetch (audit P2, 2026-11-18: a rejected PATCH used to pass
 * silently, so the record was lost and the next retry re-posted). Callers stop
 * the fan-out on false: posting more locations whose record can't be saved
 * only widens what a retry would duplicate.
 *
 * @param {string} pieceId
 * @param {string} workspaceId
 * @param {object} dispatchState  the whole dispatch_state object to write
 * @returns {Promise<boolean>}
 */
export async function recordDispatchState(pieceId, workspaceId, dispatchState) {
  try {
    const res = await sb(`content_items?id=eq.${pieceId}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ dispatch_state: dispatchState, updated_at: new Date().toISOString() }),
    })
    if (res.ok) return true
    console.error('[dispatchClaim] dispatch_state persist rejected:', pieceId, res.status)
    return false
  } catch (e) {
    console.error('[dispatchClaim] dispatch_state persist failed:', pieceId, e?.message)
    return false
  }
}
