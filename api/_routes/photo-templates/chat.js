// POST /api/photo-templates/chat
// "Design with AI": a conversational template designer. The user describes a
// look and refines it by chat ("make the headline bigger", "try a light
// background", "use my sage"). Each turn Claude returns the COMPLETE updated
// template config (our own schema), plus a short conversational reply and a
// terse change summary. The model PROPOSES; the deterministic sanitizer +
// renderer APPLY — same propose-grade philosophy as the from-brand generator
// (generate.js), so a stray value can never produce an unrenderable template.
//
// This route does NOT persist anything. The client iterates on one draft and
// saves it via the existing POST /api/photo-templates when happy. Reuses the
// exact theme schema the built-ins + slide renderer speak
// (src/lib/photoTemplates.js).
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

const FONT_SIZES   = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl']
const FONT_WEIGHTS = ['normal', 'medium', 'semibold', 'bold', 'extrabold']
const SHADOWS      = ['none', 'soft', 'medium', 'strong']
const BACKGROUNDS  = ['none', 'pill', 'rect']
const LAYOUTS      = ['photo', 'claim', 'badge', 'split']
const PALETTES     = ['dark', 'light']
const ROLES        = ['hook', 'body', 'caption', 'cta', 'attribution', 'page']
const HEX6         = /^#[0-9a-fA-F]{6}$/

// Categorical fields are enum-bounded so the model stays in range; colors are
// free strings sanitized AFTER (loose schema + strict post-process).
const blockSchema = z.object({
  fontSize:   z.enum(FONT_SIZES),
  fontWeight: z.enum(FONT_WEIGHTS),
  color:      z.string().describe('Text color as #RRGGBB hex'),
  shadow:     z.enum(SHADOWS),
  background: z.enum(BACKGROUNDS),
  bgColor:    z.string().nullable().describe('Pill/rect fill as #RRGGBB hex, or null to use the brand accent'),
  uppercase:  z.boolean(),
})
const outSchema = z.object({
  name:    z.string().describe('2–4 word name describing the look, e.g. "Bold Navy Claim"'),
  layout:  z.enum(LAYOUTS).describe('photo = text over full photo; claim = full-bleed card; badge = photo + bottom headline; split = photo top, panel below'),
  palette: z.enum(PALETTES),
  blocks:  z.object(Object.fromEntries(ROLES.map((r) => [r, blockSchema]))),
  reply:   z.string().describe('One or two sentences to the user, conversational, describing what you did and inviting the next change.'),
  summary: z.string().describe('A terse change summary, e.g. "headline → 3xl" or "palette → light · ground brand white". Lowercase, no period.'),
})

// Relative luminance of a #rrggbb hex (0 = black … 1 = white), for ink/paper.
function hexLum(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec((hex || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

// Pull the brand palette from the Brand Kit (brand_style: primary_colors +
// secondary_colors + accent_color), with legacy fallback. Also returns darkest
// (ink) and lightest (paper) so the prompt can tell the model what ground the
// renderer paints.
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

function sanitizeConfig(t) {
  const layout  = pick(t?.layout, LAYOUTS, 'photo')
  const palette = pick(t?.palette, PALETTES, 'dark')
  const fbId = `${palette}-${layout}` in BUILTIN_THEMES ? `${palette}-${layout}` : 'dark-split'
  const fbBlocks = BUILTIN_THEMES[fbId].blocks
  const blocks = {}
  for (const role of ROLES) blocks[role] = sanitizeBlock(role, t?.blocks?.[role], fbBlocks[role])
  return { layout, palette, blocks }
}

// Validate + clamp a client config to the schema shape so the model receives a
// trustworthy "current config" (the client could send anything).
function normalizeIncoming(cfg) {
  if (!cfg || typeof cfg !== 'object') return null
  if (!cfg.layout && !cfg.blocks) return null
  return sanitizeConfig(cfg)
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

  // Conversation: [{ role: 'user'|'assistant', content: string }]. Keep the last
  // ~12 turns to bound tokens; the latest must be a user message.
  const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : []
  const messages = rawMessages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 800) }))
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'bad_request', message: 'messages must end with a user turn' })
  }

  const current = normalizeIncoming(req.body?.currentConfig)
  const { accent, all, ink, paper } = brandPalette(ws)

  const system = [
    'You are a friendly AI designer building ONE Instagram/Facebook carousel + photo template for a healthcare/clinic brand, refined through conversation.',
    'Each turn you return the COMPLETE updated template config in our schema (not a diff) — even for a small change, re-emit every field — plus a short conversational `reply` and a terse `summary` of what changed.',
    'The config our renderer draws onto a 1080×1080 canvas:',
    'Block roles: hook = the headline; body = supporting sentence; caption = small note; cta = call-to-action pill; attribution = clinic name; page = page number.',
    'Per block you set fontSize, fontWeight, text color (#RRGGBB), shadow, background (none/pill/rect), bgColor (#RRGGBB or null = use the brand accent), and uppercase.',
    'Layout families: photo (text over a full-bleed photo — use shadows so text stays legible), claim (full-bleed card, works with or without a photo), badge (photo with a bottom-anchored headline), split (photo on top, a solid color panel below carrying the headline). You MAY change the layout family when the user asks ("make it a card", "split panel", etc.).',
    'IMPORTANT — the renderer paints the card/panel GROUND from THIS brand only:',
    ink ? `a DARK-palette template renders on the brand dark color ${ink};` : 'a DARK-palette template renders on a dark ground;',
    paper ? `a LIGHT-palette template renders on the brand light color ${paper}.` : 'a LIGHT-palette template renders on a light ground.',
    `Brand accent color: ${accent}.`,
    all.length ? `Brand palette — use ONLY these colors (plus #FFFFFF / #000000 when needed): ${all.join(', ')}.` : 'No extra brand palette; use the accent + clean black/white neutrals.',
    `Clinic name: ${ws.display_name || 'the clinic'}.`,
    'Rules: every color is #RRGGBB hex from the brand palette above — never invent colors (no navy, no random hues).',
    'Contrast: on a DARK palette the ground is dark, so hook/body/attribution text must be LIGHT (the brand light color or #FFFFFF). On a LIGHT palette the ground is light, so that text must be DARK (the brand dark color or #000000). Never light text on a light ground.',
    'Keep a name that fits the current look (2–4 words). Be concise and warm in `reply`; keep `summary` terse and lowercase.',
    current
      ? `The CURRENT template config is:\n${JSON.stringify(current)}\nApply the user's latest request to it and return the full updated config.`
      : 'There is NO template yet — design the first one from the user\'s request, grounded in the brand above.',
  ].filter(Boolean).join('\n')

  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: outSchema,
      system,
      messages,
      temperature: 0.7,
    })

    const config = sanitizeConfig(object)
    const name = (typeof object?.name === 'string' && object.name.trim() ? object.name.trim() : 'Brand template').slice(0, 80)
    const reply = (typeof object?.reply === 'string' && object.reply.trim() ? object.reply.trim() : 'Updated the design — what next?').slice(0, 400)
    const summary = (typeof object?.summary === 'string' ? object.summary.trim() : '').slice(0, 120)

    return res.status(200).json({ name, config, reply, summary })
  } catch (e) {
    console.error('[photo-templates/chat] model call failed:', e?.stack || e?.message || e)
    return res.status(502).json({ error: 'chat_failed', message: e?.message || 'unknown' })
  }
}
