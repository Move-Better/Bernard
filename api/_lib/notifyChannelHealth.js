// Email a workspace owner when one of their connected social channels has gone
// dead, so a broken token surfaces on day zero instead of being discovered weeks
// later by noticing that nothing has posted.
//
// This is the alert that did not exist when Move Better's Facebook token was
// invalidated by Meta (190:460) around 2026-06-26: publishing simply stopped,
// no banner, no email, and the gap was only found during a later audit.
//
// Deliberately NOT deduplicated across runs. A disconnected channel is a
// standing alarm, not an event — it stays broken until someone reconnects it,
// and the cron only runs once a day. One reminder a day about a channel that is
// genuinely down is the correct volume; the previous behaviour was three weeks
// of silence. Per-incident dedup needs somewhere to record "already alerted",
// which is a schema change worth making only once there is a channel-health
// table to hang the rest of the UI off.

import { sendEmail } from './notifyAdmin.js'
import { recordAgentAction } from './agentActions.js'
import { alertRecipientEmails } from './workspaceOwner.js'

// bundle social-account type → the name a clinic would recognise.
const TYPE_LABELS = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  LINKEDIN: 'LinkedIn',
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  TWITTER: 'X',
  THREADS: 'Threads',
  BLUESKY: 'Bluesky',
  MASTODON: 'Mastodon',
  GOOGLE_BUSINESS: 'Google Business Profile',
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function channelLabel(account) {
  return TYPE_LABELS[account?.type] || account?.type || 'A channel'
}

// The words for the alert. A STALE channel (bundle still calls it connected,
// but its daily stats stopped — see statsStaleReason) gets softer copy than a
// disconnected one: we do not know publishing is broken, only that the
// platform stopped answering, which is how Facebook's silent 2026-10-21 failure
// looked. Any genuinely disconnected item in the list keeps the hard copy.
export function channelHealthCopy({ unhealthy, wsName }) {
  const names = [...new Set(unhealthy.map(channelLabel))]
  const joined = names.join(' and ')
  const plural = names.length > 1
  if (unhealthy.every((a) => a.stale)) {
    return {
      kind:    'channel_stale',
      title:   `${joined} stopped sending stats — reconnect suggested`,
      subject: `⚠️ ${joined} stopped responding — ${wsName}`,
      lead:    `${joined} ${plural ? 'are' : 'is'} still listed as connected, but Bernard has stopped receiving ${plural ? 'their' : 'its'} daily stats. That usually means the platform has withdrawn access, so posts there may fail. Reconnecting fixes it if so, and is harmless if not.`,
      footer:  'It repeats daily until stats arrive again.',
    }
  }
  return {
    kind:    'channel_disconnected',
    title:   `${joined} ${plural ? 'are' : 'is'} disconnected — nothing can publish there`,
    subject: `⚠️ ${joined} ${plural ? 'are' : 'is'} disconnected — ${wsName}`,
    lead:    `Bernard can't post to ${names.join(' or ')} right now. The connection needs to be re-authorized — until then, anything scheduled for ${plural ? 'those channels' : 'that channel'} will fail.`,
    footer:  'It repeats daily until the connection is restored.',
  }
}

/**
 * @param {{ workspace: { id: string, slug?: string, display_name?: string, created_by_clerk_user_id?: string, producer_config?: any }, unhealthy: Array<{type?: string, displayName?: string|null, status?: string|null}> }} args
 */
export async function notifyChannelHealth({ workspace, unhealthy }) {
  try {
    if (!workspace?.id || !Array.isArray(unhealthy) || unhealthy.length === 0) {
      return { ok: false, skipped: true }
    }

    // Dedupe for the subject line only — GBP disconnects one per LOCATION
    // (Portland, Vancouver, …), all sharing the same `type: GOOGLE_BUSINESS`,
    // so an unhealthy list with two broken locations would otherwise read
    // "Google Business Profile and Google Business Profile are disconnected".
    // The per-item `list` below still differentiates by displayName.
    const wsName = workspace.display_name || 'your workspace'
    const copy = channelHealthCopy({ unhealthy, wsName })
    const settingsLink = workspace.slug
      ? `https://${workspace.slug}.withbernard.ai/settings/integrations`
      : 'https://withbernard.ai/settings/integrations'

    // Workday ledger — record it even when no owner email resolves, so the
    // outage is visible in the feed and not only in an inbox.
    await recordAgentAction({
      workspaceId:    workspace.id,
      producerConfig: workspace.producer_config,
      kind:           copy.kind,
      title:          copy.title,
      detail:         { channels: unhealthy.map((a) => ({ type: a.type || null, reason: a.reason || null })) },
    })

    // Founder, or every active owner when the founder has been deactivated.
    const to = await alertRecipientEmails(workspace, { logTag: '[notifyChannelHealth]' })
    if (to.length === 0) {
      console.warn('[notifyChannelHealth] no owner email for workspace', workspace.id)
      return { ok: false, skipped: true }
    }

    const list = unhealthy.map((a) => {
      const label = channelLabel(a)
      const who = a.displayName ? ` (${a.displayName})` : ''
      const why = a.reason ? ` — ${a.reason}` : ''
      return `${label}${who}${why}`
    })

    const subject = copy.subject
    const text = [
      copy.lead,
      '',
      ...list.map((l) => `• ${l}`),
      '',
      `Reconnect: ${settingsLink}`,
      '',
      `You're getting this because you own the ${wsName} workspace. ${copy.footer}`,
    ].join('\n')
    const html = `<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#0b1220">
  <p>${escapeHtml(copy.lead)}</p>
  <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;background:#f8fafc;margin:12px 0">
    ${list.map((l) => `<p style="margin:0 0 4px;font-weight:600">${escapeHtml(l)}</p>`).join('')}
  </div>
  <p><a href="${escapeHtml(settingsLink)}" style="display:inline-block;background:#0C7580;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:600">Reconnect in Bernard</a></p>
  <p style="color:#94a3b8;font-size:12px">You’re getting this because you own the ${escapeHtml(wsName)} workspace. ${escapeHtml(copy.footer)}</p>
</div>`

    return await sendEmail({ to, subject, text, html })
  } catch (e) {
    console.error('[notifyChannelHealth] error:', e?.message)
    return { ok: false, error: e?.message }
  }
}
