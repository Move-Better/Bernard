// POST /api/feedback
//
// Accepts user-submitted feedback (message + optional base64 screenshot) and
// emails it to the admin via Resend. Auth is required but workspace resolution
// is best-effort — feedback still sends if workspace lookup fails.
//
// Body (JSON):
//   message         string  required
//   screenshotDataUrl  string  optional — data:image/png;base64,…
//   pageUrl         string  optional
//   userName        string  optional
//   userEmail       string  optional

import { enforceLimit }     from '../_lib/ratelimit.js'
import { requireRole }      from '../_lib/auth.js'
import { workspaceContext } from '../_lib/workspaceContext.js'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const wsCtx = await workspaceContext(req).catch(() => null)

  const auth = await requireRole(req, null, { orgId: wsCtx?.clerk_org_id ?? null })
  if (!auth.ok) return res.status(401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'feedback'))) return

  const { message, screenshotDataUrl, pageUrl, userName, userEmail } = req.body ?? {}

  if (!message?.trim()) return res.status(400).json({ error: 'message is required' })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // Best-effort — don't fail the user if email isn't configured
    console.warn('[feedback] RESEND_API_KEY not set; dropping feedback submission')
    return res.status(200).json({ ok: true })
  }

  const attachments = []
  if (screenshotDataUrl?.startsWith('data:image/')) {
    const [header, base64] = screenshotDataUrl.split(',')
    const ext = header.includes('png') ? 'png' : 'jpeg'
    attachments.push({ filename: `screenshot.${ext}`, content: base64 })
  }

  const ws    = wsCtx?.slug || 'unknown'
  const user  = [userName, userEmail].filter(Boolean).join(' — ') || 'unknown user'
  const page  = pageUrl || 'unknown page'

  const html = `
<table style="font-family:sans-serif;font-size:14px;color:#1e293b;border-collapse:collapse;width:100%;max-width:600px">
  <tr><td style="padding:8px 0"><strong>From:</strong> ${escHtml(user)}</td></tr>
  <tr><td style="padding:8px 0"><strong>Workspace:</strong> ${escHtml(ws)}</td></tr>
  <tr><td style="padding:8px 0"><strong>Page:</strong> ${escHtml(page)}</td></tr>
  <tr><td style="padding:16px 0 8px"><strong>Message:</strong></td></tr>
  <tr><td style="padding:12px 16px;background:#f8fafc;border-left:3px solid #6366f1;white-space:pre-wrap">${escHtml(message.trim())}</td></tr>
  ${attachments.length ? '<tr><td style="padding:8px 0;color:#64748b">Screenshot attached.</td></tr>' : ''}
</table>`

  const text = `From: ${user}\nWorkspace: ${ws}\nPage: ${page}\n\n${message.trim()}`

  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.ADMIN_NOTIFY_FROM  || 'Bernard <noreply@withbernard.ai>',
        to:   [process.env.ADMIN_NOTIFY_EMAIL || 'drq@withbernard.ai'],
        subject: `[Feedback] ${ws}: ${message.trim().slice(0, 60)}${message.trim().length > 60 ? '…' : ''}`,
        html,
        text,
        ...(attachments.length ? { attachments } : {}),
      }),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error('[feedback] resend error:', r.status, body.slice(0, 400))
    }
  } catch (e) {
    console.error('[feedback] network error:', e?.message)
  }

  // Always 200 — don't surface Resend failures to the user
  return res.status(200).json({ ok: true })
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
