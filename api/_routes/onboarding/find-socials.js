import { withSentry } from '../../_lib/sentry.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
export const config = { runtime: 'nodejs' }
// POST /api/onboarding/find-socials
//
// Body: { display_name, website?, location?, missing: string[] }
// Response: { candidates: { <platform>: [{ handle, url, confidence }] } }
//
// Fallback for the onboarding social step: when a clinic's handles aren't linked
// on their website (so scan-website.js couldn't detect them), search the live web
// for their official profiles and return CANDIDATES the user confirms — we never
// auto-save a guessed handle (that would be fabricated attribution). Two passes:
//   1. generateText with the AI Gateway's built-in web-search tool — let the model
//      actually search for each missing platform and gather profile URLs.
//   2. generateObject — distill that research into a strict per-platform candidate
//      list with a confidence score, dropping anything not clearly the business.
//
// Public endpoint (runs during onboarding before a workspace exists). Uses the
// same AI_GATEWAY_API_KEY as scan-website.js — no extra provider package or env.
//
// Pass 1 uses a search-NATIVE model (Perplexity Sonar) rather than a provider
// web-search TOOL: the gateway's `gateway.tools.parallelSearch` emits a
// `web_search_tool_result` content block that Anthropic's API rejects when the
// multi-step loop feeds it back to a Claude model (GatewayInternalServerError:
// "Input tag 'web_search_tool_result' ... does not match any of the expected
// tags"). A search-native model has no tool loop, so there's no foreign block to
// round-trip. Pass 2 (structured extraction) stays on Claude.

import { generateText, generateObject } from 'ai'
import { z } from 'zod'

const SEARCH_MODEL = 'perplexity/sonar-pro'   // searches the live web inherently
const MODEL = 'anthropic/claude-sonnet-4-6'   // structured extraction
const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'youtube', 'tiktok', 'twitter']

// Map a platform → the host(s) a real profile URL must live on, so the model
// can't hand us an off-platform link. Mirrors scan-website.js's matchers.
const PLATFORM_HOSTS = {
  instagram: /(^|\.)instagram\.com$/i,
  facebook: /(^|\.)(facebook\.com|fb\.com)$/i,
  linkedin: /(^|\.)linkedin\.com$/i,
  youtube: /(^|\.)(youtube\.com|youtu\.be)$/i,
  tiktok: /(^|\.)tiktok\.com$/i,
  twitter: /(^|\.)(twitter\.com|x\.com)$/i,
}

const CandidateSchema = z.object({
  candidates: z.array(z.object({
    platform: z.enum(['instagram', 'facebook', 'linkedin', 'youtube', 'tiktok', 'twitter']),
    handle: z.string().describe('The bare handle/username as it appears in the profile URL path (no leading @, no full URL). For LinkedIn use "company/<slug>" or "in/<slug>"; for YouTube use "@handle" or "channel/<id>".'),
    url: z.string().describe('The full https URL of the profile.'),
    confidence: z.number().min(0).max(1).describe('0-1: how confident this profile belongs to THIS specific business (matching name + locality + niche), not a similarly-named account.'),
  })).describe('Profiles found. Empty array if nothing confidently matches. Never invent a profile to fill a slot.'),
})

function sanitizeStr(v, max = 300) {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, max)
}

