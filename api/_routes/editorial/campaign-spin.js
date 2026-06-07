import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// POST /api/editorial/campaign-spin
//
// Phase 7 outcome loop: asks the AI to recommend which content angles and
// platforms to prioritize given the campaign goal, recent engagement data, and
// pending atoms. Result is written back to campaigns.ai_tune_state so the
// Storyboard editor and CampaignsSettings can surface it.
//
// Idempotent: calling twice on the same campaign just overwrites ai_tune_state.

import { generateText } from 'ai'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'

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

// Score a snapshot by source — mirrors top-performers.js.
function scoreSnapshot(snap) {
  if (snap.source === 'ga4') {
    return snap.stats?.pageviews ?? 0
  }
  const stats = snap.stats?.statistics ?? {}
  return stats.reach ?? 0
}

async function loadTopPerformers(workspaceId) {
  const r = await sb(
    `engagement_snapshots?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&order=fetched_at.desc&limit=150` +
    `&select=content_item_id,source,stats,fetched_at,content_items(id,topic,platform,status)`,
  )
  if (!r.ok) return []
  const rows = await r.json().catch(() => [])
  if (!Array.isArray(rows)) return []

  const seen = new Set()
  const candidates = []
  for (const row of rows) {
    if (seen.has(row.content_item_id)) continue
    seen.add(row.content_item_id)
    const ci = row.content_items
    if (!ci || ci.status !== 'published') continue
    const score = scoreSnapshot(row)
    if (score <= 0) continue
    candidates.push({
      topic:    ci.topic || 'Untitled',
      platform: ci.platform,
      score,
    })
  }
  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, 5)
}

async function loadPendingAtoms(campaignId, workspaceId) {
  const r = await sb(
    `content_plan_atoms?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&status=in.(pending,draft)` +
    `&select=platform,angle_label,angle_description,status,interviews!inner(campaign_id,workspace_id)` +
    `&interviews.campaign_id=eq.${encodeURIComponent(campaignId)}` +
    `&interviews.workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&limit=20`,
  )
  if (!r.ok) return []
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) ? rows : []
}

async function loadCampaign(campaignId, workspaceId) {
  const r = await sb(
    `campaigns?id=eq.${encodeURIComponent(campaignId)}` +
    `&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&select=id,name,content_style,theme_notes,cta_pitch,cta_url,cta_label,event_at,target_staff_ids,ai_tune_state,ai_tuned_at` +
    `&limit=1`,
  )
  if (!r.ok) return null
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

/**
 * Core spin logic — extracts into a standalone async function so the cron
 * handler can call it directly without duplicating the prompt + DB write.
 *
 * @param {string} campaignId
 * @param {string} workspaceId
 * @returns {Promise<{ai_tune_state: object, ai_tuned_at: string, explanation: string}|null>}
 */
export async function runCampaignSpin(campaignId, workspaceId) {
  const [campaign, performers, atomRows] = await Promise.all([
    loadCampaign(campaignId, workspaceId),
    loadTopPerformers(workspaceId),
    loadPendingAtoms(campaignId, workspaceId),
  ])

  if (!campaign) return null

  // Days until event — drives urgency framing in the prompt.
  const daysUntilEvent = campaign.event_at
    ? Math.max(0, Math.round((new Date(campaign.event_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null

  const systemPrompt = [
    'You are a campaign content strategist for a clinical health practice.',
    'Your job is to recommend which content angles and platforms to prioritize to hit the campaign goal.',
    'Never change the clinician\'s voice — only adjust the aim.',
    'Return ONLY a valid JSON object — no markdown, no explanation text outside the JSON.',
  ].join(' ')

  const topPerformerBlock = performers.length > 0
    ? performers.map((p) => `  - platform: ${p.platform}, topic: "${p.topic}", score: ${p.score}`).join('\n')
    : '  (no engagement data yet)'

  const pendingAtomBlock = atomRows.length > 0
    ? atomRows.map((a) => `  - platform: ${a.platform}, angle: "${a.angle_label}"${a.angle_description ? `, description: "${a.angle_description.slice(0, 120)}"` : ''}`).join('\n')
    : '  (no pending atoms)'

  const userMessage = [
    `Campaign: ${campaign.name}`,
    `Content style: ${campaign.content_style || 'clinical'}`,
    campaign.theme_notes ? `Theme: ${campaign.theme_notes}` : null,
    daysUntilEvent !== null ? `Days until event: ${daysUntilEvent}` : 'No specific event date.',
    '',
    'Top performing content (what is working):',
    topPerformerBlock,
    '',
    'Pending atoms (what has not been produced yet for this campaign):',
    pendingAtomBlock,
    '',
    'Given this campaign and what\'s working, recommend:',
    '(1) which 1-2 pending angles to prioritize',
    '(2) which platform is getting the best engagement',
    '(3) one specific CTA or timing adjustment',
    '',
    'Return JSON with this exact shape:',
    '{"priority_angles": ["angle label 1", "angle label 2"], "priority_platform": "platform name", "timing_note": "one sentence", "explanation": "2-3 sentences for the editor"}',
  ].filter((l) => l !== null).join('\n')

  let tuneState = null
  try {
    const { text } = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxOutputTokens: 400,
    })
    // Strip any accidental markdown fences before parsing.
    const cleaned = text.trim().replace(/^```(?:json)?|```$/gm, '').trim()
    tuneState = JSON.parse(cleaned)
  } catch (e) {
    console.error('[campaign-spin] AI parse failed:', e?.message)
    // Graceful fallback so the PATCH still records something.
    tuneState = {
      priority_angles:   [],
      priority_platform: null,
      timing_note:       null,
      explanation:       'AI recommendation unavailable — could not parse response.',
      _error:            e?.message || 'parse error',
    }
  }

  // Write ai_tune_state back to the campaigns row.
  const patchR = await sb(
    `campaigns?id=eq.${encodeURIComponent(campaignId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ ai_tune_state: tuneState, ai_tuned_at: new Date().toISOString() }),
    },
  )
  if (!patchR.ok) {
    const body = await patchR.text().catch(() => '')
    console.error('[campaign-spin] PATCH failed:', patchR.status, body)
  }

  const aiTunedAt = new Date().toISOString()
  return {
    campaign_id:  campaignId,
    ai_tune_state: tuneState,
    ai_tuned_at:  aiTunedAt,
    explanation:  tuneState?.explanation ?? '',
  }
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'no-token' ? 401 : 403
    return res.status(status).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'campaign-spin'))) return

  const { campaign_id } = req.body || {}
  if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' })

  const result = await runCampaignSpin(campaign_id, ws.id)
  if (!result) return res.status(404).json({ error: 'Campaign not found' })

  return res.status(200).json(result)
}

export default withSentry(handler)
