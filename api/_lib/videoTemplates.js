// api/_lib/videoTemplates.js
//
// Video template system — the reel equivalent of src/lib/photoTemplates.js.
//
// A template is DATA, not an enum. That is the whole point: photo templates are
// editable because a template is a config a deterministic renderer interprets,
// so adding a look is a row insert rather than a deploy. Reel "presets" were
// four hardcoded bundles of five scalars, with their id list duplicated across
// four files and a CHECK constraint that structurally forbade a user-created id.
// This replaces that with the photo model.
//
// Built-ins live here (stable ids — a workspace pins one by id, never rename).
// Custom templates are rows in `workspace_video_templates.config` with the SAME
// shape, so resolveVideoTemplate reads both identically.
//
// ── Config shape ────────────────────────────────────────────────────────────
//
//   headline: {
//     role      'hook_card' | 'title' | null   null = this template has no headline
//     yFrac     0..1        vertical centre of the headline, fraction of height
//     widthFrac 0..1        card width for hook_card; ignored by title
//     hold      'reading' | number
//                           'reading' = clamp(1.8, 3.0, words × 0.35), then capped
//                           at 35% of the clip. A number pins the seconds instead.
//     fadeIn    boolean     false keeps the headline on frame 0, which doubles as
//                           the feed cover image — a fade leaves that frame empty.
//   }
//   captions: {
//     enabled   boolean
//     position  'top' | 'center' | 'bottom'
//     style     one of CAPTION_STYLE_IDS
//     sizeScale number      multiplies CAPTION_BASE_FS. Continuous, unlike the old
//                           small/medium/large enum — a template can ask for 1.15.
//   }
//   blocks: { headline: <block>, caption: <block> }
//     block = { fontWeight, color, shadow, uppercase }
//     color accepts a brand token ('$accent' | '$ink' | '$paper') or a CSS colour,
//     resolved per workspace at render time — same convention as photo templates.

export const CAPTION_STYLE_IDS = ['bold', 'word_box', 'accent_fill', 'glow', 'underline', 'pop']
export const CAPTION_POSITIONS = ['top', 'center', 'bottom']
export const HEADLINE_ROLES = ['hook_card', 'title']

// Legacy small/medium/large → sizeScale. Kept so an existing caller (the editor's
// Size control) maps onto the continuous field.
export const NAMED_SIZE_SCALE = { small: 0.75, medium: 1.0, large: 1.35 }

const FALLBACK_BLOCK = Object.freeze({
  fontWeight: 'bold', color: '#FFFFFF', shadow: 'medium', uppercase: false,
})

export const BUILTIN_VIDEO_TEMPLATES = {
  // The safe floor. No headline, so nothing can truncate and nothing can collide.
  captions_only: {
    id: 'captions_only',
    name: 'Captions only',
    headline: { role: null },
    captions: { enabled: true, position: 'bottom', style: 'bold', sizeScale: 1.0 },
    blocks: { caption: { ...FALLBACK_BLOCK } },
  },

  // Inset card, brand colour as a rule rather than a fill.
  hook_card: {
    id: 'hook_card',
    name: 'Hook card',
    headline: { role: 'hook_card', yFrac: 0.17, widthFrac: 0.88, hold: 'reading', fadeIn: false },
    captions: { enabled: true, position: 'bottom', style: 'bold', sizeScale: 1.0 },
    blocks: {
      headline: { ...FALLBACK_BLOCK, fontWeight: 'bold' },
      caption: { ...FALLBACK_BLOCK },
    },
  },

  // CapCut-style: no headline, big centred captions in a filled brand box.
  kinetic: {
    id: 'kinetic',
    name: 'Kinetic',
    headline: { role: null },
    captions: { enabled: true, position: 'center', style: 'accent_fill', sizeScale: 1.35 },
    blocks: { caption: { ...FALLBACK_BLOCK, fontWeight: 'extrabold' } },
  },

  // Headline straight on the frame with a shadow, no card behind it.
  editorial: {
    id: 'editorial',
    name: 'Editorial',
    headline: { role: 'title', yFrac: 0.20, hold: 'reading', fadeIn: false },
    captions: { enabled: true, position: 'bottom', style: 'bold', sizeScale: 1.0 },
    blocks: {
      headline: { ...FALLBACK_BLOCK, fontWeight: 'extrabold', shadow: 'strong' },
      caption: { ...FALLBACK_BLOCK },
    },
  },
}

export const BUILTIN_VIDEO_TEMPLATE_IDS = Object.keys(BUILTIN_VIDEO_TEMPLATES)

