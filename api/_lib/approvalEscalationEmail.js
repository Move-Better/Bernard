// Composes the Standing Producer's overdue-approval nudge.
//
// The job of this email is ONE thing: turn "a slot was missed" into a tap. Every
// row is a link straight to that piece's own review screen (/publish/:pieceId),
// never a generic /week link — the whole premise (.claude/decisions.md
// 2026-07-28) is that review itself is fast (0.6h median) and the cost being
// paid is navigation + noticing.
//
// Mirrors engagementDigestEmail.js's table-based structure for email-client
// safety. It does NOT copy that file's accent fallback: that one still falls
// back to the retired Move-Better orange (#e36525), which the
// bernard/no-hardcoded-brand-color rule bans in src (api/_lib is outside the
// rule's scope, which is why it survived). Blue Spruce is the current brand.

import { PLATFORM_LABELS } from './notifyPublishFailure.js'

const BRAND_PRIMARY = '#0C7580' // Blue Spruce — src/lib/brand.js is the JS-side source
const DEFAULT_TZ = 'America/Los_Angeles'

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** "Mon 27 Jul, 12:00 PM" in the workspace's own timezone. */
function fmtSlot(iso, timezone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit', timeZone: timezone || DEFAULT_TZ,
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toISOString().slice(0, 16).replace('T', ' ')
  }
}

