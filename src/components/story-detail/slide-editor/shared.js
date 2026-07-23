// Shared constants + pure helpers for the SlideEditor module.
//
// Extracted verbatim from SlideEditor.jsx (structural refactor — no behaviour
// change). Every sub-component file under slide-editor/ imports what it needs
// from here so the module-level helpers live in exactly one place.

import {
  SLIDE_TEMPLATES,
  TEMPLATE_DEFAULT_POSITIONS,
  TEXT_EFFECTS,
  OBJECT_TYPES,
} from '@/lib/overlayTemplates'
import { isNeutralGrade, normalizeGrade } from '@/lib/gradeParams'

// Role label + chip colors. Mirrors the mockup palette.
export const ROLE_META = {
  hook:        { label: 'Hook',        chip: 'bg-action/10 text-action' },
  body:        { label: 'Body',        chip: 'bg-primary/10 text-primary' },
  caption:     { label: 'Caption',     chip: 'bg-primary/10 text-primary' },
  cta:         { label: 'CTA',         chip: 'bg-muted text-muted-foreground' },
  attribution: { label: 'Attribution', chip: 'bg-muted text-muted-foreground' },
  page:        { label: 'Page #',      chip: 'bg-muted text-muted-foreground' },
}

// Normalize a slide loaded from the DB so the editor never has to defensively
// re-check shape. Missing fields get sensible defaults.
export function normalizeSlide(s, idx) {
  return {
    photo_idx: typeof s?.photo_idx === 'number' ? s.photo_idx : idx,
    template:  typeof s?.template === 'string' && SLIDE_TEMPLATES[s.template] ? s.template : 'custom',
    // Preserve the per-slide theme override on load — without this it was
    // stripped when slides were read back from the DB, so a saved per-slide
    // theme never survived a reload (the load-side half of the P0 fix).
    template_id: s?.template_id || null,
    // Photo reframe — focal pan + crop zoom of the bound photo. Optional;
    // absent = centered cover at 1×.
    ...(s?.photo_zoom > 1 ? { photo_zoom: s.photo_zoom } : {}),
    ...(s?.photo_fill != null ? { photo_fill: s.photo_fill } : {}),
    ...(s?.photo_offset && (Number.isFinite(s.photo_offset.x) || Number.isFinite(s.photo_offset.y))
      ? { photo_offset: { x: Number(s.photo_offset.x) || 0, y: Number(s.photo_offset.y) || 0 } }
      : {}),
    // Per-slide colorist grade (AI Photo Editor). Optional; absent = ungraded.
    ...(s?.grade && !isNeutralGrade(s.grade) ? { grade: normalizeGrade(s.grade) } : {}),
    blocks: Array.isArray(s?.blocks)
      ? s.blocks.map((b) => ({
          role:     typeof b?.role === 'string' && ROLE_META[b.role] ? b.role : 'body',
          text:     typeof b?.text === 'string' ? b.text : '',
          position: b?.position ?? 'center',
          // Per-block wrap width (fraction of canvas), set by the editor's resize
          // handle. Optional — renderer falls back to the role default when absent.
          ...(Number.isFinite(b?.width) ? { width: b.width } : {}),
          // Per-block text styling (Text-layer inspector). All optional; absent =
          // inherit the role + theme. Renderer precedence: block > theme > role.
          ...(Number.isFinite(b?.fontScale) && b.fontScale > 0 && b.fontScale !== 1 ? { fontScale: b.fontScale } : {}),
          ...(typeof b?.color === 'string' && b.color ? { color: b.color } : {}),
          ...(b?.fontWeight ? { fontWeight: b.fontWeight } : {}),
          ...(typeof b?.uppercase === 'boolean' ? { uppercase: b.uppercase } : {}),
          ...(b?.font === 'heading' || b?.font === 'body' ? { font: b.font } : {}),
          ...(b?.italic === true ? { italic: true } : {}),
          ...(b?.underline === true ? { underline: true } : {}),
          // Whole-box spacing + effects (P3).
          ...(Number.isFinite(b?.letterSpacing) && b.letterSpacing !== 0 ? { letterSpacing: b.letterSpacing } : {}),
          ...(Number.isFinite(b?.lineHeight) && b.lineHeight > 0 && b.lineHeight !== 1 ? { lineHeight: b.lineHeight } : {}),
          ...(['none', 'soft', 'medium', 'heavy'].includes(b?.shadow) ? { shadow: b.shadow } : {}),
          // Text-effect preset (WS3.2): shadow / outline / glow / label + intensity
          // + effect colour. Absent = legacy role/theme shadow (byte-identical).
          ...(TEXT_EFFECTS.includes(b?.textEffect) ? { textEffect: b.textEffect } : {}),
          ...([1, 2, 3].includes(b?.effectIntensity) ? { effectIntensity: b.effectIntensity } : {}),
          ...(typeof b?.effectColor === 'string' && b.effectColor ? { effectColor: b.effectColor } : {}),
          // Per-word style runs (on-canvas selection toolbar). Keep when ANY run
          // carries a real override — not just colour — and whitelist run fields.
          ...(runsHaveStyle(b?.runs) ? { runs: b.runs.map(sanitizeRun) } : {}),
        }))
      : [],
    // Objects layer (WS3.1): addable elements (logo/watermark today). Optional;
    // absent = no objects. Whitelist the shape so a stray field can't leak in.
    ...(Array.isArray(s?.objects) && s.objects.length
      ? { objects: s.objects
          .filter((o) => o && OBJECT_TYPES.includes(o.type) && typeof o.src === 'string' && o.src)
          .map((o) => ({
            id: typeof o.id === 'string' && o.id ? o.id : `obj_${Math.random().toString(36).slice(2, 9)}`,
            type: o.type,
            ...(typeof o.mark === 'string' ? { mark: o.mark } : {}),
            src: o.src,
            x: Number.isFinite(o.x) ? Math.max(0, Math.min(1, o.x)) : 0.82,
            y: Number.isFinite(o.y) ? Math.max(0, Math.min(1, o.y)) : 0.9,
            scale: Number.isFinite(o.scale) ? Math.max(0.04, Math.min(0.9, o.scale)) : 0.16,
            opacity: Number.isFinite(o.opacity) ? Math.max(0.05, Math.min(1, o.opacity)) : 1,
          }))
      }
      : {}),
  }
}

