// POST /api/voice-preview
//
// Generates a single sample Bernard opener from the workspace's voice settings
// (brand_voice + clinic_context + audience + tone modifiers + topic suggestions).
// Used by the Voice Settings "Try a live preview" CTA — admin-only, not persisted.
// Accepts an optional `draft` object so the preview can reflect the caller's
// in-progress (unsaved) edits instead of the saved workspace values.
export const config = { runtime: 'nodejs', maxDuration: 30 }

import { generateText } from 'ai'
import { workspaceContext } from './_lib/workspaceContext.js'
import { requireRole } from './_lib/auth.js'
import { enforceLimit } from './_lib/ratelimit.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'forbidden' ? 403 : 401
    return res.status(status).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  const interviewerName = ws.interviewer_name || 'Bernard'
  const clinicName = ws.display_name || 'your clinic'

  // Prefer the caller's in-progress (unsaved) edits when supplied, so the sample
  // opener matches the settings shown on-screen rather than what's saved. Only
  // the fields the Voice page owns are overridable; name + topics still come from
  // the saved workspace. Draft values are bounded strings (empty string = an
  // intentionally-cleared field, which previews as cleared).
  const draft = (req.body && typeof req.body.draft === 'object' && req.body.draft) || {}
  const draftStr = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : undefined)
  const brandVoice    = draftStr(draft.brand_voice)    ?? ws.brand_voice
  const clinicContext = draftStr(draft.clinic_context) ?? ws.clinic_context
  const audienceShort = draftStr(draft.audience_short) ?? ws.audience_short
  const toneMods = (draft.tone_modifiers && typeof draft.tone_modifiers === 'object')
    ? draft.tone_modifiers
    : (ws.tone_modifiers || {})

  const toneLines = Object.entries(toneMods)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `- ${k}: ${String(v).slice(0, 500)}`)
    .join('\n')

  // Topic_suggestions can be a JSON array of objects with a `topic` field.
  const topics = Array.isArray(ws.topic_suggestions)
    ? ws.topic_suggestions.slice(0, 5).map(t => t?.topic || t?.label || '').filter(Boolean)
    : []

  const systemPrompt = [
    `You are ${interviewerName}, an interviewer for ${clinicName}.`,
    brandVoice ? `Brand voice:\n${brandVoice}` : '',
    clinicContext ? `Clinic context:\n${clinicContext}` : '',
    audienceShort ? `Audience: ${audienceShort}` : '',
    toneLines ? `Tone modifiers:\n${toneLines}` : '',
    topics.length ? `Common topics: ${topics.join(', ')}` : '',
    `Given this clinician's voice settings, write the FIRST SENTENCE you'd open an interview with for a returning patient. Return only the sentence, no quotes, no preamble. One sentence.`,
  ].filter(Boolean).join('\n\n')

  try {
    const { text } = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      instructions: systemPrompt,
      messages: [{ role: 'user', content: 'Generate the opener.' }],
      maxOutputTokens: 120,
    })
    const opener = (text || '').trim().replace(/^["']|["']$/g, '')
    if (!opener) return res.status(500).json({ error: 'Empty response' })
    return res.status(200).json({ opener })
  } catch (e) {
    console.error('[voice-preview]', e?.message || e)
    return res.status(500).json({ error: 'preview_failed' })
  }
}
