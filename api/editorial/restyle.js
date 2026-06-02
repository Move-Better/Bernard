// POST /api/editorial/restyle
//
// Phase 4 AI conversation endpoint — wires the "Change the look" and
// "Polish this clip" chips across post / carousel / clip surfaces.
//
// Body:
//   {
//     surface: 'post' | 'carousel' | 'clip',
//     instruction: string,     // "punchier caption", "bigger headlines", etc.
//     content?: string,        // current caption / words text
//     transcript?: string,     // what the clinician actually said — grounding
//     staffId?: string,
//     slideCount?: number,     // carousel: current number of slides
//   }
//
// Response 200:
//   {
//     changes: {
//       content?: string,           // rewritten caption/words text
//       fontSizeStep?: number,      // +1 bigger / -1 smaller (relative step)
//       themeId?: string,           // carousel: switch to this built-in theme ID
//       brightness?: number,        // 1.0-1.35 brighter, 0.7-0.95 darker
//       addPageNumbers?: boolean,   // carousel: toggle page numbers
//       slideCountTarget?: number,  // carousel: target slide count
//     },
//     explanation: string           // "I made the headline larger"
//   }
//
// Auth: Clerk JWT + workspace org-id check + EDITOR_ROLES gated.

export const config = { runtime: 'nodejs', maxDuration: 30 }

import { generateText } from 'ai'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { EDITOR_ROLES } from '../_lib/roles.js'
import { enforceLimit } from '../_lib/ratelimit.js'

// ── Visual instruction keyword maps (no AI needed — fast + deterministic) ────

const VISUAL_RULES = [
  // Font size
  { patterns: [/bigger/i, /larger/i, /\bbig\b/i, /increase.*size/i], changes: { fontSizeStep: 1 }, explanation: 'Made the text bigger.' },
  { patterns: [/smaller/i, /tighter.*text/i, /\bsmall\b/i, /decrease.*size/i], changes: { fontSizeStep: -1 }, explanation: 'Made the text smaller.' },
  // Brightness
  { patterns: [/brighter/i, /lighter/i, /light.*photo/i, /photo.*light/i], changes: { brightness: 1.25 }, explanation: 'Brightened the photo.' },
  { patterns: [/darker/i, /moodier/i, /moody/i, /dim/i], changes: { brightness: 0.8 }, explanation: 'Darkened the photo for a moodier feel.' },
  // Theme: dark / navy
  { patterns: [/brand navy/i, /\bnavy\b/i, /\bdark\b/i, /dark.*theme/i, /bold.*dark/i], changes: { themeId: 'bold-dark' }, explanation: 'Switched to the Bold Dark theme.' },
  // Theme: warm / light
  { patterns: [/\bwarm\b/i, /\blight\b/i, /\bcream\b/i, /warm.*light/i, /parchment/i], changes: { themeId: 'warm-light' }, explanation: 'Switched to the Warm Light theme.' },
  // Theme: brand gradient / match brand
  { patterns: [/brand book/i, /match brand/i, /\bbrand\b/i, /brand.*gradient/i, /minimal/i], changes: { themeId: 'brand' }, explanation: 'Switched to the Brand theme to match your brand book.' },
  // Page numbers
  { patterns: [/page numbers?/i, /numbered/i, /add.*numbers?/i, /number.*slides?/i], changes: { addPageNumbers: true }, explanation: 'Added page numbers to all slides.' },
  // Slide count — tighten
  { patterns: [/tighten/i, /fewer.*slides?/i, /less.*slides?/i, /shorter.*carousel/i], slideCountDelta: -1, explanation: 'Tightened the carousel by removing one body slide.' },
  // Slide count — expand
  { patterns: [/more.*slides?/i, /expand/i, /add.*slides?/i, /longer.*carousel/i], slideCountDelta: 1, explanation: 'Expanded the carousel with one more slide.' },
]

const TEXT_PATTERNS = [
  /punchier/i, /shorter/i, /warmer/i, /more direct/i, /direct/i, /formal/i,
  /casual/i, /friendlier/i, /friendly/i, /\buse\b.*phrase/i, /exact phrase/i,
  /rewrite/i, /reword/i, /caption/i, /\bwords\b/i, /\btext\b/i, /\bcopy\b/i,
]

/**
 * Cheaply classify instruction as 'text' or 'visual'.
 * Returns 'text' if any text pattern matches and no visual pattern matches;
 * 'visual' if a visual rule matches. Falls back to 'unknown'.
 */
function classifyLocally(instruction) {
  // Check visual rules first — they're more specific
  for (const rule of VISUAL_RULES) {
    if (rule.patterns.some((p) => p.test(instruction))) return 'visual'
  }
  // Check text rewrites
  if (TEXT_PATTERNS.some((p) => p.test(instruction))) return 'text'
  return 'unknown'
}

/**
 * Apply the first matching visual rule to build a changes object.
 * slideCount is used to compute slideCountTarget for tighten/expand.
 */
function applyVisualRule(instruction, slideCount) {
  for (const rule of VISUAL_RULES) {
    if (rule.patterns.some((p) => p.test(instruction))) {
      if (rule.slideCountDelta !== undefined) {
        const base = typeof slideCount === 'number' && slideCount > 0 ? slideCount : 5
        const target = rule.slideCountDelta > 0
          ? Math.min(8, base + 1)
          : Math.max(3, base - 1)
        return { changes: { slideCountTarget: target }, explanation: rule.explanation }
      }
      return { changes: { ...rule.changes }, explanation: rule.explanation }
    }
  }
  return null
}

/**
 * Use AI to classify an ambiguous instruction and optionally rewrite content.
 * For visual: returns classification JSON.
 * For text: returns the rewritten content.
 */