// ── Inline colour-run helpers ────────────────────────────────────────────────

export function cssColorToHex(color) {
  if (!color) return null
  const v = color.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    const [, r, g, b] = v.split('')
    return ('#' + r + r + g + g + b + b).toUpperCase()
  }
  const m = v.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/)
  if (!m) return null
  return '#' + [m[1], m[2], m[3]].map((n) => parseInt(n, 10).toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Rich per-word run helpers (on-canvas selection styling) ──────────────────
// The inline editor persists per-word style as block.runs entries carrying any
// of {color, sizeScale, bold, italic, underline, strike, case, font}. These map
// 1:1 to what the shared canvas renderer (overlayTemplates) bakes, so what you
// style on the canvas ships to the published post.
export const RICH_STYLE_KEYS = ['color', 'sizeScale', 'bold', 'italic', 'underline', 'strike', 'case', 'font']
export const RICH_SIZE_STEPS = [0.7, 0.85, 1, 1.25, 1.5, 2]
export const RICH_CASES = ['none', 'upper', 'lower', 'title']
export const RICH_FONTS = ['default', 'heading', 'body', 'serif']
// Editor-side font display only — the real bake uses the workspace brand fonts.
export const RICH_FONT_CSS = {
  heading: '"Trebuchet MS", "Segoe UI", sans-serif',
  body: '"Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
}
export const RICH_CASE_CSS = { upper: 'uppercase', lower: 'lowercase', title: 'capitalize' }

// Whitelist a run to {text, ...allowed style keys} — strips any stray DOM/serialize
// artefacts before the row is persisted or hashed.
export function sanitizeRun(r) {
  const out = { text: typeof r?.text === 'string' ? r.text : '' }
  if (typeof r?.color === 'string' && r.color) out.color = r.color
  if (Number.isFinite(r?.sizeScale) && r.sizeScale !== 1) out.sizeScale = r.sizeScale
  if (r?.bold === true || r?.bold === false) out.bold = r.bold
  if (r?.italic === true || r?.italic === false) out.italic = r.italic
  if (r?.underline === true) out.underline = true
  if (r?.strike === true) out.strike = true
  if (r?.case === 'upper' || r?.case === 'lower' || r?.case === 'title') out.case = r.case
  if (r?.font === 'heading' || r?.font === 'body' || r?.font === 'serif') out.font = r.font
  return out
}

// True when any run carries a real per-word override (mirrors the renderer's
// hasRunStyle gate) — used to drop all-bare runs so the row stays clean.
export function runsHaveStyle(runs) {
  return Array.isArray(runs) && runs.some((r) => r && RICH_STYLE_KEYS.some((k) => {
    if (k === 'sizeScale') return Number.isFinite(r.sizeScale) && r.sizeScale !== 1
    if (k === 'color' || k === 'case' || k === 'font') return !!r[k]
    return r[k] === true
  }))
}

// block.runs → innerHTML for the contentEditable (styled spans).
export function richRunsToHTML(runs, text) {
  if (!Array.isArray(runs) || !runs.length) return escapeHtml(text || '')
  return runs.map((r) => {
    const t = escapeHtml(r.text).replace(/\n/g, '<br>')
    const styles = []
    const data = []
    if (r.color) styles.push(`color:${r.color}`)
    if (Number.isFinite(r.sizeScale) && r.sizeScale !== 1) styles.push(`font-size:${r.sizeScale}em`)
    if (r.bold === true) styles.push('font-weight:800')
    else if (r.bold === false) styles.push('font-weight:400')
    if (r.italic === true) styles.push('font-style:italic')
    else if (r.italic === false) styles.push('font-style:normal')
    const dec = [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ')
    if (dec) styles.push(`text-decoration-line:${dec}`)
    if (r.case) { styles.push(`text-transform:${RICH_CASE_CSS[r.case] || 'none'}`); data.push(`data-case="${r.case}"`) }
    if (r.font && RICH_FONT_CSS[r.font]) { styles.push(`font-family:${RICH_FONT_CSS[r.font]}`); data.push(`data-font="${r.font}"`) }
    if (!styles.length && !data.length) return t
    return `<span style="${styles.join(';')}" ${data.join(' ')}>${t}</span>`
  }).join('')
}

// Walk the contentEditable DOM → [{text, ...style}] runs, accumulating styles
// from nested spans (inner wins). Merges adjacent identical-style runs.
export function serializeRichCE(el) {
  const raw = []
  function walk(node, inh) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) raw.push({ ...inh, text: node.textContent })
      return
    }
    if (node.nodeName === 'BR') { raw.push({ ...inh, text: '\n' }); return }
    let cur = inh
    if (node.nodeType === Node.ELEMENT_NODE) {
      cur = { ...inh }
      const s = node.style || {}
      // execCommand foreColor usually emits style.color (styleWithCSS on), but
      // some browsers still produce <font color="…"> — read both.
      const c = cssColorToHex(s.color) || (node.nodeName === 'FONT' ? cssColorToHex(node.getAttribute('color')) : null)
      if (c) cur.color = c
      if (s.fontSize && s.fontSize.endsWith('em')) {
        const v = parseFloat(s.fontSize)
        if (Number.isFinite(v) && v !== 1) cur.sizeScale = Math.round(v * 100) / 100
      }
      if (s.fontWeight) { const w = parseInt(s.fontWeight, 10); if (w >= 700) cur.bold = true; else if (w) cur.bold = false }
      if (s.fontStyle === 'italic') cur.italic = true
      else if (s.fontStyle === 'normal') cur.italic = false
      const dec = s.textDecorationLine || s.textDecoration || ''
      if (dec.indexOf('underline') > -1) cur.underline = true
      if (dec.indexOf('line-through') > -1) cur.strike = true
      if (node.dataset?.case) cur.case = node.dataset.case
      if (node.dataset?.font) cur.font = node.dataset.font
    }
    node.childNodes.forEach((ch) => walk(ch, cur))
  }
  el.childNodes.forEach((ch) => walk(ch, {}))
  const merged = []
  for (const r of raw) {
    const last = merged[merged.length - 1]
    const sameStyle = last && RICH_STYLE_KEYS.every((k) => last[k] === r[k])
    if (sameStyle) last.text += r.text
    else merged.push({ ...r })
  }
  // Strip false/undefined style keys so bare runs serialize to {text} only.
  return merged.map((r) => {
    const out = { text: r.text }
    for (const k of RICH_STYLE_KEYS) {
      if (k === 'sizeScale') { if (Number.isFinite(r.sizeScale) && r.sizeScale !== 1) out.sizeScale = r.sizeScale }
      else if (k === 'color' || k === 'case' || k === 'font') { if (r[k]) out[k] = r[k] }
      else if (r[k] === true || r[k] === false) out[k] = r[k]
    }
    return out
  })
}