/** How overdue, in words a human reads without doing arithmetic. */
export function overdueLabel(daysPast) {
  if (daysPast < 1) {
    const hours = Math.floor(daysPast * 24)
    if (hours < 1) return 'due now'
    return `${hours}h ago`
  }
  const d = Math.floor(daysPast)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

function platformLabel(platform) {
  return PLATFORM_LABELS[platform] || platform || 'Post'
}

/** Days-silent as a whole number a human reads without doing arithmetic. */
function silentDays(daysSilent) {
  return Math.max(1, Math.floor(daysSilent))
}

/**
 * @param {{
 *   workspace: { slug: string, display_name?: string, name?: string,
 *                colors?: { primary?: string }, cadence_policy?: { timezone?: string } },
 *   items: Array<{ pieceId, platform, topic, scheduledAt, daysPast }>,
 *   totalCount?: number,   // full count when `items` was truncated for display
 *   silentChannels?: Array<{ platform, daysSilent, readyCount, target }>,
 *     // a channel that has gone dark (api/_lib/producer/publishSilence.js) —
 *     // a DIFFERENT signal from `items`: those are individual pieces whose
 *     // planned slot passed; this is a channel where nothing has published
 *     // at all, which also catches a channel that fell out of planning
 *     // entirely (no atom, so it can never appear in `items`).
 * }} input
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildEscalation({ workspace, items, totalCount, silentChannels = [] }) {
  const wsName = workspace.display_name || workspace.name || 'your workspace'
  const accent = workspace.colors?.primary || BRAND_PRIMARY
  const tz = workspace.cadence_policy?.timezone || DEFAULT_TZ
  const baseUrl = `https://${workspace.slug}.withbernard.ai`
  const weekUrl = `${baseUrl}/week`
  const n = totalCount ?? items.length
  const hasItems = items.length > 0
  const noun = n === 1 ? 'post is' : 'posts are'

  // A silence-only send (no overdue items at all — the channel fell out of
  // planning entirely, so there's nothing for the per-item list to show) gets
  // its own subject line rather than a nonsensical "0 posts waiting".
  const subject = hasItems
    ? `${n} ${n === 1 ? 'post' : 'posts'} waiting on you — ${wsName}`
    : silentChannels.length === 1
      ? `${platformLabel(silentChannels[0].platform)} has gone quiet — ${wsName}`
      : `${silentChannels.length} channels have gone quiet — ${wsName}`
  const hidden = Math.max(0, n - items.length)

  const rows = items.map((it) => {
    const url = `${baseUrl}/publish/${it.pieceId}`
    const topic = it.topic || 'Untitled post'
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eeece7;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="vertical-align:middle;">
                <div style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${accent};">
                  ${escapeHtml(platformLabel(it.platform))}
                </div>
                <div style="font-size:14px;font-weight:600;color:#18181b;margin-top:2px;line-height:1.35;">
                  ${escapeHtml(topic)}
                </div>
                <div style="font-size:12px;color:#71717a;margin-top:3px;">
                  Slot was ${escapeHtml(fmtSlot(it.scheduledAt, tz))} &middot; ${escapeHtml(overdueLabel(it.daysPast))}
                </div>
              </td>
              <td style="vertical-align:middle;text-align:right;padding-left:12px;white-space:nowrap;">
                <a href="${escapeHtml(url)}"
                   style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:700;padding:8px 16px;border-radius:7px;font-size:13px;">
                  Review &rarr;
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
  }).join('')

  // A silence-only send has no `rows` and no coherent "past its slot" framing
  // (there's no slot at all for a channel that fell out of planning), so the
  // header collapses to a single silent channel's own headline rather than a
  // generic "0 posts" sentence.
  const headerEyebrow = hasItems ? 'Ready to go out' : 'Gone quiet'
  const headerTitle = hasItems
    ? `${n} ${escapeHtml(noun)} waiting on you`
    : silentChannels.length === 1
      ? `${escapeHtml(platformLabel(silentChannels[0].platform))} has gone quiet`
      : `${silentChannels.length} channels have gone quiet`
  const headerSub = hasItems
    ? `${escapeHtml(wsName)} &middot; written, voice-checked, and past ${n === 1 ? 'its' : 'their'} slot`
    : `${escapeHtml(wsName)} &middot; nothing has published in over a week, and finished work is waiting`

  const silentBlock = silentChannels.length
    ? `<tr><td style="padding:${hasItems ? '14px' : '6px'} 24px 0;">
        ${silentChannels.map((c) => `
        <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:12px 14px;margin-bottom:8px;">
          <div style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#c2410c;">Channel gone quiet</div>
          <div style="font-size:14px;font-weight:700;color:#18181b;margin-top:3px;">
            ${escapeHtml(platformLabel(c.platform))} has been quiet for ${silentDays(c.daysSilent)} day${silentDays(c.daysSilent) === 1 ? '' : 's'}
          </div>
          <div style="font-size:12px;color:#71717a;margin-top:2px;">
            ${c.readyCount} finished post${c.readyCount === 1 ? '' : 's'} waiting &middot; target ${c.target}/week
          </div>
        </div>`).join('')}
      </td></tr>`
    : ''

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f1;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f1;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e5e0;">

        <tr><td style="background:${accent};color:#ffffff;padding:22px 24px;">
          <div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">${headerEyebrow}</div>
          <h1 style="margin:4px 0 0;font-size:22px;font-weight:800;letter-spacing:-0.01em;">${headerTitle}</h1>
          <div style="font-size:13px;opacity:.9;margin-top:6px;">
            ${headerSub}
          </div>
        </td></tr>

        ${silentBlock}

        ${hasItems ? `
        <tr><td style="padding:6px 24px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${rows}
          </table>
        </td></tr>` : ''}

        ${hidden > 0 ? `
        <tr><td style="padding:12px 24px 0;font-size:13px;color:#71717a;">
          &hellip; and ${hidden} more waiting.
        </td></tr>` : ''}

        <tr><td style="padding:18px 24px 26px;text-align:center;">
          <a href="${escapeHtml(weekUrl)}"
             style="display:inline-block;background:#ffffff;color:${accent};border:1.5px solid ${accent};text-decoration:none;font-weight:700;padding:10px 20px;border-radius:8px;font-size:14px;">
            See the whole week &rarr;
          </a>
        </td></tr>

        <tr><td style="padding:14px 24px 18px;border-top:1px solid #e7e5e0;font-size:11px;color:#71717a;line-height:1.5;">
          Bernard sends this at most once a day, and only when something ${hasItems ? 'is actually past its slot' : 'has actually gone quiet'}.
          To stop it, turn off &ldquo;Email me when something needs me&rdquo; on the
          <a href="${escapeHtml(baseUrl)}/producer" style="color:${accent};">Bernard page</a>.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    hasItems ? `${n} ${noun} waiting on you — ${wsName}` : `${headerTitle.replace(/&middot;/g, '·')} — ${wsName}`,
    hasItems ? `Written, voice-checked, and past ${n === 1 ? 'its' : 'their'} slot.` : `Nothing has published in over a week, and finished work is waiting.`,
    ``,
    ...silentChannels.map((c) =>
      `⚠ ${platformLabel(c.platform)} has been quiet for ${silentDays(c.daysSilent)} day${silentDays(c.daysSilent) === 1 ? '' : 's'} — ` +
      `${c.readyCount} finished post${c.readyCount === 1 ? '' : 's'} waiting (target ${c.target}/week)`
    ),
    ...(silentChannels.length ? [``] : []),
    ...items.map((it) =>
      `• ${platformLabel(it.platform)} — ${it.topic || 'Untitled post'}\n` +
      `  Slot was ${fmtSlot(it.scheduledAt, tz)} (${overdueLabel(it.daysPast)})\n` +
      `  Review: ${baseUrl}/publish/${it.pieceId}`
    ),
    ...(hidden > 0 ? [``, `... and ${hidden} more waiting.`] : []),
    ``,
    `See the whole week: ${weekUrl}`,
    ``,
    `Bernard sends this at most once a day, and only when something ${hasItems ? 'is past its slot' : 'has actually gone quiet'}.`,
    `To stop it, turn off "Email me when something needs me" at ${baseUrl}/producer`,
  ].join('\n')

  return { subject, html, text }
}
