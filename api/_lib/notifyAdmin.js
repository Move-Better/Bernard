// Best-effort admin notification email via Resend's HTTP API.
//
// No dependency: posts to https://api.resend.com/emails directly.
// Env:
//   RESEND_API_KEY      — required; if missing the call is a no-op (warn only)
//   ADMIN_NOTIFY_EMAIL  — defaults to drq@withbernard.ai
//   ADMIN_NOTIFY_FROM   — defaults to "Bernard <noreply@withbernard.ai>"
//
// Always resolves; never throws. Caller should not await success.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export async function sendAdminNotification({ subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[notifyAdmin] RESEND_API_KEY not set; skipping notification')
    return { ok: false, skipped: true }
  }
  const to   = process.env.ADMIN_NOTIFY_EMAIL || 'drq@withbernard.ai'
  const from = process.env.ADMIN_NOTIFY_FROM  || 'Bernard <noreply@withbernard.ai>'

  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        ...(html ? { html } : {}),
      }),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[notifyAdmin] resend ${r.status}:`, body.slice(0, 500))
      return { ok: false, status: r.status }
    }
    return { ok: true }
  } catch (e) {
    console.error('[notifyAdmin] network error:', e?.message)
    return { ok: false, error: e?.message }
  }
}