// Parse the bare handle out of a profile URL, preserving platform path prefixes
// (linkedin company/in, youtube @ / channel / user). Returns null for non-profile
// or off-platform URLs. Defensive: the model's url is untrusted.
function handleFromUrl(platform, rawUrl) {
  let u
  try { u = new URL(rawUrl) } catch { return null }
  if (!['http:', 'https:'].includes(u.protocol)) return null
  const hostRe = PLATFORM_HOSTS[platform]
  if (!hostRe || !hostRe.test(u.hostname)) return null
  const segs = u.pathname.split('/').map(s => s.trim()).filter(Boolean)
  if (!segs.length) return null

  if (platform === 'linkedin') {
    const prefix = segs[0].toLowerCase()
    if (!['company', 'in', 'school'].includes(prefix) || !segs[1]) return null
    const h = segs[1].replace(/[^A-Za-z0-9._-]/g, '')
    return h ? `${prefix}/${h}` : null
  }
  if (platform === 'youtube') {
    const first = decodeURIComponent(segs[0])
    if (first.startsWith('@')) {
      const h = first.replace(/[^A-Za-z0-9._@-]/g, '')
      return h.length > 1 ? h : null
    }
    if (['c', 'channel', 'user'].includes(first.toLowerCase()) && segs[1]) {
      const h = segs[1].replace(/[^A-Za-z0-9._-]/g, '')
      return h ? `${first.toLowerCase()}/${h}` : null
    }
    return null
  }
  // instagram / facebook / tiktok / twitter: first path segment, strip a @.
  let h = decodeURIComponent(segs[0]).replace(/^@/, '').replace(/[^A-Za-z0-9._-]/g, '')
  return h && h.length <= 120 ? h : null
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }
  if (!(await enforceLimit(req, res, 'generic'))) return
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error('[find-socials] AI_GATEWAY_API_KEY not set')
    return res.status(500).json({ error: 'ai-not-configured' })
  }

  const body = req.body || {}
  const displayName = sanitizeStr(body.display_name, 200)
  if (!displayName || displayName.length < 2) {
    return res.status(400).json({ error: 'missing-name' })
  }
  const website = sanitizeStr(body.website, 500)
  const location = sanitizeStr(body.location, 200)
  // context: what the business does (from the website scan's clinic_context).
  // Critical for disambiguating generic names — "Move Better" matches dozens of
  // accounts, but "Move Better, a movement/chiropractic clinic in Portland that
  // treats the root cause of pain" pins the search to the right one.
  const context = sanitizeStr(body.context, 600)
  const missing = Array.isArray(body.missing)
    ? body.missing.filter(p => PLATFORMS.includes(p))
    : PLATFORMS.slice()
  if (!missing.length) return res.status(200).json({ candidates: {} })

  const facts = [
    `Business name: ${displayName}`,
    website ? `Website: ${website}` : null,
    location ? `Location: ${location}` : null,
    context ? `What the business does: ${context}` : null,
    `Platforms to find: ${missing.join(', ')}`,
  ].filter(Boolean).join('\n')

  // Pass 1 — a search-native model finds the official profiles on the live web.
  // We demand full inline https URLs (the extraction pass + server-side URL
  // re-validation key off them) and also fold in any citation source URLs.
  let research = ''
  try {
    const result = await generateText({
      model: SEARCH_MODEL,
      instructions: `You find the OFFICIAL social media profiles of a specific local business. For each requested platform, report the profile as a full https URL written inline in your answer. Prefer profiles whose name, location, and niche match the business exactly; be skeptical of similarly-named accounts in other cities or industries — it is far better to report none for a platform than to guess wrong. If you can't confidently find a platform, say so.`,
      prompt: `Find the official social profiles for this business and list each profile's full URL inline:\n\n${facts}`,
    })
    const sourceUrls = Array.isArray(result.sources)
      ? result.sources.map(s => (typeof s === 'string' ? s : s?.url)).filter(Boolean)
      : []
    research = [result.text || '', sourceUrls.length ? `\nSources:\n${sourceUrls.join('\n')}` : '']
      .join('').trim()
  } catch (e) {
    console.error('[find-socials] web-search pass failed:', e?.message)
    return res.status(502).json({ error: 'search-failed' })
  }

  if (!research.trim()) return res.status(200).json({ candidates: {} })

  // Pass 2 — distill the research into a strict, scored candidate list.
  let object
  try {
    const result = await generateObject({
      model: MODEL,
      schema: CandidateSchema,
      instructions: `Extract official social profiles for the business from the research notes. Only include a profile when the URL is clearly on the right platform and the account plausibly belongs to THIS business. Assign an honest confidence. Do not invent profiles. Only include platforms from this set: ${missing.join(', ')}.`,
      messages: [{
        role: 'user',
        content: `Business:\n${facts}\n\nResearch notes:\n${research}`,
      }],
      temperature: 0,
    })
    object = result.object
  } catch (e) {
    console.error('[find-socials] extraction pass failed:', e?.message)
    return res.status(502).json({ error: 'extract-failed' })
  }

  // Re-validate every candidate URL server-side: confirm it's genuinely on the
  // platform's host, re-derive the handle from the URL (don't trust the model's
  // handle field), keep only requested platforms + a meaningful confidence, and
  // de-dup per platform keeping the highest-confidence first.
  const byPlatform = {}
  for (const c of (object?.candidates || [])) {
    if (!c || !missing.includes(c.platform)) continue
    if (typeof c.confidence !== 'number' || c.confidence < 0.4) continue
    const handle = handleFromUrl(c.platform, c.url)
    if (!handle) continue
    const list = (byPlatform[c.platform] ||= [])
    if (list.some(x => x.handle.toLowerCase() === handle.toLowerCase())) continue
    list.push({ handle, url: c.url, confidence: Math.round(c.confidence * 100) / 100 })
  }
  for (const p of Object.keys(byPlatform)) {
    byPlatform[p].sort((a, b) => b.confidence - a.confidence)
    byPlatform[p] = byPlatform[p].slice(0, 3)
  }

  return res.status(200).json({ candidates: byPlatform })
}

export default withSentry(handler)
