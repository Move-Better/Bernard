// POST /api/briefs/generate
// Takes a brief (title, body, optional structured fields, selected channels)
// and generates channel-adapted content_items for each selected output.
// Brief-sourced pieces have brief_id set and interview_id/staff_id null.
export const config = { runtime: 'nodejs', maxDuration: 120 }

import { generateText } from 'ai'
import { withSentry } from '../../_lib/sentry.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { getBriefChannelPrompt, parseStoryOutput, buildStoryTextCard } from '../../_lib/briefPrompts.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

// Normalize enabled_outputs channel ids to the atom-platform content_items.platform
// key. instagram_post and instagram_reel both write platform:'instagram'.
// instagram_story stays 'instagram_story' (its own atom platform).
function toPlatformKey(outputId) {
  if (outputId === 'instagram_post' || outputId === 'instagram_reel') return 'instagram'
  return outputId
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await enforceLimit(req, res, 'media'))) return

  const ws   = await workspaceContext(req)
  if (!ws) return res.status(401).json({ error: 'Workspace not found' })
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const {
    title, body, eventAt, location, ctaUrl, ctaLabel,
    mediaUrl, selectedOutputs,
  } = req.body || {}

  if (!title || !body) return err(res, 'title and body are required')
  if (!Array.isArray(selectedOutputs) || selectedOutputs.length === 0) {
    return err(res, 'At least one output channel is required')
  }

  // 1. Create the brief row first so content_items can reference it.
  const briefRow = {
    workspace_id:     ws.id,
    title,
    body,
    event_at:         eventAt   || null,
    location:         location  || null,
    cta_url:          ctaUrl    || null,
    cta_label:        ctaLabel  || null,
    media_url:        mediaUrl  || null,
    selected_outputs: selectedOutputs,
    status:           'generating',
  }
  const briefResp = await sb('briefs', { method: 'POST', body: JSON.stringify(briefRow) })
  if (!briefResp.ok) {
    const body_ = await briefResp.text()
    console.error('[briefs/generate] brief insert failed', briefResp.status, body_)
    return res.status(502).json({ error: 'Failed to create brief' })
  }
  const [brief] = await briefResp.json()

  // 2. Generate content for each selected output channel in parallel.
  const brief_ = { ...briefRow, id: brief.id }
  const mediaEntry = mediaUrl ? [{ url: mediaUrl, type: 'photo', kind: 'image' }] : []

  const results = await Promise.allSettled(
    selectedOutputs.map(async (outputId) => {
      const platform = toPlatformKey(outputId)
      const prompts  = getBriefChannelPrompt(brief_, platform, ws)
      if (!prompts) return null // unsupported platform — skip silently

      const { text } = await generateText({
        model:    'anthropic/claude-haiku-4-5-20251001',
        system:   prompts.system,
        messages: [{ role: 'user', content: prompts.user }],
        maxTokens: 600,
      })

      // Build the content_item row for this channel.
      const row = {
        workspace_id: ws.id,
        brief_id:     brief.id,
        interview_id: null,
        staff_id:     null,
        topic:        title,
        platform,
        content:      text.trim(),
        status:       'draft',
        media_urls:   mediaEntry,
      }

      // Instagram Story: parse overlay text + pre-populate text_card when no media.
      if (platform === 'instagram_story') {
        const { overlayText, linkStickerText } = parseStoryOutput(text)
        row.content = overlayText
        row.overlay_text = overlayText
        if (!mediaUrl) {
          row.text_card = buildStoryTextCard(brief_, overlayText, linkStickerText)
        }
      }

      return row
    })
  )

  // 3. Collect successful rows and bulk-insert them.
  const rows = results
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value)

  if (rows.length === 0) {
    // Mark brief failed and surface the error.
    await sb(`briefs?id=eq.${brief.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) })
    return res.status(502).json({ error: 'Content generation failed for all channels' })
  }

  const insertResp = await sb('content_items', {
    method: 'POST',
    body:   JSON.stringify(rows),
  })
  if (!insertResp.ok) {
    console.error('[briefs/generate] content_items insert failed', insertResp.status, await insertResp.text())
    return res.status(502).json({ error: 'Failed to save generated content' })
  }
  const contentItems = await insertResp.json()

  // 4. Mark the brief done.
  await sb(`briefs?id=eq.${brief.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) })

  // Log any skipped channels.
  const skipped = results
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message || 'unknown error')
  if (skipped.length) {
    console.warn('[briefs/generate] some channels failed:', skipped)
  }

  return res.status(201).json({
    brief,
    contentItems,
    skippedCount: skipped.length,
  })
}

export default withSentry(handler)
