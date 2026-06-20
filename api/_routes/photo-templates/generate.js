// POST /api/photo-templates/generate
// "From your brand": Claude generates a varied set of on-brand photo/carousel
// templates from the workspace's Brand Kit palette + identity, written straight
// into workspace_photo_templates as editable custom templates. The model
// PROPOSES a config in our own schema; the deterministic renderer APPLIES it —
// no canvas editor, no third-party SDK. Reuses the exact theme schema the
// built-ins + slide renderer already speak (src/lib/photoTemplates.js).
export const config = { runtime: 'nodejs', maxDuration: 60 }

import { z } from 'zod'
import { generateObject } from 'ai'
import { requireRole, requireCapability } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { CAP_SETTINGS_EDIT } from '../../_lib/capabilities.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { BUILTIN_THEMES } from '../../../src/lib/photoTemplates.js'

const MODEL = 'anthropic/claude-sonnet-4-6'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const FONT_SIZES   = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl']
const FONT_WEIGHTS = ['normal', 'medium', 'semibold', 'bold', 'extrabold']
const SHADOWS      = ['none', 'soft', 'medium', 'strong']
const BACKGROUNDS  = ['none', 'pill', 'rect']
const LAYOUTS      = ['photo', 'claim', 'badge', 'split']
const PALETTES     = ['dark', 'light']
const ROLES        = ['hook', 'body', 'caption', 'cta', 'attribution', 'page']
const HEX6         = /^#[0-9a-fA-F]{6}$/

// Categorical fields are enum-bounded so the model stays in range; colors are
// free strings sanitized AFTER (loose schema + strict post-process = the
// propose-grade philosophy: the deterministic side is the source of truth).
const blockSchema = z.object({
  fontSize:   z.enum(FONT_SIZES),
  fontWeight: z.enum(FONT_WEIGHTS),
  color:      z.string().describe('Text color as #RRGGBB hex'),
  shadow:     z.enum(SHADOWS),
  background: z.enum(BACKGROUNDS),
  bgColor:    z.string().nullable().describe('Pill/rect fill as #RRGGBB hex, or null to use the brand accent'),
  uppercase:  z.boolean(),
})
const templateSchema = z.object({
  name:    z.string().describe('2–4 word name describing the look, e.g. "Bold Navy Claim"'),
  layout:  z.enum(LAYOUTS).describe('photo = text over full photo; claim = full-bleed card; badge = photo + bottom headline; split = photo top, panel below'),
  palette: z.enum(PALETTES),
  blocks:  z.object(Object.fromEntries(ROLES.map((r) => [r, blockSchema]))),
})
const outSchema = z.object({ templates: z.array(templateSchema) })

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: {
    apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json', Prefer: 'return=representation', ...init.headers,
  },
})

// Pull the brand palette from the post-#1458 Brand Kit buckets, with legacy
// fallback. Used both to prime the prompt and to validate generated colors.
function brandPalette(ws) {
  const ks = ws?.brand_kit_style || {}
  const list = [
    ...(Array.isArray(ks.primary_colors) ? ks.primary_colors : []),
    ...(Array.isArray(ks.secondary_colors) ? ks.secondary_colors : []),
    ks.accent_color, ws?.brand_style?.accent_color, ws?.colors?.primary,
  ].filter((c) => typeof c === 'string' && HEX6.test(c.trim()))
  const accent = (ks.accent_color || ws?.brand_style?.accent_color || ws?.colors?.primary || '#0c7580')
  return { accent, all: [...new Set(list.map((c) => c.toUpperCase()))] }
}

const pick = (val, allowed, fallback) => (allowed.includes(val) ? val : fallback)
const okHex = (c) => (typeof c === 'string' && HEX6.test(c.trim()) ? c.trim() : null)

// Sanitize one block against a built-in fallback so a stray model value can
// never produce an unrenderable template.
function sanitizeBlock(role, raw, fb) {
  const b = raw || {}
  return {
    fontSize:   pick(b.fontSize, FONT_SIZES, fb.fontSize),
    fontWeight: pick(b.fontWeight, FONT_WEIGHTS, fb.fontWeight),
    color:      okHex(b.color) || fb.color,
    shadow:     pick(b.shadow, SHADOWS, fb.shadow),
    background: pick(b.background, BACKGROUNDS, fb.background),
    bgColor:    b.bgColor === null ? null : (okHex(b.bgColor) ?? fb.bgColor ?? null),
    uppercase:  typeof b.uppercase === 'boolean' ? b.uppercase : !!fb.uppercase,
  }
}

