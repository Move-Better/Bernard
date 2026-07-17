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
import { clampToCap, platformCap } from '../../_lib/socialLengthTargets.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const ws   = await workspaceContext(req)
  if (!ws) return res.status(401).json({ error: 'Workspace not found' })
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  const {
    title, body, eventAt, location, ctaUrl, ctaLabel,
    mediaUrl, mediaType, selectedOutputs, mode, gbpLocationIds,
  } = req.body || {}

  // Optional GBP location narrowing (the New Post location picker) — an
  // explicit subset of workspace_locations.id this post should target.
  // Omitted/empty means "every connected location" (existing default).
  if (gbpLocationIds !== undefined) {
    if (!Array.isArray(gbpLocationIds) || !gbpLocationIds.every((lid) => UUID_RE.test(String(lid)))) {
      return err(res, 'Invalid gbpLocationIds')
    }
  }

  // Manual-first "Post": as-written publishes the user's exact text verbatim to
  // every selected channel (no LLM). 'adapt' runs the per-channel voice
  // generation. Absent mode defaults to adapt (back-compat).
  const asWritten = mode === 'as_written'

  if (!body || !body.trim()) return err(res, 'body is required')
  if (!Array.isArray(selectedOutputs) || selectedOutputs.length === 0) {
    return err(res, 'At least one output channel is required')
  }
  // Title is an optional internal label; derive one from the body when blank
  // (briefs.title is NOT NULL).
  const briefTitle = (title && title.trim())
    || body.trim().split('\n')[0].slice(0, 80).trim()
    || 'Post'

  // 1. Create the brief row first so content_items can reference it.
  const briefRow = {
    workspace_id:     ws.id,
    title:            briefTitle,
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
  const isVideo = mediaType === 'video'
  const mediaEntry = mediaUrl
    ? [{ url: mediaUrl, type: isVideo ? 'video' : 'photo', kind: isVideo ? 'video' : 'image' }]
    : []

  const results = await Promise.allSettled(
    selectedOutputs.map(async (outputId) => {
      const platform = toPlatformKey(outputId)

      // Resolve the caption text: verbatim in as-written mode, else per-channel
      // voice generation.
      let contentText
      if (asWritten) {
        contentText = body.trim()
      } else {
        const prompts = getBriefChannelPrompt(brief_, platform, ws)
        if (!prompts) return null // unsupported platform — skip silently
        const { text } = await generateText({
          model:    'anthropic/claude-haiku-4-5-20251001',
          instructions:   prompts.instructions,
          messages: [{ role: 'user', content: prompts.user }],
          maxOutputTokens: 600,
        })
        // Hard guardrail: the length prompt is a SOFT instruction Haiku routinely
        // overshoots, so clamp to the platform's character ceiling (sentence-aware)
        // before storing — otherwise an over-cap Twitter (280) / Bluesky (300) /
        // Threads (500) caption is rejected by bundle.social at publish time
        // (opaque bundle_post_failed) or blind-truncated. Mirrors the atom pipeline
        // (draftAtom.js). platformCap is null for uncapped platforms (facebook /
        // instagram_story), so clampToCap is a no-op there and the story branch
        // below still parses the full model output.
        contentText = clampToCap(text.trim(), platformCap(platform))
      }

      // Build the content_item row for this channel.
      const row = {
        workspace_id: ws.id,
        brief_id:     brief.id,
        interview_id: null,
        staff_id:     null,
        topic:        briefTitle,
        platform,
        content:      contentText,
        status:       'draft',
        media_urls:   mediaEntry,
      }

      if (platform === 'gbp' && Array.isArray(gbpLocationIds) && gbpLocationIds.length > 0) {
        row.target_locations = gbpLocationIds
      }

      // Instagram Story: overlay text + a pre-populated text_card when no media.
      if (platform === 'instagram_story') {
        if (asWritten) {
          row.overlay_text = contentText
          if (!mediaUrl) {
            row.text_card = buildStoryTextCard(brief_, contentText, brief_.cta_label || 'Learn more')
          }
        } else {
          const { overlayText, linkStickerText } = parseStoryOutput(contentText)
          row.content = overlayText
          row.overlay_text = overlayText
          if (!mediaUrl) {
            row.text_card = buildStoryTextCard(brief_, overlayText, linkStickerText)
          }
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
    await sb(`briefs?id=eq.${brief.id}&workspace_id=eq.${ws.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) })
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
  await sb(`briefs?id=eq.${brief.id}&workspace_id=eq.${ws.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) })

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
