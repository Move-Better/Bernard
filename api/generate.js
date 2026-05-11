import { generateText } from 'ai'
import { requireRole } from './_lib/auth.js'

export const config = { maxDuration: 60 }

// Generates a Claude completion via the Vercel AI Gateway.
//
// Wire format is kept Anthropic-shaped on purpose: callers
// (src/lib/claude.js#generateContent and src/pages/ReviewPost.jsx) read
// `data.content[0].text`, so we return `{ content: [{ type: 'text', text }] }`
// to preserve that contract.
//
// Auth (Phase 1A lockdown 2026-05-11): requires a verified Clerk Bearer token.
// Without this gate anyone with the URL could drain the AI Gateway budget.
// Rate limiting is a follow-up — pending Upstash KV provisioning.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await requireRole(req)
  if (!auth.ok) {
    res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
    return
  }

  let messages, systemPrompt, model
  try {
    ;({ messages, systemPrompt, model } = req.body || {})
  } catch {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  if (!messages || !systemPrompt) {
    res.status(400).json({ error: 'Missing messages or systemPrompt' })
    return
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    res.status(500).json({ error: 'AI_GATEWAY_API_KEY is not set on this deployment' })
    return
  }

  // Callers pass either a bare Anthropic model id ("claude-sonnet-4-6",
  // "claude-opus-4-7") or nothing. Normalize to AI Gateway's "anthropic/<id>".
  const requested = model || 'claude-sonnet-4-6'
  const gatewayModel = requested.includes('/') ? requested : `anthropic/${requested}`

  try {
    const { text } = await generateText({
      model: gatewayModel,
      system: systemPrompt,
      messages,
      maxOutputTokens: 4096,
    })

    res.status(200).json({
      content: [{ type: 'text', text }],
    })
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Internal server error' })
  }
}
