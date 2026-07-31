// Composes the "some of your quotes need a fix" nudge (migration 200).
//
// The job of this email is to make a repair possible away from a desk. It
// therefore SHOWS the quote text inline rather than only linking to it: the
// recipient is a clinician who needs to recognise their own garbled sentence
// to know whether it's worth opening the app at all. A bare "you have 3 items
// to review" link would make them navigate to find out if it matters.
//
// Table-based structure for email-client safety, same as
// approvalEscalationEmail.js. Blue Spruce accent, no fallback to the retired
// Move-Better orange.

const BRAND_PRIMARY = '#0C7580' // Blue Spruce — src/lib/brand.js is the JS-side source

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function momentsUrl(slug) {
  return `https://${slug}.withbernard.ai/moments`
}

// Long quotes get trimmed in the EMAIL only — the app always shows the whole
// thing. A three-line preview is enough to recognise which sentence this is.
const PREVIEW_CHARS = 240

function preview(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ')
  return t.length > PREVIEW_CHARS ? `${t.slice(0, PREVIEW_CHARS)}…` : t
}

/**
 * @param {{workspace: {slug: string, display_name?: string}, recipientName?: string|null,
 *          items: Array<{excerpt: string, note?: string|null, senderName?: string|null}>}} args
 */
export function buildSendBackNudge({ workspace, recipientName, items }) {
  const n = items.length
  const brand = workspace.display_name || 'Bernard'
  const url = momentsUrl(workspace.slug)
  const hi = recipientName ? `Hi ${recipientName},` : 'Hi,'

  const subject = n === 1
    ? 'One of your quotes needs a quick fix'
    : `${n} of your quotes need a quick fix`

  // Why it's worth 60 seconds, stated once and concretely: these are held out
  // of drafting, so an unfixed quote is content that silently isn't happening.
  const lede = n === 1
    ? 'A quote from one of your conversations came out garbled in the transcript. Only you know what you actually meant, so it needs your eyes.'
    : 'Some quotes from your conversations came out garbled in the transcript. Only you know what you actually meant, so they need your eyes.'

  const textLines = [
    hi,
    '',
    lede,
    '',
    // filter on `!== null`, NOT Boolean — the trailing '' is the blank line
    // between quotes, and Boolean would strip it and run them together.
    ...items.flatMap((it) => [
      `"${preview(it.excerpt)}"`,
      it.note ? `   ${it.senderName ? `${it.senderName}: ` : ''}${it.note}` : null,
      '',
    ].filter((line) => line !== null)),
    `Fix ${n === 1 ? 'it' : 'them'} here: ${url}`,
    '',
    `Until then ${n === 1 ? "it won't" : "they won't"} be used to write anything.`,
    '',
    `— ${brand}`,
  ]

  const rows = items.map((it) => `
    <tr><td style="padding:0 0 16px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
             style="border-left:3px solid ${BRAND_PRIMARY};background:#f6f8f8;">
        <tr><td style="padding:12px 14px;">
          <div style="font-size:15px;line-height:1.55;color:#0b111e;">
            &ldquo;${escapeHtml(preview(it.excerpt))}&rdquo;
          </div>
          ${it.note ? `<div style="margin-top:8px;font-size:13px;line-height:1.5;color:#5b6470;">
            ${it.senderName ? `<strong>${escapeHtml(it.senderName)}:</strong> ` : ''}${escapeHtml(it.note)}
          </div>` : ''}
        </td></tr>
      </table>
    </td></tr>`).join('')

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
       style="max-width:560px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0b111e;">
  <tr><td style="padding-bottom:6px;font-size:18px;font-weight:700;">${escapeHtml(subject)}</td></tr>
  <tr><td style="padding-bottom:16px;font-size:15px;line-height:1.55;color:#3c4652;">
    ${escapeHtml(hi)}<br>${escapeHtml(lede)}
  </td></tr>
  ${rows}
  <tr><td style="padding:4px 0 20px 0;">
    <a href="${escapeHtml(url)}"
       style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;
              font-size:15px;font-weight:600;padding:11px 20px;border-radius:8px;">
      Fix ${n === 1 ? 'it' : 'them'} in ${escapeHtml(brand)}
    </a>
  </td></tr>
  <tr><td style="font-size:13px;line-height:1.5;color:#5b6470;">
    Until then ${n === 1 ? "it won't" : "they won't"} be used to write anything.
  </td></tr>
</table>
</td></tr></table>
</body></html>`

  return { subject, html, text: textLines.join('\n') }
}
