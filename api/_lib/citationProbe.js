// Citation probing — asks answer engines a patient question and reports which
// sources they cite. Powers the /seo "Are you the answer?" scoreboard.
//
// Engines (keyed to the credentials this deployment actually holds):
//   chatgpt    — OpenAI Responses API + web_search tool (OPENAI_API_KEY).
//                Citations arrive as url_citation annotations on the output.
//   perplexity — perplexity/sonar via the Vercel AI Gateway (AI_GATEWAY_API_KEY).
//                Citations arrive as result.sources.
//   google     — NOT wired: Google AI Overview needs a SERP provider or a
//                Gemini key with search grounding; neither credential exists.
//                availableEngines() reports it absent so callers render an
//                honest "not connected" state instead of fake data.
//
// Pure transform + fetch — no workspace context, no Supabase. Verified locally
// (2026-07-02 spike): both live engines return extractable citation URLs for
// Portland-area clinical questions.

import { generateText, generateObject } from 'ai'
import { z } from 'zod'

const OPENAI_MODEL = 'gpt-5-mini' // cheapest web_search-capable tier; reasoning kept low

export function availableEngines() {
  const engines = []
  if (process.env.OPENAI_API_KEY) engines.push('chatgpt')
  if (process.env.AI_GATEWAY_API_KEY) engines.push('perplexity')
  return engines
}

// ── Domain matching ─────────────────────────────────────────────────────────

// The clinic's own hostnames, from the workspace row. website_hostname is the
// canonical marketing site; gsc_site_url arrives as "sc-domain:example.com" or
// a full URL depending on the Search Console property type.
export function clinicDomains(ws) {
  const out = new Set()
  const add = (raw) => {
    if (!raw || typeof raw !== 'string') return
    const cleaned = raw
      .replace(/^sc-domain:/i, '')
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      .trim()
      .toLowerCase()
    if (cleaned.includes('.')) out.add(cleaned)
  }
  add(ws.website_hostname)
  add(ws.gsc_site_url)
  return [...out]
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase() } catch { return null }
}

// True when the cited host IS the clinic domain or a subdomain of it.
function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`)
}

// Reduce a probe's cited URLs against the clinic's domains:
//   cited          — any URL belongs to the clinic
//   topCitedDomain — most-frequent non-clinic domain (the "who's winning
//                    instead" cell); null when the clinic is cited or no URLs
export function summarizeCitations(urls, domains) {
  const counts = new Map()
  let cited = false
  for (const url of urls) {
    const host = hostnameOf(url)
    if (!host) continue
    if (domains.some((d) => hostMatches(host, d))) { cited = true; continue }
    counts.set(host, (counts.get(host) || 0) + 1)
  }
  let topCitedDomain = null
  if (!cited && counts.size > 0) {
    topCitedDomain = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }
  return { cited, topCitedDomain }
}

// ── Engine probes ───────────────────────────────────────────────────────────

// Phrase the probe the way a local patient would ask it. Location comes from
// workspaces.location (e.g. "Portland, OR"); without one the question runs bare.
function probePrompt(question, location) {
  return location ? `${question} — I'm in ${location}.` : question
}

// ChatGPT: Responses API with the web_search tool. Reasoning effort stays low —
// the spike showed default effort spends the whole output budget on reasoning
// tokens and returns no message.
export async function probeChatGPT(question, location) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: 'low' },
      tools: [{ type: 'web_search' }],
      input: probePrompt(question, location),
      max_output_tokens: 2500,
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`openai_${res.status}: ${body.slice(0, 160)}`)
  }
  const j = await res.json()
  const msg = (j.output || []).find((o) => o.type === 'message')
  const textPart = msg?.content?.find((c) => c.type === 'output_text')
  const urls = (textPart?.annotations || [])
    .filter((a) => a.type === 'url_citation' && a.url)
    .map((a) => a.url)
  return { urls: [...new Set(urls)], excerpt: (textPart?.text || '').slice(0, 400) }
}

// Perplexity sonar through the AI Gateway; sources come back normalized.
export async function probePerplexity(question, location) {
  const result = await generateText({
    model: 'perplexity/sonar',
    prompt: probePrompt(question, location),
    maxOutputTokens: 400,
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(60_000),
  })
  const urls = (result.sources || [])
    .filter((s) => s.sourceType === 'url' && s.url)
    .map((s) => s.url)
  return { urls: [...new Set(urls)], excerpt: (result.text || '').slice(0, 400) }
}

export async function probeEngine(engine, question, location) {
  if (engine === 'chatgpt') return probeChatGPT(question, location)
  if (engine === 'perplexity') return probePerplexity(question, location)
  throw new Error(`unsupported_engine: ${engine}`)
}

// ── Question seeding ────────────────────────────────────────────────────────

const seedSchema = z.object({
  questions: z.array(z.object({
    question: z.string(),
    topic: z.string(),
  })).max(20),
})

// Turn raw search demand into natural patient questions worth tracking.
// Grounded in the workspace's REAL queries + published topics — never invented
// demand. Returns [] when there's nothing to ground on.
export async function generateTrackedQuestions({ ws, gscQueries = [], topics = [] }) {
  const queryLines = gscQueries.slice(0, 40).map((q) => `- ${q}`).join('\n')
  const topicLines = topics.slice(0, 30).map((t) => `- ${t}`).join('\n')
  if (!queryLines && !topicLines) return []

  const { object } = await generateObject({
    model: 'anthropic/claude-haiku-4-5',
    schema: seedSchema,
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(60_000),
    prompt: [
      `${ws.display_name || ws.slug} is a clinic${ws.location ? ` in ${ws.location}` : ''}.`,
      'Below are real Google searches that already reach their site, and topics they have published on.',
      'Write the 12 most valuable PATIENT QUESTIONS to track in AI answer engines (ChatGPT, Perplexity, Google AI) —',
      'the natural-language versions of this demand, phrased the way a local patient would ask an assistant.',
      'Rules: stay strictly within the conditions/topics present in the data (do not invent new service lines);',
      'skip branded/navigational searches (the clinic name, phone numbers, "near me" variants of the brand) —',
      'track only condition/treatment intent a NEW patient would ask about;',
      'one question per distinct intent, no near-duplicates; plain language; each under 90 characters;',
      'topic = a 1-3 word condition/category label taken from the data.',
      '',
      queryLines ? `Real searches reaching their site:\n${queryLines}` : '',
      topicLines ? `Published topics:\n${topicLines}` : '',
    ].filter(Boolean).join('\n'),
  })

  const seen = new Set()
  return (object.questions || []).filter((q) => {
    const key = q.question.trim().toLowerCase()
    if (!key || key.length > 120 || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 12)
}