async function aiClassify(instruction) {
  const systemLines = [
    'You are classifying a styling instruction for a social media post editor.',
    'Respond with valid JSON only. No markdown, no prose — just the raw JSON object.',
    'Schema: {"type":"text"|"visual","visualKey":"bigger|smaller|brighter|darker|dark|warm|brand|pageNumbers|tightenSlides|expandSlides"|null}',
    '"type":"text" means the user wants caption/words rewritten.',
    '"type":"visual" means the user wants a visual style change (font size, theme color, brightness, slide count).',
    'If type is "visual", also set "visualKey" to the closest matching key.',
  ]

  const { text } = await generateText({
    model: 'anthropic/claude-sonnet-4-6',
    system: systemLines.join('\n'),
    messages: [{ role: 'user', content: `Instruction: "${instruction}"` }],
    maxOutputTokens: 80,
  })

  let parsed
  try {
    parsed = JSON.parse(text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, ''))
  } catch {
    // Fallback: treat as text rewrite
    return { type: 'text' }
  }
  return parsed
}

/**
 * Rewrite content text using AI grounded by the transcript.
 */
async function aiRewriteText(instruction, content, transcript) {
  const clipSaid = String(transcript || '').replace(/\s+/g, ' ').trim().slice(0, 1000)

  const systemLines = [
    'You are editing marketing copy for a clinical practitioner.',
    'Keep it to 1-3 sentences, in the speaker\'s warm, expert voice.',
    'Return ONLY the rewritten text — no preamble, no quotes, no explanation.',
  ]
  if (clipSaid) {
    systemLines.push(`What the speaker said (use for substance): ${clipSaid}`)
  }
  if (content) {
    systemLines.push(`Current text: ${String(content).slice(0, 800)}`)
  }

  const { text } = await generateText({
    model: 'anthropic/claude-sonnet-4-6',
    system: systemLines.join('\n'),
    messages: [{ role: 'user', content: instruction }],
    maxOutputTokens: 200,
  })

  return text.trim().replace(/^["']|["']$/g, '')
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  // Workspace + auth
  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // Rate limit
  if (!(await enforceLimit(req, res, 'ai'))) return

  // Validate body
  const body = req.body || {}
  const surface = String(body.surface || '').trim()
  if (!['post', 'carousel', 'clip'].includes(surface)) {
    return res.status(400).json({ error: 'invalid_surface', valid: ['post', 'carousel', 'clip'] })
  }

  const instruction = String(body.instruction || '').trim().slice(0, 300)
  if (!instruction) return res.status(400).json({ error: 'instruction_required' })

  const content   = String(body.content || '').slice(0, 2000)
  const transcript = String(body.transcript || '').slice(0, 3000)
  const slideCount = typeof body.slideCount === 'number' ? body.slideCount : undefined

  // ── Route the instruction ─────────────────────────────────────────────────

  const localType = classifyLocally(instruction)

  try {
    // Fast path: clear visual match — no AI needed
    if (localType === 'visual') {
      const result = applyVisualRule(instruction, slideCount)
      if (result) {
        return res.status(200).json({ changes: result.changes, explanation: result.explanation })
      }
    }

    // Fast path: clear text rewrite — call AI for the rewrite only
    if (localType === 'text') {
      const rewritten = await aiRewriteText(instruction, content, transcript)
      return res.status(200).json({
        changes: { content: rewritten },
        explanation: 'Rewrote the text based on your instruction.',
      })
    }

    // Ambiguous: classify first, then act
    const classification = await aiClassify(instruction)

    if (classification.type === 'visual') {
      // Try to map visualKey to a rule
      const keyMap = {
        bigger:       { changes: { fontSizeStep: 1 },    explanation: 'Made the text bigger.' },
        smaller:      { changes: { fontSizeStep: -1 },   explanation: 'Made the text smaller.' },
        brighter:     { changes: { brightness: 1.25 },   explanation: 'Brightened the photo.' },
        darker:       { changes: { brightness: 0.8 },    explanation: 'Darkened the photo.' },
        dark:         { changes: { themeId: 'bold-dark' }, explanation: 'Switched to the Bold Dark theme.' },
        warm:         { changes: { themeId: 'warm-light' }, explanation: 'Switched to the Warm Light theme.' },
        brand:        { changes: { themeId: 'brand' },   explanation: 'Switched to the Brand theme.' },
        pageNumbers:  { changes: { addPageNumbers: true }, explanation: 'Added page numbers.' },
        tightenSlides: () => {
          const base = typeof slideCount === 'number' && slideCount > 0 ? slideCount : 5
          return { changes: { slideCountTarget: Math.max(3, base - 1) }, explanation: 'Tightened the carousel.' }
        },
        expandSlides: () => {
          const base = typeof slideCount === 'number' && slideCount > 0 ? slideCount : 5
          return { changes: { slideCountTarget: Math.min(8, base + 1) }, explanation: 'Expanded the carousel.' }
        },
      }
      const mapped = keyMap[classification.visualKey]
      if (mapped) {
        const resolved = typeof mapped === 'function' ? mapped() : mapped
        return res.status(200).json(resolved)
      }
      // Fallback: no useful change found
      return res.status(200).json({
        changes: {},
        explanation: 'Noted! Try being more specific — e.g. "bigger headlines" or "brighter photo".',
      })
    }

    // Default: treat as text rewrite
    const rewritten = await aiRewriteText(instruction, content, transcript)
    return res.status(200).json({
      changes: { content: rewritten },
      explanation: 'Rewrote the text based on your instruction.',
    })

  } catch (e) {
    console.error('[restyle] error:', e?.stack || e?.message || e)
    return res.status(500).json({ error: 'restyle_failed', message: e?.message || 'unknown' })
  }
}
