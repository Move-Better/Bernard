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
import { ownerEmail } from './workspaceOwner.js'

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

/**
 * @param {{ workspace: { id: string, slug?: string, display_name?: string, created_by_clerk_user_id?: string, producer_config?: any }, unhealthy: Array<{type?: string, displayName?: string|null, status?: string|null}> }} args
 */
export async function notifyChannelHealth({ workspace, unhealthy }) {
  try {
    if (!workspace?.id || !Array.isArray(unhealthy) || unhealthy.length === 0) {
      return { ok: false, skipped: true }
    }

    const names = unhealthy.map(channelLabel)
    const wsName = workspace.display_name || 'your workspace'
    const settingsLink = workspace.slug
      ? `https://${workspace.slug}.withbernard.ai/settings/integrations`
      : 'https://withbernard.ai/settings/integrations'

    // Workday ledger — record it even when no owner email resolves, so the
    // outage is visible in the feed and not only in an inbox.
    await recordAgentAction({
      workspaceId:    workspace.id,
      producerConfig: workspace.producer_config,
      kind:           'channel_disconnected',
      title:          `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} disconnected — nothing can publish there`,
      detail:         { channels: unhealthy.map((a) => ({ type: a.type || null, reason: a.reason || null })) },
    })

    const to = await ownerEmail(workspace.created_by_clerk_user_id)
    if (!to) {
      console.warn('[notifyChannelHealth] no owner email for workspace', workspace.id)
      return { ok: false, skipped: true }
    }

    const list = unhealthy.map((a) => {
      const label = channelLabel(a)
      const who = a.displayName ? ` (${a.displayName})` : ''
      const why = a.reason ? ` — ${a.reason}` : ''
      return `${label}${who}${why}`
    })

    const subject = `⚠️ ${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} disconnected — ${wsName}`
    const text = [
      `Bernard can't post to ${names.join(' or ')} right now. The connection needs to be re-authorized — until then, anything scheduled for ${names.length > 1 ? 'those channels' : 'that channel'} will fail.`,
      '',
      ...list.map((l) => `• ${l}`),
      '',
      `Reconnect: ${settingsLink}`,
      '',
      `You're getting this because you own the ${wsName} workspace. It repeats daily until the connection is restored.`,
    ].join('\n')
    const html = `<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#0b1220">
  <p>Bernard can’t post to ${escapeHtml(names.join(' or '))} right now. The connection needs to be re-authorized — until then, anything scheduled for ${names.length > 1 ? 'those channels' : 'that channel'} will fail.</p>
  <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;background:#f8fafc;margin:12px 0">
    ${list.map((l) => `<p style="margin:0 0 4px;font-weight:600">${escapeHtml(l)}</p>`).join('')}
  </div>
  <p><a href="${escapeHtml(settingsLink)}" style="display:inline-block;background:#0C7580;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:600">Reconnect in Bernard</a></p>
  <p style="color:#94a3b8;font-size:12px">You’re getting this because you own the ${escapeHtml(wsName)} workspace. It repeats daily until the connection is restored.</p>
</div>`

    return await sendEmail({ to, subject, text, html })
  } catch (e) {
    console.error('[notifyChannelHealth] error:', e?.message)
    return { ok: false, error: e?.message }
  }
}
