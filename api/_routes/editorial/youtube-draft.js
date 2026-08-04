// POST /api/editorial/youtube-draft
//
// Draft a YouTube title + description (with chapters) for a finished landscape
// video in the Library, so the "publish it whole" dialog opens pre-filled rather
// than blank. Read-only: persists nothing.
//
// Body: { assetId }
// 200:  { title, description, chapterCount, hasTranscript }
// 400 / 401 / 403 / 404 / 500
//
// The grounding signal is media_assets.transcript_words, NOT .transcription —
// see api/_lib/youtubeCopy.js for the measurement behind that choice. When an
// asset has no usable word timings we still return a title/description built
// from the visual narrative, and flag hasTranscript:false so the dialog can say
// so instead of silently offering thin copy.

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { generateObject } from 'ai'
import { z } from 'zod'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { supabaseRest } from '../../_lib/supabaseRest.js'
import {
  isYouTubeEligible,
  planChapters,
  appendChapters,
  transcriptText,
  MIN_CHAPTERS,
} from '../../_lib/youtubeCopy.js'
import { YOUTUBE_TITLE_MAX, YOUTUBE_DESCRIPTION_MAX } from '../../_lib/social/bundlePublisher.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODEL = 'anthropic/claude-sonnet-4-6'

const sb = (path, init = {}) => supabaseRest(path, init, { contentType: 'application/json' })

// Permissive schema on purpose: per-item hard caps in a zod schema fail the
// WHOLE generateObject response when one field overruns, and we would rather
// clamp a long title in code than lose the entire draft. Length is enforced
// after the object comes back.
const schema = z.object({
  title: z.string(),
  description: z.string(),
  chapters: z.array(z.object({ index: z.number(), title: z.string() })).optional(),
})

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const assetId = req.body?.assetId ? String(req.body.assetId) : ''
  if (!assetId) return res.status(400).json({ error: 'assetId_required' })
  if (!UUID_RE.test(assetId)) return res.status(400).json({ error: 'invalid_assetId' })

  const aRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}` +
      `&select=id,kind,width,height,blob_url,archived_at,duration_s,filename,display_title,visual_narrative,transcript_words&limit=1`,
  )
  if (!aRes.ok) {
    console.error('[youtube-draft] asset lookup failed:', aRes.status)
    return res.status(500).json({ error: 'db_error' })
  }
  const asset = (await aRes.json())?.[0]
  if (!asset) return res.status(404).json({ error: 'asset_not_found' })
  if (!isYouTubeEligible(asset)) return res.status(400).json({ error: 'not_eligible' })

  const words = Array.isArray(asset.transcript_words) ? asset.transcript_words : []
  const spoken = transcriptText(words)
  const hasTranscript = spoken.length > 0
  const chapterPlan = planChapters(words)
  const label = asset.display_title || asset.filename || 'Full-length video'

  // Fall back to a usable draft rather than an error when the model is
  // unavailable — the user can always rewrite, and a blank dialog is worse.
  const fallback = {
    title: String(label).slice(0, YOUTUBE_TITLE_MAX),
    description: String(asset.visual_narrative || '').slice(0, YOUTUBE_DESCRIPTION_MAX),
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return res.status(200).json({ ...fallback, chapterCount: 0, hasTranscript })
  }

  const brandVoice = typeof ws.brand_voice === 'string' ? ws.brand_voice.trim() : ''

  const instructions = [
    `You write YouTube metadata for ${ws.display_name || 'a clinic'}.`,
    brandVoice ? `How this practice talks: ${brandVoice}` : '',
    '',
    'TITLE: at most 90 characters. Say what the viewer will actually see. No',
    'clickbait, no ALL CAPS, no emoji, no trailing brand name.',
    '',
    'DESCRIPTION: 2-4 short sentences of plain prose describing what happens in',
    'the video and who is in it. Ground every claim in the transcript — never',
    'invent a condition, outcome, timeline or credential that is not said aloud.',
    'Do not add hashtags. Do not add a call to action; one is appended separately.',
    '',
    chapterPlan.length >= MIN_CHAPTERS
      ? `CHAPTERS: you are given ${chapterPlan.length} numbered transcript segments. Return a title for EACH, in order, 2-5 words, describing what is discussed in that segment. Return exactly ${chapterPlan.length} chapter objects.`
      : 'CHAPTERS: omit the chapters field entirely for this video.',
  ].filter(Boolean).join('\n')

  const userParts = [
    `Video: ${label}`,
    asset.visual_narrative ? `What is on screen: ${asset.visual_narrative}` : '',
    hasTranscript ? `\nTranscript:\n${spoken.slice(0, 12000)}` : '\n(No transcript available for this video.)',
  ]
  if (chapterPlan.length >= MIN_CHAPTERS) {
    userParts.push(
      '\nSegments to title:',
      chapterPlan
        .map((c, i) => `[${i}] ${c.text.slice(0, 600)}`)
        .join('\n'),
    )
  }

  let object
  try {
    ({ object } = await generateObject({
      model: MODEL,
      schema,
      instructions,
      messages: [{ role: 'user', content: userParts.filter(Boolean).join('\n') }],
      maxOutputTokens: 2000,
    }))
  } catch (e) {
    console.error('[youtube-draft] generateObject failed:', e?.message)
    return res.status(200).json({ ...fallback, chapterCount: 0, hasTranscript })
  }

  const title = String(object?.title || fallback.title).trim().slice(0, YOUTUBE_TITLE_MAX)

  // Match returned chapter titles back onto the planned start times by index.
  // A short or mis-indexed list simply yields fewer chapters; appendChapters
  // drops the section entirely below the minimum YouTube honours.
  const titled = (object?.chapters || [])
    .map((c) => {
      const idx = Number(c?.index)
      const plan = Number.isInteger(idx) ? chapterPlan[idx] : null
      if (!plan || !c?.title) return null
      return { startSec: plan.startSec, title: String(c.title).trim() }
    })
    .filter(Boolean)
    .sort((a, b) => a.startSec - b.startSec)

  const description = appendChapters(
    String(object?.description || '').trim(),
    titled,
  ).slice(0, YOUTUBE_DESCRIPTION_MAX)

  return res.status(200).json({
    title,
    description,
    chapterCount: titled.length >= MIN_CHAPTERS ? titled.length : 0,
    hasTranscript,
  })
}