function sanitizeTemplate(t) {
  const layout  = pick(t?.layout, LAYOUTS, 'photo')
  const palette = pick(t?.palette, PALETTES, 'dark')
  // Fallback block set = the built-in that matches this layout/palette, else
  // dark-split, so geometry-appropriate defaults fill any gap.
  const fbId = `${palette}-${layout}` in BUILTIN_THEMES ? `${palette}-${layout}` : 'dark-split'
  const fbBlocks = BUILTIN_THEMES[fbId].blocks
  const blocks = {}
  for (const role of ROLES) blocks[role] = sanitizeBlock(role, t?.blocks?.[role], fbBlocks[role])
  const name = (typeof t?.name === 'string' && t.name.trim() ? t.name.trim() : 'Brand template').slice(0, 80)
  return { name, config: { layout, palette, blocks } }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const capAuth = await requireCapability(req, ws, [CAP_SETTINGS_EDIT])
  if (!capAuth.ok) return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })

  if (!(await enforceLimit(req, res, 'ai'))) return
  if (!process.env.AI_GATEWAY_API_KEY) return res.status(503).json({ error: 'ai_unavailable' })

  const count = Math.max(1, Math.min(6, Number(req.body?.count) || 4))
  const hint  = String(req.body?.prompt || '').trim().slice(0, 280)
  const { accent, all } = brandPalette(ws)

  const exemplar = BUILTIN_THEMES['dark-claim']
  const system = [
    'You design Instagram/Facebook carousel + photo templates for a healthcare/clinic brand.',
    'Each template is a JSON config our renderer draws onto a 1080×1080 canvas.',
    'Block roles: hook = the headline; body = supporting sentence; caption = small note;',
    'cta = call-to-action pill; attribution = clinic name; page = page number.',
    'Per block you choose fontSize, fontWeight, text color (#RRGGBB), shadow, background',
    '(none/pill/rect), bgColor (#RRGGBB or null = use the brand accent), and uppercase.',
    'Layout families: photo (text over a full-bleed photo — use shadows so text stays legible),',
    'claim (full-bleed card, works with or without a photo), badge (photo with a bottom-anchored',
    'headline), split (photo on top, a solid color panel below carrying the headline).',
    `Brand accent color: ${accent}.`,
    all.length ? `Brand palette to draw from: ${all.join(', ')}.` : 'No extra brand palette; lean on the accent + clean neutrals.',
    `Clinic name: ${ws.display_name || 'the clinic'}.`,
    'Rules: every color is #RRGGBB hex. Ensure strong text/background contrast and legibility.',
    'Critical contrast rule: in split layouts the headline sits ON the lower color panel, and in light claim/badge layouts text sits on a light card —',
    'so on LIGHT palettes use DARK text (e.g. brand navy) for hook/body/attribution, and on DARK palettes use light/near-white text. Never near-white text on a light panel.',
    'Use the brand colors for pills, panels and accents — not random hues. Vary the set:',
    'mix layouts and both dark + light palettes so the user gets a genuine range.',
    'Reference shape of one good block config (do not copy verbatim): ' + JSON.stringify(exemplar.blocks.hook) + '.',
    hint ? `Extra direction from the user: "${hint}".` : '',
  ].filter(Boolean).join(' ')

  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: outSchema,
      system,
      messages: [{ role: 'user', content: `Generate ${count} distinct, on-brand templates.` }],
      temperature: 0.8,
    })

    const cleaned = (object?.templates || []).slice(0, count).map(sanitizeTemplate)
    if (!cleaned.length) return res.status(502).json({ error: 'generate_failed', message: 'no templates produced' })

    const rows = cleaned.map((t) => ({
      workspace_id: ws.id, name: t.name, is_default: false, config: t.config,
    }))
    const r = await sb('workspace_photo_templates', { method: 'POST', body: JSON.stringify(rows) })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[photo-templates/generate] insert failed — supabase ${r.status}: ${body.slice(0, 300)}`)
      return res.status(500).json({ error: 'save_failed' })
    }
    const created = await r.json()
    return res.status(201).json({ templates: created, count: created.length })
  } catch (e) {
    console.error('[photo-templates/generate] model call failed:', e?.stack || e?.message || e)
    return res.status(502).json({ error: 'generate_failed', message: e?.message || 'unknown' })
  }
}
