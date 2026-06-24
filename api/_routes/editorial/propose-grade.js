// POST /api/editorial/propose-grade
// Describe-a-look: a natural-language vibe ("bright, warm, clinical") → a set of
// canonical colorist grade params the editor pre-fills into its sliders. The
// model PROPOSES; the deterministic Sharp/canvas emitters APPLY. We store the
// returned params and never re-call the model on re-render.
export const config = { runtime: 'nodejs', maxDuration: 30 }

import { z } from 'zod'
import { generateObject } from 'ai'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const MODEL = 'anthropic/claude-haiku-4-5'

// Canonical params, signed -100..100 (must match api/_lib/gradeParams.js). The
// schema bounds + the prompt's subject-safe guidance keep the model honest.
const gradeSchema = z.object({
  exposure:   z.number().min(-100).max(100).describe('Overall brightness'),
  contrast:   z.number().min(-100).max(100),
  saturation: z.number().min(-100).max(100).describe('Color vibrance'),
  warmth:     z.number().min(-100).max(100).describe('Negative = cooler/bluer, positive = warmer/golden'),
  tint:       z.number().min(-100).max(100).describe('Green ↔ magenta; usually near 0'),
  depth:      z.number().min(-100).max(100).describe('Filmic midtone falloff; positive only deepens'),
})

const SYSTEM = [
  'You are a restrained photo colorist for a healthcare/clinic brand.',
  'Translate a described "look" into grade parameters, each an integer from -100 to 100.',
  'Stay SUBJECT-SAFE: a clinician must look natural — never push any value past ~60 in magnitude,',
  'and keep saturation/warmth moderate so skin tones stay believable. Neutral is 0.',
  'Return ONLY the parameters.',
].join(' ')

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  const prompt = String(req.body?.prompt || '').trim().slice(0, 280)
  if (!prompt) return res.status(400).json({ error: 'empty_prompt' })
  if (!process.env.AI_GATEWAY_API_KEY) return res.status(503).json({ error: 'ai_unavailable' })

  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: gradeSchema,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Look to translate: "${prompt}"` }],
      temperature: 0.2,
    })
    // Clamp defensively (schema already bounds, but never trust the wire).
    const clampSafe = (n) => Math.max(-100, Math.min(100, Math.round(Number(n) || 0)))
    const params = {
      exposure:   clampSafe(object.exposure),
      contrast:   clampSafe(object.contrast),
      saturation: clampSafe(object.saturation),
      warmth:     clampSafe(object.warmth),
      tint:       clampSafe(object.tint),
      depth:      clampSafe(object.depth),
    }
    return res.status(200).json({ params })
  } catch (e) {
    console.error('[propose-grade] model call failed:', e?.stack || e?.message || e)
    return res.status(502).json({ error: 'propose_failed', message: e?.message || 'unknown' })
  }
}
