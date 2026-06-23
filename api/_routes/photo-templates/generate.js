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

// Relative luminance of a #rrggbb hex (0 = black … 1 = white), for ink/paper.
function hexLum(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec((hex || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

// Pull the brand palette from the Brand Kit (stored on brand_style:
// primary_colors + secondary_colors + accent_color), with legacy fallback. Also
// returns the darkest (ink) and lightest (paper) palette colors so the prompt
// can tell the model what the renderer will paint as the dark/light ground.
function brandPalette(ws) {
  const bs = ws?.brand_style || {}
  const list = [
    ...(Array.isArray(bs.primary_colors) ? bs.primary_colors : []),
    ...(Array.isArray(bs.secondary_colors) ? bs.secondary_colors : []),
    bs.accent_color, ws?.colors?.primary,
  ].filter((c) => typeof c === 'string' && HEX6.test(c.trim())).map((c) => c.trim().toUpperCase())
  const all = [...new Set(list)]
  const accent = (bs.accent_color || ws?.colors?.primary || all[0] || '#333333').toUpperCase()
  const ink   = all.length ? all.reduce((a, b) => (hexLum(b) < hexLum(a) ? b : a)) : null
  const paper = all.length ? all.reduce((a, b) => (hexLum(b) > hexLum(a) ? b : a)) : null
  return { accent, all, ink, paper }
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

  if (!(await enforceLimit(req, res, 'ai', ws.id))) return
  if (!process.env.AI_GATEWAY_API_KEY) return res.status(503).json({ error: 'ai_unavailable' })

  const count = Math.max(1, Math.min(6, Number(req.body?.count) || 4))
  const hint  = String(req.body?.prompt || '').trim().slice(0, 280)
  const { accent, all, ink, paper } = brandPalette(ws)

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
    'IMPORTANT — the renderer paints the card/panel GROUND from THIS brand only:',
    ink ? `a DARK-palette template renders on the brand dark color ${ink};` : 'a DARK-palette template renders on a dark ground;',
    paper ? `a LIGHT-palette template renders on the brand light color ${paper}.` : 'a LIGHT-palette template renders on a light ground.',
    `Brand accent color: ${accent}.`,
    all.length ? `Brand palette — use ONLY these colors (plus #FFFFFF / #000000 when needed): ${all.join(', ')}.` : 'No extra brand palette; use the accent + clean black/white neutrals.',
    `Clinic name: ${ws.display_name || 'the clinic'}.`,
    'Rules: every color is #RRGGBB hex from the brand palette above — never invent colors (no navy, no random hues).',
    'Contrast: on a DARK palette the ground is dark, so hook/body/attribution text must be LIGHT (use the brand light color or #FFFFFF).',
    'On a LIGHT palette the ground is light, so that text must be DARK (use the brand dark color or #000000). Never light text on a light ground.',
    'Use the brand colors for CTA pills and accents. Vary the set: mix layouts and both dark + light palettes for a genuine range.',
    'Reference shape of one good block config (do not copy its colors): ' + JSON.stringify(exemplar.blocks.hook) + '.',
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
