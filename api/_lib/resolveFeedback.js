// @ts-check
// Shared feedback-resolution logic: mark a feedback row fixed and best-effort
// email the reporter that it's safe to rely on the feature again.
//
// One copy, two callers, so the reporter email + patch never drift apart:
//   - PATCH /api/feedback/resolve         Clerk-authed, workspace-scoped (a
//                                          staffer resolving their own row)
//   - POST  /api/cron/resolve-feedback    CRON_SECRET-authed system trigger,
//                                          resolves by id from a headless/
//                                          background session (no browser).
//
// The resolution itself is the durable fact; the email is delivery on top of
// it — a failed send never blocks the resolve, it just leaves
// resolved_notified_at null.

import { sendEmail } from './notifyAdmin.js'

import { supabaseRest } from './supabaseRest.js'

/** @typedef {import('./supabase.types').Database['public']['Tables']['feedback']['Row']} FeedbackRow */
/** @typedef {import('./supabase.types').Database['public']['Tables']['feedback']['Update']} FeedbackUpdate */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i


// Scoped by the caller: the Clerk endpoint passes workspaceId, the system
// trigger keys on the unguessable feedback PK (id) alone.
/** @param {string} path @param {RequestInit} [init] */
const sb = (path, init = {}) => supabaseRest(path, init, { contentType: 'application/json', prefer: 'return=representation' })


/** @param {string} str */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>')
}

// Build the reporter-facing "your bug is fixed" email for a feedback row.
/** @param {FeedbackRow} row @param {string | null} resolvedNote */
export function buildResolutionEmail(row, resolvedNote) {
  const html = `
<table style="font-family:sans-serif;font-size:14px;color:#1e293b;border-collapse:collapse;width:100%;max-width:600px">
  <tr><td style="padding:8px 0">Hi${row.user_name ? ` ${escHtml(row.user_name)}` : ''},</td></tr>
  <tr><td style="padding:8px 0">The issue you reported in Bernard has been fixed — it's safe to go back to using it now.</td></tr>
  <tr><td style="padding:16px 0 8px"><strong>You reported:</strong></td></tr>
  <tr><td style="padding:12px 16px;background:#f8fafc;border-left:3px solid #6366f1;white-space:pre-wrap">${escHtml(row.message)}</td></tr>
  ${resolvedNote ? `<tr><td style="padding:16px 0 8px"><strong>What we fixed:</strong></td></tr><tr><td style="padding:12px 16px;background:#f0fdf4;border-left:3px solid #16a34a;white-space:pre-wrap">${escHtml(resolvedNote)}</td></tr>` : ''}
  <tr><td style="padding:16px 0 8px;color:#64748b">Thanks for flagging it — reports like this are how we find bugs.</td></tr>
</table>`
  const text = `Hi${row.user_name ? ` ${row.user_name}` : ''},\n\nThe issue you reported in Bernard has been fixed — it's safe to go back to using it now.\n\nYou reported:\n${row.message}\n${resolvedNote ? `\nWhat we fixed:\n${resolvedNote}\n` : ''}\nThanks for flagging it.`
  return { subject: 'Fixed: your Bernard bug report', html, text }
}

// Resolve one feedback row by id. When workspaceId is given the lookup + patch
// are scoped to it (tenant isolation for the Clerk endpoint); omit it for the
// system trigger, which keys on the (unguessable) feedback id alone.
//
// Returns { status, id?, notified, alreadyResolved }:
//   status: 'ok' | 'invalid_id' | 'note_required' | 'not_found' | 'lookup_failed' | 'update_failed'

// A resolution note is REQUIRED (2026-08-11). It was optional, so a row could
// be resolved with nothing to say, and both the email and the in-app banner
// then fell back to a bare "the issue you reported is resolved" — which tells
// the reporter nothing about whether it's safe to go back to what broke.
// Enforced here rather than in each route so the Clerk endpoint and the
// headless cron trigger cannot drift.
//
// The floor is length, not quality: it stops an empty string and a shrugged
// "done", and can't judge plain language. Recent real notes run 300–1500
// characters, so 15 blocks the degenerate case without being a hurdle.
const MIN_NOTE_LEN = 15

/** @param {{ id?: string, note?: string, workspaceId?: string | null }} args */
export async function resolveFeedbackRow({ id, note, workspaceId = null }) {
  if (!UUID_RE.test(id || '')) return { status: 'invalid_id' }
  if ((note ?? '').trim().length < MIN_NOTE_LEN) return { status: 'note_required' }
  const scope = workspaceId ? `&workspace_id=eq.${workspaceId}` : ''

  const getR = await sb(`feedback?id=eq.${id}${scope}&select=*`)
  if (!getR.ok) {
    console.error('[resolveFeedback] lookup failed', getR.status)
    return { status: 'lookup_failed' }
  }
  const [row] = /** @type {FeedbackRow[]} */ (await getR.json())
  if (!row) return { status: 'not_found' }
  // Idempotent: a row already resolved is a no-op — never re-send the email.
  if (row.resolved_at) return { status: 'ok', id: row.id, notified: !!row.resolved_notified_at, alreadyResolved: true }

  const resolvedNote = note.trim()
  /** @type {FeedbackUpdate} */
  const patch = { resolved_at: new Date().toISOString(), resolved_note: resolvedNote }

  let notified = false
  if (row.user_email) {
    const { subject, html, text } = buildResolutionEmail(row, resolvedNote)
    const result = await sendEmail({ to: row.user_email, subject, html, text })
    notified = !!result.ok
    patch.resolved_notified_at = result.ok ? new Date().toISOString() : null
  }

  const patchR = await sb(`feedback?id=eq.${id}${scope}`, { method: 'PATCH', body: JSON.stringify(patch) })
  if (!patchR.ok) {
    const body = await patchR.text().catch(() => '')
    console.error('[resolveFeedback] update failed', patchR.status, body.slice(0, 500))
    return { status: 'update_failed' }
  }
  const [saved] = /** @type {FeedbackRow[]} */ (await patchR.json())
  return { status: 'ok', id: saved?.id ?? id, notified, alreadyResolved: false }
}
