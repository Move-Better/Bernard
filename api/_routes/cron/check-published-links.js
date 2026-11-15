// GET /api/cron/check-published-links
//
// Daily: load every published blog post's live address and tell the workspace's
// owners about any a visitor cannot open (a failed site build, a site that
// stopped deploying, a retired domain). Rules in api/_lib/publishedLinkCheck.js.
//
// Like check-channel-health this is a standing alarm, not an event: a broken
// post is reported every day until it loads again or is taken out of
// `published`. One retry per address inside the run keeps a momentary blip
// from alerting.
//
// Kill criterion (Q, 2026-11-15, .claude/decisions.md): if this raises nothing
// real by 2027-02-15, remove it.
//
// Auth: Bearer CRON_SECRET. Schedule: vercel.json ("0 15 * * *"). Always 200
// with a summary so a transient failure does not mark the deployment unhealthy.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { verifyCronSecret } from '../../_lib/auth.js'
import { checkPublishedUrl } from '../../_lib/publishedLinkCheck.js'
import { sendEmail } from '../../_lib/notifyAdmin.js'
import { recordAgentAction } from '../../_lib/agentActions.js'
import { alertRecipientEmails } from '../../_lib/workspaceOwner.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// eslint-disable-next-line bernard/require-workspace-scope -- Cron iterates all workspaces; every row read carries its workspace_id and alerts go to that workspace only
function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** The alert for one workspace's broken posts. Pure. */
export function brokenLinksEmail({ wsName, broken }) {
  const n = broken.length
  const subject = `⚠️ ${n} published post${n === 1 ? '' : 's'} can't be opened — ${wsName}`
  const lead = `Bernard published ${n === 1 ? 'this post' : 'these posts'}, but ${n === 1 ? 'its address does' : 'their addresses do'} not open for a visitor today. The site may have failed to build, stopped deploying, or the domain may be gone.`
  const lines = broken.map((b) => `${b.topic || 'Untitled'}: ${b.url} (${b.reason})`)
  const footer = `You're getting this because you own the ${wsName} workspace. It repeats daily until the posts open again.`
  const text = [lead, '', ...lines.map((l) => `• ${l}`), '', footer].join('\n')
  const html = `<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#0b1220">
  <p>${escapeHtml(lead)}</p>
  <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;background:#f8fafc;margin:12px 0">
    ${broken.map((b) => `<p style="margin:0 0 6px"><strong>${escapeHtml(b.topic || 'Untitled')}</strong><br><a href="${escapeHtml(b.url)}">${escapeHtml(b.url)}</a> (${escapeHtml(b.reason)})</p>`).join('')}
  </div>
  <p style="color:#94a3b8;font-size:12px">${escapeHtml(footer)}</p>
</div>`
  return { subject, text, html }
}

/**
 * One run. `deps` is for tests: { listPosts, listWorkspaces, check, record, recipients, send }.
 */
export async function runPublishedLinkCheck(deps = {}) {
  const summary = { checked: 0, broken: 0, workspacesAlerted: 0, errors: 0 }
  const posts = await (deps.listPosts || listPosts)()
  const brokenByWs = new Map()
  for (const p of posts) {
    summary.checked++
    const r = await (deps.check || checkPublishedUrl)(p.resolved_url)
    if (r.ok) continue
    summary.broken++
    if (!brokenByWs.has(p.workspace_id)) brokenByWs.set(p.workspace_id, [])
    brokenByWs.get(p.workspace_id).push({ id: p.id, topic: p.topic, url: p.resolved_url, reason: r.reason })
  }
  if (!brokenByWs.size) return summary

  const workspaces = await (deps.listWorkspaces || listWorkspaces)([...brokenByWs.keys()])
  for (const ws of workspaces) {
    const broken = brokenByWs.get(ws.id)
    if (!broken?.length) continue
    try {
      const wsName = ws.display_name || 'your workspace'
      await (deps.record || recordAgentAction)({
        workspaceId: ws.id,
        producerConfig: ws.producer_config,
        kind: 'published_link_broken',
        title: `${broken.length} published post${broken.length === 1 ? '' : 's'} can't be opened`,
        detail: { posts: broken.map((b) => ({ id: b.id, url: b.url, reason: b.reason })) },
      })
      const to = await (deps.recipients || ((w) => alertRecipientEmails(w, { logTag: '[check-published-links]' })))(ws)
      if (!to.length) continue
      await (deps.send || sendEmail)({ to, ...brokenLinksEmail({ wsName, broken }) })
      summary.workspacesAlerted++
    } catch (e) {
      summary.errors++
      console.error('[check-published-links] workspace', ws.id, e?.message)
    }
  }
  return summary
}

async function listPosts() {
  const r = await sb('content_items?platform=eq.blog&status=eq.published&resolved_url=not.is.null&select=id,workspace_id,topic,resolved_url&limit=5000')
  if (!r.ok) throw new Error(`content_items ${r.status}`)
  return (await r.json().catch(() => [])) || []
}

async function listWorkspaces(ids) {
  const r = await sb(`workspaces?status=eq.active&id=in.(${ids.join(',')})&select=id,slug,display_name,clerk_org_id,created_by_clerk_user_id,producer_config`)
  if (!r.ok) throw new Error(`workspaces ${r.status}`)
  return (await r.json().catch(() => [])) || []
}

export default async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase env not configured' })
  try {
    return res.status(200).json(await runPublishedLinkCheck())
  } catch (e) {
    console.error('[check-published-links] failed:', e?.message)
    return res.status(200).json({ error: 'check_failed' })
  }
}
