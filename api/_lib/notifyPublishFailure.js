// Phase 4: email a workspace owner the moment one of their posts fails to
// publish. Shared by the bundle webhook (real-time) and the
// sync-buffer-published cron (hourly backstop) — both call this ONLY on a real
// transition into status='failed', so the owner gets exactly one alert per
// failure regardless of which path detects it first.
//
// Recipient resolution mirrors engagement-digest: workspaces.created_by_clerk_user_id
// → Clerk primary email. Always resolves; never throws — a failed alert must
// never break the publish-status write that triggered it (callers don't await).

import { createClerkClient } from '@clerk/backend'
import { sendEmail } from './notifyAdmin.js'
import { recordAgentAction } from './agentActions.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const CLERK_SECRET = process.env.CLERK_SECRET_KEY

let _clerk = null
function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: CLERK_SECRET })
  return _clerk
}

const PLATFORM_LABELS = {
  instagram: 'Instagram', instagram_story: 'Instagram Story', facebook: 'Facebook',
  linkedin: 'LinkedIn', gbp: 'Google Business Profile', tiktok: 'TikTok',
  youtube: 'YouTube', twitter: 'X', threads: 'Threads', bluesky: 'Bluesky',
  mastodon: 'Mastodon', blog: 'Blog',
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Background notifier: workspace_id is passed in by the caller and every query
// here is filtered by it. (The require-workspace-scope rule only runs on
// api/_routes/** handlers, not _lib helpers, so no disable directive is needed.)
function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
}

async function ownerEmail(clerkUserId) {
  if (!clerkUserId) return null
  try {
    const user = await clerk().users.getUser(clerkUserId)
    return (
      user.emailAddresses?.find((a) => a.id === user.primaryEmailAddressId)?.emailAddress
      || user.emailAddresses?.[0]?.emailAddress
      || null
    )
  } catch (e) {
    console.warn('[notifyPublishFailure] clerk lookup failed:', e?.message)
    return null
  }
}

/**
 * @param {{ workspaceId: string, item: { id: string, platform?: string, topic?: string, content?: string }, reason?: string }} args
 */
export async function notifyPublishFailure({ workspaceId, item, reason }) {
  try {
    if (!workspaceId || !item?.id) return { ok: false, skipped: true }

    const wsRes = await sb(
      `workspaces?id=eq.${workspaceId}&select=slug,display_name,created_by_clerk_user_id,producer_config&limit=1`
    )
    const ws = wsRes.ok ? (await wsRes.json().catch(() => []))[0] : null

    // Workday ledger (Standing Producer Phase 0) — record the failure once per
    // transition (this notifier is the single choke point both the webhook and
    // the sync cron call). Recorded independent of the owner-email path so a
    // failure still lands in the feed even when no owner email resolves. Gated
    // on producer_config.enabled inside the helper.
    const platformLabel = PLATFORM_LABELS[item.platform] || item.platform || 'A post'
    const ledgerTitleRaw = (item.topic || '').trim()
    await recordAgentAction({
      workspaceId,
      producerConfig: ws?.producer_config,
      kind:           'publish_failed',
      title:          `${platformLabel} post failed to publish${ledgerTitleRaw ? `: "${ledgerTitleRaw.slice(0, 80)}"` : ''}`,
      detail:         { platform: item.platform || null, reason: (reason || '').slice(0, 500) },
      contentItemId:  item.id,
    })

    const to = await ownerEmail(ws?.created_by_clerk_user_id)
    if (!to) {
      console.warn('[notifyPublishFailure] no owner email for workspace', workspaceId)
      return { ok: false, skipped: true }
    }

    const platform = PLATFORM_LABELS[item.platform] || item.platform || 'A post'
    const titleRaw = (item.topic || (typeof item.content === 'string' ? item.content : '') || '').trim()
    const title = !titleRaw ? 'Untitled post' : titleRaw.length > 90 ? `${titleRaw.slice(0, 90)}…` : titleRaw
    const wsName = ws?.display_name || 'your workspace'
    const link = ws?.slug ? `https://${ws.slug}.withbernard.ai/publish/${item.id}` : 'https://withbernard.ai'
    const safeReason = (reason || 'Publishing failed on the network.').slice(0, 500)

    const subject = `⚠️ A post failed to publish — ${wsName}`
    const text = [
      'One of your scheduled posts didn’t go out.',
      '',
      `${platform}: "${title}"`,
      `Reason: ${safeReason}`,
      '',
      `Review & retry: ${link}`,
      '',
      `You’re getting this because you own the ${wsName} workspace.`,
    ].join('\n')
    const html = `<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#0b1220">
  <p>One of your scheduled posts didn’t go out.</p>
  <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;background:#f8fafc;margin:12px 0">
    <p style="margin:0 0 4px;font-weight:600">${escapeHtml(platform)}: “${escapeHtml(title)}”</p>
    <p style="margin:0;color:#475569"><strong>Reason:</strong> ${escapeHtml(safeReason)}</p>
  </div>
  <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0C7580;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:600">Review &amp; retry in Bernard</a></p>
  <p style="color:#94a3b8;font-size:12px">You’re getting this because you own the ${escapeHtml(wsName)} workspace.</p>
</div>`

    return await sendEmail({ to, subject, text, html })
  } catch (e) {
    console.error('[notifyPublishFailure] error:', e?.message)
    return { ok: false, error: e?.message }
  }
}