/** A uuid is a custom template; anything else must be a built-in slug. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isCustomTemplateId = (id) => UUID_RE.test(String(id || ''))

const clamp01 = (v, dflt) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : dflt
}

function sanitizeBlock(b) {
  const src = b && typeof b === 'object' ? b : {}
  return {
    fontWeight: ['normal', 'medium', 'semibold', 'bold', 'extrabold'].includes(src.fontWeight)
      ? src.fontWeight : FALLBACK_BLOCK.fontWeight,
    color: typeof src.color === 'string' && src.color.trim() ? src.color.trim() : FALLBACK_BLOCK.color,
    shadow: ['none', 'soft', 'medium', 'strong'].includes(src.shadow) ? src.shadow : FALLBACK_BLOCK.shadow,
    uppercase: src.uppercase === true,
  }
}

/**
 * Coerce any stored config into a renderable template.
 *
 * Same philosophy as the photo AI routes: the caller (a user, or a model)
 * PROPOSES a config and the deterministic renderer APPLIES a sanitized version.
 * Every field falls back rather than throwing, so a half-written custom row
 * renders as something sane instead of failing the whole reel.
 */
export function sanitizeVideoTemplate(raw, { id, name } = {}) {
  const t = raw && typeof raw === 'object' ? raw : {}
  const h = t.headline && typeof t.headline === 'object' ? t.headline : {}
  const c = t.captions && typeof t.captions === 'object' ? t.captions : {}

  const role = HEADLINE_ROLES.includes(h.role) ? h.role : null
  const holdNum = Number(h.hold)
  const hold = Number.isFinite(holdNum) && holdNum > 0 ? Math.min(15, holdNum) : 'reading'

  const scaleNum = Number(c.sizeScale)
  const sizeScale = Number.isFinite(scaleNum)
    ? Math.min(2.5, Math.max(0.4, scaleNum))
    : (NAMED_SIZE_SCALE[c.size] ?? 1.0)

  return {
    id: id || t.id || 'hook_card',
    name: String(name || t.name || 'Untitled').slice(0, 80),
    headline: role
      ? {
          role,
          yFrac: clamp01(h.yFrac, role === 'title' ? 0.20 : 0.17),
          widthFrac: Math.min(1, Math.max(0.3, Number(h.widthFrac) || 0.88)),
          hold,
          fadeIn: h.fadeIn === true,
        }
      : { role: null },
    captions: {
      enabled: c.enabled !== false,
      position: CAPTION_POSITIONS.includes(c.position) ? c.position : 'bottom',
      style: CAPTION_STYLE_IDS.includes(c.style) ? c.style : 'bold',
      sizeScale,
    },
    blocks: {
      headline: sanitizeBlock(t.blocks?.headline),
      caption: sanitizeBlock(t.blocks?.caption),
    },
  }
}

/**
 * Resolve a template id against the built-ins and a workspace's custom rows.
 * Mirrors resolveTheme() in the photo system: a custom row's `config` is read
 * with exactly the same shape as a built-in, so nothing downstream branches on
 * where the template came from.
 *
 * @param {string|null} id
 * @param {Array<{id:string,name:string,config:object}>} [customs]
 */
export function resolveVideoTemplate(id, customs = []) {
  const key = String(id || '')
  if (BUILTIN_VIDEO_TEMPLATES[key]) return sanitizeVideoTemplate(BUILTIN_VIDEO_TEMPLATES[key], { id: key })
  const row = Array.isArray(customs) ? customs.find((t) => t && String(t.id) === key) : null
  if (row) return sanitizeVideoTemplate(row.config, { id: row.id, name: row.name })
  return sanitizeVideoTemplate(BUILTIN_VIDEO_TEMPLATES.hook_card, { id: 'hook_card' })
}

/**
 * How long the headline stays on screen.
 *
 * 'reading' derives it from reading speed (~0.35s/word, floored at 1.8s so a
 * short headline is still readable, capped at 3s so it never overstays), then
 * caps again at a third of the clip so a 5-second reel isn't mostly text. A
 * numeric hold pins the seconds but is still clip-capped — a template cannot
 * ask for more frames than the clip has.
 */
export function headlineHoldSeconds(template, headlineText, clipDurationSec) {
  const words = String(headlineText || '').trim().split(/\s+/).filter(Boolean).length
  const hold = template?.headline?.hold
  const base = hold === 'reading' || hold === undefined
    ? Math.min(3.0, Math.max(1.8, words * 0.35))
    : Number(hold)
  const byClip = Math.max(0.8, (Number(clipDurationSec) || 0) * 0.35)
  return Math.min(base, byClip)
}
