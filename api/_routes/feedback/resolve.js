// PATCH /api/feedback/resolve
//
// Marks a feedback row as fixed and best-effort emails the original reporter
// (if they have an email on file) so they know it's safe to rely on the
// feature they reported as broken again — the whole point being staff who
// stop using Bernard at a bottleneck shouldn't have to guess when to come back.
//
// Body (JSON):
//   id     string  required — feedback row id (uuid)
//   note   string  optional — what was fixed, shown to the reporter

import { sendEmail }        from '../../_lib/notifyAdmin.js'
import { requireRole }      from '../../_lib/auth.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
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

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  const wsCtx = await workspaceContext(req).catch(() => null)
  if (!wsCtx) return res.status(400).json({ error: 'workspace_not_resolved' })

  const auth = await requireRole(req, null, { orgId: wsCtx.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const { id, note } = req.body ?? {}
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

  const getR = await sb(`feedback?id=eq.${id}&workspace_id=eq.${wsCtx.id}&select=*`)
  if (!getR.ok) {
    console.error('[feedback/resolve] lookup failed', getR.status)
    return res.status(500).json({ error: 'lookup_failed' })
  }
  const [row] = await getR.json()
  if (!row) return res.status(404).json({ error: 'not_found' })

  const patch = {
    resolved_at:   new Date().toISOString(),
    resolved_note: note?.trim() || null,
  }

  // Best-effort notify the reporter, then record the attempt regardless of outcome —
  // the resolution itself is the durable fact; the email is delivery on top of it.
  if (row.user_email) {
    const html = `
<table style="font-family:sans-serif;font-size:14px;color:#1e293b;border-collapse:collapse;width:100%;max-width:600px">
  <tr><td style="padding:8px 0">Hi${row.user_name ? ` ${escHtml(row.user_name)}` : ''},</td></tr>
  <tr><td style="padding:8px 0">The issue you reported in Bernard has been fixed — it's safe to go back to using it now.</td></tr>
  <tr><td style="padding:16px 0 8px"><strong>You reported:</strong></td></tr>
  <tr><td style="padding:12px 16px;background:#f8fafc;border-left:3px solid #6366f1;white-space:pre-wrap">${escHtml(row.message)}</td></tr>
  ${patch.resolved_note ? `<tr><td style="padding:16px 0 8px"><strong>What we fixed:</strong></td></tr><tr><td style="padding:12px 16px;background:#f0fdf4;border-left:3px solid #16a34a;white-space:pre-wrap">${escHtml(patch.resolved_note)}</td></tr>` : ''}
  <tr><td style="padding:16px 0 8px;color:#64748b">Thanks for flagging it — reports like this are how we find bugs.</td></tr>
</table>`
    const text = `Hi${row.user_name ? ` ${row.user_name}` : ''},\n\nThe issue you reported in Bernard has been fixed — it's safe to go back to using it now.\n\nYou reported:\n${row.message}\n${patch.resolved_note ? `\nWhat we fixed:\n${patch.resolved_note}\n` : ''}\nThanks for flagging it.`

    const result = await sendEmail({
      to: row.user_email,
      subject: `Fixed: your Bernard bug report`,
      html,
      text,
    })
    patch.resolved_notified_at = result.ok ? new Date().toISOString() : null
  }

  const patchR = await sb(`feedback?id=eq.${id}&workspace_id=eq.${wsCtx.id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (!patchR.ok) {
    const body = await patchR.text().catch(() => '')
    console.error('[feedback/resolve] update failed', patchR.status, body.slice(0, 500))
    return res.status(500).json({ error: 'update_failed' })
  }
  const [saved] = await patchR.json()

  return res.status(200).json({ ok: true, id: saved.id, notified: !!patch.resolved_notified_at })
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>')
}

export const config = { runtime: 'nodejs' }
