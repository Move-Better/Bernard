// GET /api/cron/visitor-question-digest
//
// Mondays: tell each workspace's owner how many new visitor questions arrived in
// the last 7 days, with a link to Topics. A visitor question is a topic_backlog
// row filed by a website's chat through webhooks/topic-signal (source
// 'vigil_signal'), still pending. Count only: the questions stay in Bernard,
// because a visitor's words can carry health details (Q, 2026-11-16).
//
// Silent when nothing new arrived. No agent_actions row: the email is the whole
// signal, and the rows themselves are the record.
//
// Auth: Bearer CRON_SECRET. Schedule: vercel.json ("0 16 * * 1", Monday 9am
// Pacific in winter). Always 200 with a summary so a transient failure does not
// mark the deployment unhealthy.

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { verifyCronSecret } from '../../_lib/auth.js'
import { sendEmail } from '../../_lib/notifyAdmin.js'
import { alertRecipientEmails } from '../../_lib/workspaceOwner.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// eslint-disable-next-line bernard/require-workspace-scope -- Cron iterates all workspaces; every row read carries its workspace_id and each email goes to that workspace's owner only
function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Count rows per workspace. Pure. */
export function countByWorkspace(rows) {
  const counts = new Map()
  for (const r of rows || []) {
    if (!r?.workspace_id) continue
    counts.set(r.workspace_id, (counts.get(r.workspace_id) || 0) + 1)
  }
  return counts
}

/** The email for one workspace. Pure. Carries a count and a link, never a question's text. */
export function visitorQuestionEmail({ wsName, count, topicsUrl }) {
  const one = count === 1
  const subject = `${count} new visitor question${one ? '' : 's'} — ${wsName}`
  const lead = `${count} ${one ? 'visitor' : 'visitors'} asked a question on your website this week that you don't have a published answer for yet.`
  const next = `${one ? 'It’s' : 'They’re'} waiting in Topics, where you can start an interview from ${one ? 'it' : 'one'} or archive it.`
  const footer = `The questions themselves stay in Bernard, so a visitor's words never travel by email. You're getting this because you own the ${wsName} workspace.`
  const text = [lead, '', next, '', `Open Topics: ${topicsUrl}`, '', footer].join('\n')
  const html = `<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#0b1220">
  <p>${escapeHtml(lead)}</p>
  <p>${escapeHtml(next)}</p>
  <p><a href="${escapeHtml(topicsUrl)}" style="display:inline-block;padding:9px 16px;border-radius:8px;background:#0c727e;color:#ffffff;text-decoration:none;font-weight:500">Open Topics</a></p>
  <p style="color:#64748b;font-size:12px">${escapeHtml(footer)}</p>
</div>`
  return { subject, text, html }
}

/**
 * One run. `deps` is for tests: { now, listQuestions, listWorkspaces, recipients, send }.
 */
export async function runVisitorQuestionDigest(deps = {}) {
  const summary = { questions: 0, workspacesEmailed: 0, errors: 0 }
  const since = new Date((deps.now || new Date()).getTime() - WINDOW_MS).toISOString()
  const rows = await (deps.listQuestions || listQuestions)(since)
  const counts = countByWorkspace(rows)
  summary.questions = rows.length
  if (!counts.size) return summary

  const workspaces = await (deps.listWorkspaces || listWorkspaces)([...counts.keys()])
  for (const ws of workspaces) {
    const count = counts.get(ws.id)
    if (!count) continue
    try {
      const to = await (deps.recipients || ((w) => alertRecipientEmails(w, { logTag: '[visitor-question-digest]' })))(ws)
      if (!to.length) continue
      const wsName = ws.display_name || 'your workspace'
      const topicsUrl = `https://${ws.slug}.withbernard.ai/topics`
      await (deps.send || sendEmail)({ to, ...visitorQuestionEmail({ wsName, count, topicsUrl }) })
      summary.workspacesEmailed++
    } catch (e) {
      summary.errors++
      console.error('[visitor-question-digest] workspace', ws.id, e?.message)
    }
  }
  return summary
}

async function listQuestions(since) {
  const r = await sb(`topic_backlog?source=eq.vigil_signal&status=eq.pending&created_at=gte.${encodeURIComponent(since)}&select=workspace_id&limit=5000`)
  if (!r.ok) throw new Error(`topic_backlog ${r.status}`)
  return (await r.json().catch(() => [])) || []
}

async function listWorkspaces(ids) {
  const r = await sb(`workspaces?status=eq.active&id=in.(${ids.join(',')})&select=id,slug,display_name,clerk_org_id,created_by_clerk_user_id`)
  if (!r.ok) throw new Error(`workspaces ${r.status}`)
  return (await r.json().catch(() => [])) || []
}

export default async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase env not configured' })
  try {
    return res.status(200).json(await runVisitorQuestionDigest())
  } catch (e) {
    console.error('[visitor-question-digest] failed:', e?.message)
    return res.status(200).json({ error: 'digest_failed' })
  }
}
