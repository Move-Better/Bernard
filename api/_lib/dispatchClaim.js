// Cross-path dispatch lock for a content_items row.
//
// A single content_items row can be dispatched to bundle.social from more than
// one place:
//   - the /week Approve path        (api/_lib/dispatchContentItem.js)
//   - the editor Publish/Schedule   (api/_routes/publish/buffer.js handleBundlePublish)
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

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// A dispatch shouldn't outlive the function's max duration; a claim older than
// this is treated as abandoned (crashed request) and is reclaimable. Kept in
// one place so every path uses the same abandonment window.
export const CLAIM_STALE_MS = 5 * 60 * 1000

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(15_000),
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

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
