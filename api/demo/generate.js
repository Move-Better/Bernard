// POST /api/demo/generate
//
// PUBLIC, UNAUTHENTICATED demo endpoint. Accepts a short text answer (≤2000
// chars) from the /demo/try page and streams three content pieces — a blog
// post, an Instagram caption, and a GBP post — in the demo clinician's voice.
//
//   • NO workspaceContext / NO requireRole / NO Supabase.
//     Uses a frozen DEMO_WS config; structurally incapable of touching tenant data.
//   • Abuse protection: IP-keyed demo burst + demoDaily rate-limit buckets +
//     hard token cap + 2000-char body ceiling.
//   • Wire format: same SSE shape as api/stream.js so the client can reuse the
//     same event parser. Text sections are delimited by [BLOG]/[/BLOG] etc.
//     markers embedded in the streamed text.
//   • Runtime: Node (not Edge) — streamText requires the AI SDK's Node fetch;
//     Edge whole-graph bundler would follow ratelimit.js → @clerk/backend → node:crypto.
//
// Scope: .claude/scope-no-login-demo.md — Phase 1 (sample-first).

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

import { streamText } from 'ai'
import { enforceLimit } from '../_lib/ratelimit.js'

const MAX_TEXT_CHARS = 2000

const TOPIC_LABELS = {
  story: 'patient success story',
  faq: 'frequently asked clinical question',
  insight: 'patient education insight',
}

function buildSystemPrompt(topicId) {
  const topicLabel = TOPIC_LABELS[topicId] || 'clinical topic'

  return `You are Bernard, an AI content assistant for healthcare clinicians.

A clinician just shared their thoughts on a ${topicLabel}. Transform their words into THREE content pieces that genuinely sound like them — specific, human, and clinical.

VOICE RULES:
- Write in their first-person voice ("I", or "we" when referencing the clinic team)
- Be specific — use the actual details they gave you, not generic summaries
- Clinical accuracy without jargon overload
- Warm and conversational, not corporate
- Never fabricate patient details, names, or outcomes they didn't mention

OUTPUT FORMAT — emit each section with its exact markers on their own line, no blank line before the opening marker:
[BLOG]
A 180-200 word educational blog post in the clinician's voice. No heading. Starts with a hook that draws in the reader. Ends with a practical takeaway or call to action.
[/BLOG]
[INSTAGRAM]
A 150-175 word Instagram caption. Hook first line (grabs scroll). Use "I" voice throughout. End with 6-8 condition-relevant hashtags on the last line, no blank line before them.
[/INSTAGRAM]
[GBP]
An 80-100 word Google Business Profile post. Direct, helpful, ends with a specific call to action ("Book a free movement screen", "Call us", etc.).
[/GBP]

Generate only the content. No preamble, no explanation, no commentary between sections. Start with [BLOG] immediately.`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  if (!(await enforceLimit(req, res, 'demo'))) return
  if (!(await enforceLimit(req, res, 'demoDaily'))) return

  const { text, topicId } = req.body || {}

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'bad_request', message: 'text is required.' })
  }
  if (text.length > MAX_TEXT_CHARS) {
    return res.status(400).json({ error: 'too_long' })
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error('[demo/generate] AI_GATEWAY_API_KEY not set')
    return res.status(500).json({ error: 'not_configured', message: 'The demo is temporarily unavailable.' })
  }

  const systemPrompt = buildSystemPrompt(topicId)
  const topicLabel = TOPIC_LABELS[topicId] || 'clinical topic'

  let result
  try {
    result = streamText({
      model: 'anthropic/claude-sonnet-4-6',
      instructions: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Here is what I want to turn into content (${topicLabel}):\n\n${text.trim()}`,
        },
      ],
      maxOutputTokens: 1800,
    })
  } catch (e) {
    console.error(`[demo/generate] streamText init error: ${e?.stack || e?.message}`)
    return res.status(500).json({ error: 'generation_failed', message: 'Stream init failed.' })
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'private, no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  try {
    for await (const part of result.stream) {
      if (part?.type === 'text-delta') {
        const text = part.text ?? part.delta
        if (!text) continue
        const payload = JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text },
        })
        res.write(`data: ${payload}\n\n`)
      } else if (part?.type === 'error') {
        console.error('[demo/generate] mid-stream error:', part.error?.message || part.error)
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'stream_error' })}\n\n`)
        break
      }
    }
    res.write('data: [DONE]\n\n')
  } catch (e) {
    console.error(`[demo/generate] stream error: ${e?.stack || e?.message}`)
    res.write(`data: ${JSON.stringify({ type: 'error', error: { message: 'stream_error' } })}\n\n`)
  } finally {
    res.end()
  }
}