// Wrap the live selection in a fresh <span>; returns it (or null if collapsed).
export function wrapSelectionInSpan() {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  const span = document.createElement('span')
  try { range.surroundContents(span) }
  catch { const frag = range.extractContents(); span.appendChild(frag); range.insertNode(span) }
  const nr = document.createRange()
  nr.selectNodeContents(span)
  sel.removeAllRanges(); sel.addRange(nr)
  return span
}
export function unwrapIfBare(span) {
  if (!span) return
  if (!span.getAttribute('style') && !span.dataset?.case && !span.dataset?.font) {
    const p = span.parentNode
    while (span.firstChild) p.insertBefore(span.firstChild, span)
    p.removeChild(span); p.normalize?.()
  }
}
// Resolve the effective per-word flags at the current selection start (nearest
// span ancestors, inner-most wins) — drives toolbar active states + toggles.
export function richFlagsAt(editorEl) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return {}
  let node = sel.getRangeAt(0).startContainer
  const f = {}
  while (node && node !== editorEl) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const s = node.style || {}
      if (f.color == null && s.color) f.color = cssColorToHex(s.color)
      if (f.scale == null && s.fontSize?.endsWith('em')) f.scale = parseFloat(s.fontSize)
      if (f.bold == null && s.fontWeight) f.bold = parseInt(s.fontWeight, 10) >= 700
      if (f.italic == null && s.fontStyle) f.italic = s.fontStyle === 'italic'
      const dec = s.textDecorationLine || s.textDecoration || ''
      if (dec.indexOf('underline') > -1) f.underline = true
      if (dec.indexOf('line-through') > -1) f.strike = true
      if (f.case == null && node.dataset?.case) f.case = node.dataset.case
      if (f.font == null && node.dataset?.font) f.font = node.dataset.font
    }
    node = node.parentNode
  }
  return f
}

