// POST /api/demo/followup
//
// PUBLIC, UNAUTHENTICATED demo endpoint. Takes the topic + the visitor's prior
// transcript(s) and returns a single AI-generated follow-up question from
// Bernard, the interview host.
//
//   • NO workspaceContext / NO requireRole / NO Supabase / NO Vercel Blob.
//     Persists nothing. Audio is never received here — only text.
//   • Rate-limited by IP: same demo burst + demoDaily buckets as transcribe.js
//   • Cost: one Haiku call, ~150 output tokens. Cheap by design.
//
// Bernard's job is to ask ONE focused follow-up that deepens the story — not
// to summarize, not to compliment, just to pull out one more layer.

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
}

import { generateText } from 'ai'
import { enforceLimit } from '../_lib/ratelimit.js'

const TOPIC_CONTEXT = {
  story: 'The visitor is telling a patient success story.',
  faq: 'The visitor is answering a question they get from patients all the time.',
  insight: 'The visitor is sharing something they wish every patient understood.',
}

const BERNARD_SYSTEM = `You are Bernard, the interview host. Your job is to ask ONE short, focused follow-up question that draws out a deeper or more specific layer of what the person just said.

Rules:
- Ask exactly ONE question. No preamble, no compliments, no "Great answer!" — just the question.
- Reference something specific from what they said (a detail, a phrase, a number, a name if given).
- Keep it conversational and warm — like a curious colleague, not a journalist.
- 1–2 sentences max. The shorter the better.
- Never ask a yes/no question. Always open-ended.
- Never ask them to repeat themselves.
- Your question must be something that would produce a richer story or a more concrete example.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  if (!(await enforceLimit(req, res, 'demo'))) return
  if (!(await enforceLimit(req, res, 'demoDaily'))) return

  const { topicId, transcripts } = req.body || {}

  if (!topicId || !Array.isArray(transcripts) || !transcripts.length) {
    return res.status(400).json({ error: 'bad_request', message: 'topicId and transcripts are required.' })
  }

  const topicCtx = TOPIC_CONTEXT[topicId] || 'The visitor is answering an interview question.'
  const combined = transcripts.map((t, i) => `Answer ${i + 1}: ${t}`).join('\n\n')

  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error('[demo/followup] AI_GATEWAY_API_KEY not set')
    return res.status(500).json({ error: 'not_configured', message: 'The demo is temporarily unavailable.' })
  }

  let question
  try {
    const { text } = await generateText({
      model: 'anthropic/claude-haiku-4-5',
      system: BERNARD_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `${topicCtx}\n\n${combined}\n\nAsk your follow-up question now.`,
        },
      ],
      maxOutputTokens: 120,
      temperature: 0.7,
    })
    question = text.trim().replace(/^["']|["']$/g, '') // strip wrapping quotes if model adds them
  } catch (e) {
    console.error(`[demo/followup] generateText error: ${e?.stack || e?.message}`)
    return res.status(502).json({ error: 'generation_failed', message: "We couldn't generate a follow-up — try again." })
  }

  if (!question) {
    return res.status(422).json({ error: 'empty_question' })
  }

  return res.status(200).json({ question })
}
