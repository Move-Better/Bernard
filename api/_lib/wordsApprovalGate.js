// Server-side enforcement of the story-level "words approved" gate — Phase 3
// of the story-monitor redesign (.claude/story-monitor-redesign-plan.md).
//
// Every publish/schedule/retry dispatch (never cancel/delete) must confirm
// the piece's parent interview has words_approved_at set before it's allowed
// to actually send. Enforced here — not just client-side in EditorWorkflowBar
// — so every caller (the editor, the ReviewInbox/YourWeek bulk lane, any
// future caller) is covered automatically; a client-only check would be
// trivially bypassable by anyone calling the API directly.
//
// Leniency by design: a request with NO contentItemId is allowed through
// (logged, not blocked) rather than hard-rejected. This app is a PWA with a
// documented service-worker staleness issue (see CLAUDE.md "Bernard is a
// PWA... the SW can serve a cached app shell after a deploy") — a tab still
// running yesterday's bundle wouldn't know to send this new field, and
// hard-blocking every publish for anyone with a stale cached tab would be a
// self-inflicted incident, not a security boundary worth that cost for an
// internal-staff-only tool. Once a contentItemId IS present, the gate is
// strict — no bypass for a request that has the field but fails the check.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
}

/**
 * @param {string|undefined} contentItemId
 * @param {string} workspaceId
 * @returns {Promise<{ok: true} | {ok: false, status: number, body: {error: string}}>}
 */
export async function checkWordsApproved(contentItemId, workspaceId) {
  if (!contentItemId) {
    console.warn('[wordsApprovalGate] publish request missing contentItemId — cannot enforce gate, allowing through')
    return { ok: true }
  }
  if (!UUID_RE.test(contentItemId)) {
    return { ok: false, status: 400, body: { error: 'invalid_content_item_id' } }
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, status: 503, body: { error: 'not_configured' } }
  }

  const ciRes = await sb(`content_items?id=eq.${contentItemId}&workspace_id=eq.${workspaceId}&select=id,interview_id`)
  if (!ciRes.ok) {
    console.error(`[wordsApprovalGate] content_items lookup ${ciRes.status} for id=${contentItemId}`)
    return { ok: false, status: 500, body: { error: 'words_gate_check_failed' } }
  }
  const [piece] = await ciRes.json().catch(() => [])
  if (!piece) return { ok: false, status: 403, body: { error: 'content_item_not_found' } }
  // No parent interview (shouldn't happen in practice, but nothing to gate
  // against if it does) — let it through rather than block on a null ref.
  if (!piece.interview_id) return { ok: true }

  const ivRes = await sb(`interviews?id=eq.${piece.interview_id}&select=words_approved_at`)
  if (!ivRes.ok) {
    console.error(`[wordsApprovalGate] interviews lookup ${ivRes.status} for interview=${piece.interview_id}`)
    return { ok: false, status: 500, body: { error: 'words_gate_check_failed' } }
  }
  const [interview] = await ivRes.json().catch(() => [])
  if (!interview?.words_approved_at) {
    return { ok: false, status: 403, body: { error: 'words_not_approved' } }
  }
  return { ok: true }
}