export function defaultPositionFor(template, role) {
  const map = TEMPLATE_DEFAULT_POSITIONS[template] || {}
  return map[role] || 'center'
}

export function emptyBlockFor(template, role) {
  return { role, text: '', position: defaultPositionFor(template, role) }
}

// Where a text block's anchor sits as a fraction of the canvas — mirrors the
// renderer's resolvePosition + the WHOOP panel auto-zone, so the drag handle
// starts over the actual text. A user-dragged custom {x,y} is used verbatim.
export const WHOOP_CONTENT = new Set(['hook', 'body', 'caption', 'cta'])
// `skipZone` mirrors the renderer (overlayTemplates.drawFreeformBlock): a
// multi-content full-bleed `photo` slide does NOT pull its blocks into the
// bottom scrim zone (they'd overlap), so the drag handle must sit at the block's
// natural top/center/bottom position to stay aligned with the rendered text.
export function blockFraction(block, theme, skipZone = false) {
  const pos = block.position
  if (pos && typeof pos === 'object' && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    return { x: Math.max(0, Math.min(1, pos.x)), y: Math.max(0, Math.min(1, pos.y)) }
  }
  const preset = typeof pos === 'string' ? pos : 'center'
  const [vert, horiz] = preset.includes('-') ? preset.split('-') : [preset, null]
  const col = horiz || 'center'
  let x = col === 'left' ? 0.1 : col === 'right' ? 0.9 : 0.5
  const row = (vert === 'top' || vert === 'bottom' || vert === 'center') ? vert : 'center'
  let y = row === 'top' ? 0.12 : row === 'bottom' ? 0.88 : 0.5
  const layout = theme?.layout, palette = theme?.palette
  const zone = layout === 'split' ? [0.70, 0.95]
    : layout === 'badge' ? (palette === 'dark' ? [0.60, 0.93] : [0.61, 0.93])
    : layout === 'photo' ? [0.58, 0.92] : null
  if (zone && WHOOP_CONTENT.has(block.role) && !skipZone) {
    y = row === 'top' ? zone[0] : row === 'bottom' ? zone[1] : (zone[0] + zone[1]) / 2
  }
  return { x, y }
}

// Per-block text-style swatch palette (Text-layer inspector + toolbars). The
// brand set — used by the floating toolbar, the inline overlay, and the style
// controls.
export const TEXT_COLORS = [
  { label: 'White',  value: '#ffffff' },
  { label: 'Navy',   value: '#0c1a2e' },
  { label: 'Sage',   value: '#83957c' },
  { label: 'Orange', value: '#e8843c' },
  { label: 'Paper',  value: '#f6f4ef' },
  { label: 'Black',  value: '#111111' },
]

// Canvas stage dimensions for each output aspect ratio. Tailwind's scanner
// needs the full class strings present in source to include them in the bundle.
export const ASPECT_STAGE = {
  '1:1':  { twAspect: 'aspect-[1/1]',  hFactor: 1.0 },
  '4:5':  { twAspect: 'aspect-[4/5]',  hFactor: 1.25 },
  '9:16': { twAspect: 'aspect-[9/16]', hFactor: 1.778 },
}
