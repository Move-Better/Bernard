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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i


// Scoped by the caller: the Clerk endpoint passes workspaceId, the system
// trigger keys on the unguessable feedback PK (id) alone.
const sb = (path, init = {}) => supabaseRest(path, init, { contentType: 'application/json', prefer: 'return=representation' })


function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>')
}

// Build the reporter-facing "your bug is fixed" email for a feedback row.
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
//   status: 'ok' | 'invalid_id' | 'not_found' | 'lookup_failed' | 'update_failed'
export async function resolveFeedbackRow({ id, note, workspaceId = null }) {
  if (!UUID_RE.test(id || '')) return { status: 'invalid_id' }
  const scope = workspaceId ? `&workspace_id=eq.${workspaceId}` : ''

  const getR = await sb(`feedback?id=eq.${id}${scope}&select=*`)
  if (!getR.ok) {
    console.error('[resolveFeedback] lookup failed', getR.status)
    return { status: 'lookup_failed' }
  }
  const [row] = await getR.json()
  if (!row) return { status: 'not_found' }
  // Idempotent: a row already resolved is a no-op — never re-send the email.
  if (row.resolved_at) return { status: 'ok', id: row.id, notified: !!row.resolved_notified_at, alreadyResolved: true }

  const resolvedNote = note?.trim() || null
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
  const [saved] = await patchR.json()
  return { status: 'ok', id: saved?.id ?? id, notified, alreadyResolved: false }
}
