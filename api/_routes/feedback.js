// POST /api/feedback
//
// Accepts user-submitted feedback (message + optional base64 screenshot),
// persists it to the `feedback` table (source of truth), uploads the
// screenshot to Blob storage, and best-effort emails a notification via
// Resend. The DB insert happens BEFORE the email attempt — a Resend failure
// or misconfigured recipient no longer loses the submission, only the
// notification.
//
// Body (JSON):
//   message         string  required
//   screenshotDataUrl  string  optional — data:image/png;base64,…
//   pageUrl         string  optional
//   userName        string  optional
//   userEmail       string  optional

import { randomUUID } from 'node:crypto'
import { put }               from '@vercel/blob'
import { enforceLimit }      from '../_lib/ratelimit.js'
import { requireRole }       from '../_lib/auth.js'
import { workspaceContext }  from '../_lib/workspaceContext.js'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const wsCtx = await workspaceContext(req).catch(() => null)
  if (!wsCtx) return res.status(400).json({ error: 'workspace_not_resolved' })

  const auth = await requireRole(req, null, { orgId: wsCtx.clerk_org_id })
  if (!auth.ok) return res.status(401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'feedback', wsCtx.id))) return

  const { message, screenshotDataUrl, pageUrl, userName, userEmail } = req.body ?? {}

  if (!message?.trim()) return res.status(400).json({ error: 'message is required' })

  // ── Upload screenshot to Blob (best-effort — a failed upload doesn't lose the message) ──
  let screenshotUrl = null
  if (screenshotDataUrl?.startsWith('data:image/')) {
    try {
      const [header, base64] = screenshotDataUrl.split(',')
      const ext = header.includes('png') ? 'png' : 'jpeg'
      const buffer = Buffer.from(base64, 'base64')
      const blob = await put(`feedback/${wsCtx.id}/${randomUUID()}.${ext}`, buffer, {
        access: 'public',
        contentType: header.includes('png') ? 'image/png' : 'image/jpeg',
      })
      screenshotUrl = blob.url
    } catch (e) {
      console.error('[feedback] screenshot upload failed:', e?.message)
    }
  }

  // ── Persist — this is the source of truth; a failure here IS a real failure ──
  const row = {
    workspace_id:   wsCtx.id,
    user_id:        auth.userId ?? null,
    user_name:       userName ?? null,
    user_email:      userEmail ?? null,
    message:        message.trim(),
    screenshot_url: screenshotUrl,
    page_url:       pageUrl ?? null,
  }

  const insertR = await sb('feedback', { method: 'POST', body: JSON.stringify(row) })
  if (!insertR.ok) {
    const body = await insertR.text().catch(() => '')
    console.error('[feedback] insert failed — supabase', insertR.status, body.slice(0, 500))
    return res.status(500).json({ error: 'save_failed' })
  }
  const [saved] = await insertR.json()

  // ── Notify — best-effort; failures are logged + recorded on the row, but the
  // submission is already durably saved, so they don't fail the request ──────
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[feedback] RESEND_API_KEY not set; skipping notification email')
    return res.status(200).json({ ok: true, id: saved.id })
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
  ${screenshotUrl ? `<tr><td style="padding:8px 0;color:#64748b">Screenshot: <a href="${screenshotUrl}">${escHtml(screenshotUrl)}</a></td></tr>` : ''}
</table>`

  const text = `From: ${user}\nWorkspace: ${ws}\nPage: ${page}\n\n${message.trim()}${screenshotUrl ? `\n\nScreenshot: ${screenshotUrl}` : ''}`

  let notifyOk = false
  let notifyError = null
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
    if (r.ok) {
      notifyOk = true
    } else {
      const body = await r.text().catch(() => '')
      notifyError = `resend ${r.status}: ${body.slice(0, 400)}`
      console.error('[feedback] resend error:', notifyError)
    }
  } catch (e) {
    notifyError = `network error: ${e?.message}`
    console.error('[feedback]', notifyError)
  }

  // Record the notification outcome on the already-saved row — best-effort,
  // doesn't affect the response either way.
  await sb(`feedback?id=eq.${saved.id}&workspace_id=eq.${wsCtx.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ notify_ok: notifyOk, notify_error: notifyError }),
  }).catch(() => {})

  // The submission is durably saved regardless of notification outcome.
  return res.status(200).json({ ok: true, id: saved.id })
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
