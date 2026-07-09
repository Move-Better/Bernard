import { useEffect, useMemo, useRef, useState } from 'react'
import { useSmartBack } from '@/lib/useSmartBack'
import { toast } from 'sonner'
import { X, Plus, Image as ImageIcon, ImagePlus, Repeat, Move, Layers, Megaphone, Smartphone, SlidersHorizontal, Instagram, Type, ChevronLeft, ChevronRight, Wand2, Sparkles, FolderOpen, Upload, Search, Loader2, Check, Heart, MessageCircle, Send, Bookmark, Facebook, Linkedin, ThumbsUp, Repeat2, MapPin, Lock, AlertTriangle, History } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUpdateContentItem, usePhotoTemplates, useMediaSuggestions, useVerbatimQuotes } from '@/lib/queries'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { ColorPickerPopover } from '@/components/ColorPickerPopover'
import { brandSwatches, NEUTRAL_SWATCHES } from '@/lib/brandSwatches'
import { apiFetch } from '@/lib/api'
import MediaPicker from '@/components/MediaPicker'
import {
  BLOCK_ROLES,
  SLIDE_TEMPLATES,
  TEMPLATE_DEFAULT_POSITIONS,
  renderFreeformSlide,
  SLIDE_W,
  SLIDE_H,
} from '@/lib/overlayTemplates'
import { resolveTheme, DEFAULT_DECK_THEME, templateFamily } from '@/lib/photoTemplates'
import { GRADE_SLIDERS, GRADE_VIBES, NEUTRAL_GRADE, normalizeGrade, isNeutralGrade } from '@/lib/gradeParams'
import { ensureRenderedSlides, AD_CAROUSEL_DIMS } from '@/lib/renderSlides'
import { photoSourceUrl, clipToMediaEntry, pickerItemToMediaEntry, mediaEntryKey } from '@/lib/mediaEntry'
import { deriveStory } from '@/lib/storyFields'
import { CAPTION_LIMITS, PLATFORM_META } from '@/lib/contentMeta'
import AdCarouselExportModal from '@/components/AdCarouselExportModal'
import EditorChrome from '@/components/editor/EditorChrome'
import EditorWorkflowBar from '@/components/editor/EditorWorkflowBar'
import EditorIconRail from '@/components/editor/IconRail'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import SaveStatus from '@/components/editor/SaveStatus'
import { listRevisions, saveRevision } from '@/lib/editorRevisions'
import UndoRedoButtons from '@/components/editor/UndoRedoButtons'
import { useAutosave } from '@/lib/useAutosave'
import { useUndoHistory } from '@/lib/useUndoHistory'
import { useUndoRedoShortcut } from '@/lib/useUndoRedoShortcut'

// Role label + chip colors. Mirrors the mockup palette.
const ROLE_META = {
  hook:        { label: 'Hook',        chip: 'bg-action/10 text-action' },
  body:        { label: 'Body',        chip: 'bg-primary/10 text-primary' },
  caption:     { label: 'Caption',     chip: 'bg-primary/10 text-primary' },
  cta:         { label: 'CTA',         chip: 'bg-muted text-muted-foreground' },
  attribution: { label: 'Attribution', chip: 'bg-muted text-muted-foreground' },
  page:        { label: 'Page #',      chip: 'bg-muted text-muted-foreground' },
}

// Normalize a slide loaded from the DB so the editor never has to defensively
// re-check shape. Missing fields get sensible defaults.
function normalizeSlide(s, idx) {
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
          // Per-word style runs (on-canvas selection toolbar). Keep when ANY run
          // carries a real override — not just colour — and whitelist run fields.
          ...(runsHaveStyle(b?.runs) ? { runs: b.runs.map(sanitizeRun) } : {}),
        }))
      : [],
  }
}

// ── Inline colour-run helpers ────────────────────────────────────────────────

function cssColorToHex(color) {
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

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Rich per-word run helpers (on-canvas selection styling) ──────────────────
// The inline editor persists per-word style as block.runs entries carrying any
// of {color, sizeScale, bold, italic, underline, strike, case, font}. These map
// 1:1 to what the shared canvas renderer (overlayTemplates) bakes, so what you
// style on the canvas ships to the published post.
const RICH_STYLE_KEYS = ['color', 'sizeScale', 'bold', 'italic', 'underline', 'strike', 'case', 'font']
const RICH_SIZE_STEPS = [0.7, 0.85, 1, 1.25, 1.5, 2]
const RICH_CASES = ['none', 'upper', 'lower', 'title']
const RICH_FONTS = ['default', 'heading', 'body', 'serif']
// Editor-side font display only — the real bake uses the workspace brand fonts.
const RICH_FONT_CSS = {
  heading: '"Trebuchet MS", "Segoe UI", sans-serif',
  body: '"Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
}
const RICH_CASE_CSS = { upper: 'uppercase', lower: 'lowercase', title: 'capitalize' }

// Whitelist a run to {text, ...allowed style keys} — strips any stray DOM/serialize
// artefacts before the row is persisted or hashed.
function sanitizeRun(r) {
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
function runsHaveStyle(runs) {
  return Array.isArray(runs) && runs.some((r) => r && RICH_STYLE_KEYS.some((k) => {
    if (k === 'sizeScale') return Number.isFinite(r.sizeScale) && r.sizeScale !== 1
    if (k === 'color' || k === 'case' || k === 'font') return !!r[k]
    return r[k] === true
  }))
}

// block.runs → innerHTML for the contentEditable (styled spans).
function richRunsToHTML(runs, text) {
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
function serializeRichCE(el) {
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
function wrapSelectionInSpan() {
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
function unwrapIfBare(span) {
  if (!span) return
  if (!span.getAttribute('style') && !span.dataset?.case && !span.dataset?.font) {
    const p = span.parentNode
    while (span.firstChild) p.insertBefore(span.firstChild, span)
    p.removeChild(span); p.normalize?.()
  }
}
// Resolve the effective per-word flags at the current selection start (nearest
// span ancestors, inner-most wins) — drives toolbar active states + toggles.
function richFlagsAt(editorEl) {
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

// The on-canvas inline rich-text editor. Double-click a block → this replaces
// its canvas text (suppressed while editing) and shows a Canva-style selection
// toolbar for per-word font / size / colour / B·I·U·S / case. Serializes to
// block.runs on every change so the canvas + publish bake stay WYSIWYG.
function RichTextEditOverlay({ block, idx, baseStyle, onCommit, onDone }) {
  const ceRef = useRef(null)
  const toolbarRef = useRef(null)
  const savedRangeRef = useRef(null)
  const initRef = useRef(false)
  const [tb, setTb] = useState(null)
  const [flags, setFlags] = useState({})

  useEffect(() => {
    const el = ceRef.current
    if (!el || initRef.current) return
    initRef.current = true
    el.innerHTML = richRunsToHTML(block.runs, block.text)
    el.focus()
    const sel = window.getSelection()
    const r = document.createRange()
    r.selectNodeContents(el); r.collapse(false)
    sel.removeAllRanges(); sel.addRange(r)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function commit() {
    const el = ceRef.current
    if (!el) return
    const runs = serializeRichCE(el)
    const text = runs.map((r) => r.text).join('')
    onCommit(idx, { text, runs: runsHaveStyle(runs) ? runs : null })
  }
  function showToolbar() {
    const el = ceRef.current
    const sel = window.getSelection()
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim() || !el.contains(sel.anchorNode)) {
      setTb(null); return
    }
    savedRangeRef.current = sel.getRangeAt(0).cloneRange()
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    setTb({ top: Math.max(8, rect.top - 46), left: Math.max(8, Math.min(rect.left + rect.width / 2 - 150, window.innerWidth - 308)) })
    setFlags(richFlagsAt(el))
  }
  function restoreRange() {
    const r = savedRangeRef.current
    if (!r) return
    const sel = window.getSelection()
    sel.removeAllRanges(); sel.addRange(r.cloneRange())
  }
  function styleSel(mutator) {
    const el = ceRef.current
    if (!el) return
    restoreRange()
    const span = wrapSelectionInSpan()
    if (!span) return
    mutator(span)
    unwrapIfBare(span)
    el.focus()
    commit()
    requestAnimationFrame(showToolbar)
  }
  function bumpSize(dir) {
    const cur = richFlagsAt(ceRef.current).scale || 1
    let i = RICH_SIZE_STEPS.reduce((best, s, k) => (Math.abs(s - cur) < Math.abs(RICH_SIZE_STEPS[best] - cur) ? k : best), 0)
    i = Math.max(0, Math.min(RICH_SIZE_STEPS.length - 1, i + dir))
    const v = RICH_SIZE_STEPS[i]
    styleSel((s) => { if (v === 1) s.style.fontSize = ''; else s.style.fontSize = `${v}em` })
  }
  function cycleCase() {
    const cur = richFlagsAt(ceRef.current).case || 'none'
    const next = RICH_CASES[(RICH_CASES.indexOf(cur) + 1) % RICH_CASES.length]
    styleSel((s) => {
      if (next === 'none') { s.style.textTransform = ''; delete s.dataset.case }
      else { s.style.textTransform = RICH_CASE_CSS[next]; s.dataset.case = next }
    })
  }
  function cycleFont() {
    const cur = richFlagsAt(ceRef.current).font || 'default'
    const next = RICH_FONTS[(RICH_FONTS.indexOf(cur) + 1) % RICH_FONTS.length]
    styleSel((s) => {
      if (next === 'default') { s.style.fontFamily = ''; delete s.dataset.font }
      else { s.style.fontFamily = RICH_FONT_CSS[next]; s.dataset.font = next }
    })
  }
  function toggleDeco(which) {
    const fl = richFlagsAt(ceRef.current)
    const u = which === 'u' ? !fl.underline : !!fl.underline
    const st = which === 's' ? !fl.strike : !!fl.strike
    const parts = [u && 'underline', st && 'line-through'].filter(Boolean)
    styleSel((s) => { s.style.textDecorationLine = parts.join(' ') || 'none' })
  }
  const btn = (active) => `flex h-7 min-w-[26px] items-center justify-center rounded px-1 text-sm font-semibold transition-colors ${active ? 'bg-primary/15 text-primary' : 'text-foreground/80 hover:bg-muted'}`
  const stopMouse = (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault() }
  const fontLabel = flags.font && flags.font !== 'default' ? flags.font[0].toUpperCase() + flags.font.slice(1, 4) : 'Aa'

  return (
    <>
      <div
        ref={ceRef}
        contentEditable
        suppressContentEditableWarning
        onPointerDown={(e) => e.stopPropagation()}
        onInput={() => { commit(); showToolbar() }}
        onMouseUp={() => setTimeout(showToolbar, 0)}
        onKeyUp={showToolbar}
        onBlur={() => setTimeout(() => {
          if (toolbarRef.current?.contains(document.activeElement)) return
          commit(); onDone()
        }, 160)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); onDone() }
          else if (e.key === 'Escape') { commit(); onDone() }
        }}
        className="w-full rounded px-1 text-lg outline-none"
        style={baseStyle}
        aria-label="Edit text — highlight a word to style it"
      />
      {tb && (
        <div
          ref={toolbarRef}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={stopMouse}
          className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-lg"
          style={{ top: tb.top, left: tb.left }}
        >
          <button onClick={cycleFont} className={btn(!!flags.font && flags.font !== 'default')} title="Font" style={{ minWidth: 34 }}>{fontLabel}</button>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          <button onClick={() => bumpSize(-1)} className={btn(false)} title="Smaller">−</button>
          <button onClick={() => bumpSize(1)} className={btn(false)} title="Bigger">+</button>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          <button onClick={() => styleSel((s) => { s.style.fontWeight = richFlagsAt(ceRef.current).bold ? '400' : '800' })} className={btn(flags.bold === true)} title="Bold" style={{ fontWeight: 800 }}>B</button>
          <button onClick={() => styleSel((s) => { s.style.fontStyle = richFlagsAt(ceRef.current).italic ? 'normal' : 'italic' })} className={btn(flags.italic === true)} title="Italic" style={{ fontStyle: 'italic' }}>I</button>
          <button onClick={() => toggleDeco('u')} className={btn(flags.underline === true)} title="Underline" style={{ textDecoration: 'underline' }}>U</button>
          <button onClick={() => toggleDeco('s')} className={btn(flags.strike === true)} title="Strikethrough" style={{ textDecoration: 'line-through' }}>S</button>
          <button onClick={cycleCase} className={btn(!!flags.case)} title="Case">aA</button>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          {TEXT_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => styleSel((s) => { s.style.color = c.value })}
              className={`h-5 w-5 shrink-0 rounded-full border ${flags.color?.toLowerCase() === c.value.toLowerCase() ? 'ring-2 ring-primary' : 'border-border'}`}
              style={{ background: c.value }}
              title={c.label}
              aria-label={`Colour ${c.label}`}
            />
          ))}
        </div>
      )}
    </>
  )
}

function defaultPositionFor(template, role) {
  const map = TEMPLATE_DEFAULT_POSITIONS[template] || {}
  return map[role] || 'center'
}

function emptyBlockFor(template, role) {
  return { role, text: '', position: defaultPositionFor(template, role) }
}

// ── Block row ─────────────────────────────────────────────────────────────────

function BlockRow({ block, onChange, onRemove }) {
  const meta = ROLE_META[block.role] || ROLE_META.body
  const workspace = useWorkspace()
  const ceRef = useRef(null)
  const [toolbarPos, setToolbarPos] = useState(null)
  const savedRangeRef = useRef(null)
  const initRef = useRef(false)
  const suppressRef = useRef(false)

  // Initialise contenteditable once on mount from block data
  useEffect(() => {
    if (initRef.current || !ceRef.current) return
    initRef.current = true
    ceRef.current.innerHTML = richRunsToHTML(block.runs, block.text)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync from EXTERNAL text changes (e.g. the on-canvas inline editor) when
  // this field isn't focused — keeps the side panel in step without clobbering
  // active typing here.
  useEffect(() => {
    const el = ceRef.current
    if (!el || !initRef.current || document.activeElement === el) return
    const html = richRunsToHTML(block.runs, block.text)
    if (el.innerHTML !== html) el.innerHTML = html
  }, [block.text, block.runs])

  function serializeAndSync() {
    if (suppressRef.current) return
    const el = ceRef.current
    if (!el) return
    // Rich serialize (all per-word dims), so editing text here NEVER drops
    // per-word size/weight/italic/underline/strike/case set on the canvas — the
    // old colour-only serialize would have silently clobbered them.
    const runs = serializeRichCE(el)
    const text = runs.map((r) => r.text).join('')
    const result = { ...block, text }
    if (runsHaveStyle(runs)) result.runs = runs.map(sanitizeRun)
    else delete result.runs
    onChange(result)
  }

  function checkSelection() {
    const sel = window.getSelection()
    const el = ceRef.current
    if (!sel || sel.isCollapsed || !sel.toString().trim() || !el?.contains(sel.anchorNode)) {
      setToolbarPos(null); return
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    const mid = rect.left + rect.width / 2
    setToolbarPos({ top: rect.top - 52, left: Math.max(8, Math.min(mid - 130, window.innerWidth - 268)) })
  }

  function applyColor(color) {
    const sel = window.getSelection()
    if (savedRangeRef.current) { sel.removeAllRanges(); sel.addRange(savedRangeRef.current.cloneRange()) }
    ceRef.current?.focus()
    document.execCommand('styleWithCSS', false, true) // emit <span style="color:…">, which serializeRichCE reads
    document.execCommand('foreColor', false, color)
    savedRangeRef.current = null
    serializeAndSync()
    setToolbarPos(null)
  }

  function clearColor() {
    const sel = window.getSelection()
    if (savedRangeRef.current) { sel.removeAllRanges(); sel.addRange(savedRangeRef.current.cloneRange()) }
    ceRef.current?.focus()
    document.execCommand('removeFormat', false, null)
    savedRangeRef.current = null
    serializeAndSync()
    setToolbarPos(null)
  }

  const bSwatches = useMemo(() => brandSwatches(workspace), [workspace])

  return (
    <div className="flex items-start gap-2 rounded-lg border bg-background/50 p-3">
      <div className="flex-1 min-w-0">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <select
            value={block.role}
            onChange={(e) => onChange({ ...block, role: e.target.value })}
            aria-label="Text block role"
            className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${meta.chip} border border-transparent cursor-pointer`}
          >
            {BLOCK_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_META[r]?.label || r}</option>
            ))}
          </select>
          <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive" aria-label="Delete block">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Floating colour toolbar — fixed above the text selection */}
        {toolbarPos && (
          <div
            className="fixed z-50 flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1.5 shadow-xl"
            style={{ top: toolbarPos.top, left: toolbarPos.left }}
            onMouseDown={(e) => {
              const sel = window.getSelection()
              if (sel && sel.rangeCount > 0 && sel.toString().trim()) {
                savedRangeRef.current = sel.getRangeAt(0).cloneRange()
              }
              // Prevent focus steal for all children except the ColorPickerPopover trigger
              if (!e.target.closest('[data-picker-trigger]')) e.preventDefault()
            }}
          >
            {bSwatches.length > 0 && (
              <span className="pr-0.5 text-3xs font-semibold uppercase tracking-wider text-zinc-500">Brand</span>
            )}
            {bSwatches.slice(0, 5).map((color) => (
              <button
                key={color} type="button" aria-label={color} onClick={() => applyColor(color)}
                className="h-5 w-5 rounded-full border border-zinc-600 transition-all hover:ring-2 hover:ring-white/40 hover:ring-offset-1"
                style={{ background: color }}
              />
            ))}
            {bSwatches.length > 0 && <span className="mx-0.5 h-4 w-px bg-zinc-700" />}
            {['#FFFFFF', '#000000'].map((c) => (
              <button
                key={c} type="button" aria-label={c === '#FFFFFF' ? 'White' : 'Black'} onClick={() => applyColor(c)}
                className="h-5 w-5 rounded-full border border-zinc-600 transition-all hover:ring-2 hover:ring-white/40 hover:ring-offset-1"
                style={{ background: c }}
              />
            ))}
            <span className="mx-0.5 h-4 w-px bg-zinc-700" />
            <button
              type="button" onClick={clearColor}
              className="px-1 text-3xs font-medium text-zinc-400 transition-colors hover:text-white"
            >Clear</button>
            <span data-picker-trigger>
              <ColorPickerPopover
                value="#888888"
                onChange={applyColor}
                swatches={bSwatches}
                swatchClassName="h-5 w-5 rounded-full"
                ariaLabel="Custom colour"
              />
            </span>
          </div>
        )}

        <div
          ref={ceRef}
          contentEditable
          suppressContentEditableWarning
          onInput={serializeAndSync}
          onMouseUp={checkSelection}
          onKeyUp={checkSelection}
          onBlur={() => { setTimeout(() => setToolbarPos(null), 150) }}
          onPaste={(e) => {
            e.preventDefault()
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
          }}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/50 empty:before:text-muted-foreground/50 empty:before:content-[attr(data-placeholder)]"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '2.5rem' }}
          data-placeholder={`${meta.label} text…`}
        />
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Move className="h-4 w-4 shrink-0" /> Drag the text on the canvas to place it. Highlight text to pick a colour.
        </p>
      </div>
    </div>
  )
}

// ── Slide card ────────────────────────────────────────────────────────────────

function SlidePreview({ slide, photoUrl, brandStyle, theme, onReframe, onSelectPhoto, className, aspect }) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const movedRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    async function draw() {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        // The canvas BITMAP must match the CSS box's aspect (ASPECT_STAGE in the
        // caller) or the browser stretches it non-uniformly — this is what made
        // Story's forced 9:16 frame look warped/smeared when the bitmap stayed a
        // hardcoded 4:5 (SLIDE_W/SLIDE_H). Same dimension table the publish bake
        // (ensureRenderedSlides) already uses, so preview and output agree.
        const [w, h] = AD_CAROUSEL_DIMS[aspect] || [SLIDE_W, SLIDE_H]
        await renderFreeformSlide({
          sourceUrl: photoUrl || null,
          slide,
          brandStyle: brandStyle || {},
          canvas,
          theme,
          width: w,
          height: h,
        })
      } catch (e) {
        if (!cancelled) console.warn('[SlidePreview] render failed', e.message)
      }
    }
    draw()
    return () => { cancelled = true }
  }, [slide, photoUrl, brandStyle, theme, aspect])

  const canReframe = !!photoUrl && !!onReframe
  function onPointerDown(e) {
    movedRef.current = false
    if (!canReframe) return
    const rect = canvasRef.current.getBoundingClientRect()
    const off = slide.photo_offset || { x: 0, y: 0 }
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: off.x || 0, oy: off.y || 0, w: rect.width, h: rect.height }
    e.preventDefault()
  }
  function onPointerMove(e) {
    const d = dragRef.current
    if (!d) return
    // Ignore sub-threshold movement so a plain click stays a click (selects the
    // photo layer) instead of micro-reframing and dirtying the slide. Only a
    // real drag (>4px from the press point) reframes.
    if (!movedRef.current && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return
    movedRef.current = true
    const nx = Math.max(-0.5, Math.min(0.5, d.ox + (e.clientX - d.sx) / d.w))
    const ny = Math.max(-0.5, Math.min(0.5, d.oy + (e.clientY - d.sy) / d.h))
    onReframe({ ...slide, photo_offset: { x: nx, y: ny } })
  }
  function endDrag() { dragRef.current = null }
  function onWheel(e) {
    if (!canReframe) return
    e.preventDefault()
    const z = Math.max(1, Math.min(4, (slide.photo_zoom || 1) - e.deltaY * 0.0015))
    onReframe({ ...slide, photo_zoom: z })
  }
  // A click that wasn't a drag selects the photo layer (drives the inspector).
  function onClick() {
    if (movedRef.current) { movedRef.current = false; return }
    if (onSelectPhoto) onSelectPhoto()
  }

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={onPointerDown}
      onMouseMove={onPointerMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onWheel={onWheel}
      onClick={onClick}
      title={canReframe ? 'Click to select · drag to reposition · scroll to zoom' : 'Click to select the photo layer'}
      className={className || `w-full aspect-[4/5] rounded-md border bg-muted ${canReframe ? 'cursor-move' : ''}`}
    />
  )
}

// Where a text block's anchor sits as a fraction of the canvas — mirrors the
// renderer's resolvePosition + the WHOOP panel auto-zone, so the drag handle
// starts over the actual text. A user-dragged custom {x,y} is used verbatim.
const WHOOP_CONTENT = new Set(['hook', 'body', 'caption', 'cta'])
// `skipZone` mirrors the renderer (overlayTemplates.drawFreeformBlock): a
// multi-content full-bleed `photo` slide does NOT pull its blocks into the
// bottom scrim zone (they'd overlap), so the drag handle must sit at the block's
// natural top/center/bottom position to stay aligned with the rendered text.
function blockFraction(block, theme, skipZone = false) {
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

// Floating contextual toolbar — appears above (or below, near the top edge) the
// selected text block, carrying the PRIMARY per-element controls (font · weight ·
// italic · align · colour). Advanced controls (size, width, underline, role) stay
// in the side panel. `stop` swallows pointerdown so clicking the toolbar doesn't
// start a drag on the block box beneath it.
function FloatingTextToolbar({ block, idx, below, onSetStyle, stop }) {
  const btn = (active) => `flex h-7 min-w-[26px] items-center justify-center rounded px-1 text-sm font-semibold transition-colors ${active ? 'bg-primary/15 text-primary' : 'text-foreground/80 hover:bg-muted'}`
  const set = (k, v) => (e) => { e.stopPropagation(); onSetStyle(idx, k, v) }
  const div = <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
  return (
    <div
      onPointerDown={stop}
      className={`absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-lg ${below ? 'top-full mt-2' : 'bottom-full mb-2'}`}
    >
      <button onPointerDown={stop} onClick={set('font', block.font === 'body' ? 'heading' : 'body')} className={btn(false)} title="Toggle font">{block.font === 'body' ? 'Body' : 'Head'}</button>
      {div}
      <button onPointerDown={stop} onClick={set('fontWeight', block.fontWeight === '700' ? null : '700')} className={btn(block.fontWeight === '700')} title="Bold" style={{ fontWeight: 800 }}>B</button>
      <button onPointerDown={stop} onClick={set('italic', block.italic ? null : true)} className={btn(block.italic === true)} title="Italic" style={{ fontStyle: 'italic' }}>I</button>
      {div}
      <button onPointerDown={stop} onClick={set('align', 'left')} className={btn(block.align === 'left')} title="Align left" aria-label="Align left">⇤</button>
      <button onPointerDown={stop} onClick={set('align', null)} className={btn(!block.align || block.align === 'center')} title="Align center" aria-label="Align center">⇔</button>
      <button onPointerDown={stop} onClick={set('align', 'right')} className={btn(block.align === 'right')} title="Align right" aria-label="Align right">⇥</button>
      {div}
      {TEXT_COLORS.slice(0, 3).map((c) => (
        <button key={c.value} onPointerDown={stop} onClick={set('color', c.value)} title={c.label} aria-label={`Colour ${c.label}`}
          className={`h-5 w-5 rounded-full border ${block.color === c.value ? 'ring-2 ring-primary' : 'border-border'}`} style={{ background: c.value }} />
      ))}
    </div>
  )
}

// On-canvas text layer: each block is a box you click to select, drag to place,
// and DOUBLE-CLICK to edit inline (a contentEditable over the block; the canvas
// skips that block's text while editing so there's no double-vision). When a
// block is selected, the floating toolbar rides above it. The canvas underneath
// is the true render.
function TextDragLayer({ slide, theme, selection, onSelectBlock, onMoveBlock, onSetStyle, onSetRuns, editingIdx, setEditingIdx, onDragging, onSnap }) {
  const rootRef = useRef(null)
  const stop = (e) => e.stopPropagation()
  function startDrag(e, idx, f) {
    if (editingIdx === idx) return          // don't drag the block being edited
    e.stopPropagation()
    e.preventDefault()
    onSelectBlock(idx)
    // Convert preset position to custom {x,y} immediately so there's no jump
    // when the first pointermove fires. blockFraction already accounts for WHOOP
    // zone offsets, so this custom position renders at the same visual spot.
    if (f) onMoveBlock(idx, { x: f.x, y: f.y })
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const SNAP = 0.02
    // Snap targets: canvas centre, safe-zone margins, and every OTHER text block's
    // position (element-to-element alignment). Report the matched fraction so the
    // parent draws a guide line exactly there — not just at centre.
    const others = (slide.blocks || [])
      .map((b, i) => (i !== idx && (b.text || '').trim() ? blockFraction(b, theme, skipZone) : null))
      .filter(Boolean)
    const XT = [0.5, 0.08, 0.92, ...others.map((o) => o.x)]
    const YT = [0.5, 0.08, 0.92, ...others.map((o) => o.y)]
    let moved = false
    function move(ev) {
      if (!moved) { moved = true; onDragging?.(true) }   // reveal guides on real drag
      let x = Math.max(0.06, Math.min(0.94, (ev.clientX - rect.left) / rect.width))
      let y = Math.max(0.06, Math.min(0.94, (ev.clientY - rect.top) / rect.height))
      let gx = null, gy = null
      for (const t of XT) { if (Math.abs(x - t) < SNAP) { x = t; gx = t; break } }
      for (const t of YT) { if (Math.abs(y - t) < SNAP) { y = t; gy = t; break } }
      onSnap?.({ x: gx, y: gy })
      onMoveBlock(idx, { x, y })
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) { onDragging?.(false); onSnap?.({ x: null, y: null }) }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const contentCount = (slide.blocks || []).filter(
    (b) => WHOOP_CONTENT.has(b.role) && (b.text || '').trim()
  ).length
  const skipZone = theme?.layout === 'photo' && contentCount > 1
  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 rounded-xl">
      {(slide.blocks || []).map((b, idx) => {
        const editing = editingIdx === idx
        if (!(b.text || '').trim() && !editing) return null
        const f = blockFraction(b, theme, skipZone)
        const sel = selection.type === 'text' && selection.idx === idx
        const w = Math.max(0.2, Math.min(1, Number.isFinite(b.width) ? b.width : 0.72))
        const tbBelow = f.y < 0.22
        return (
          <div
            key={idx}
            onPointerDown={(e) => startDrag(e, idx, f)}
            onDoubleClick={(e) => { e.stopPropagation(); onSelectBlock(idx); setEditingIdx(idx) }}
            title={editing ? '' : 'Drag to place · double-click to edit'}
            className={`pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded ${editing ? 'cursor-text' : 'cursor-move'} ${
              sel ? 'border-2 border-dashed border-primary bg-primary/5' : 'border border-transparent hover:border-white/70 hover:bg-white/5'
            }`}
            style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${w * 100}%`, minHeight: '8%' }}
          >
            {editing ? (
              // Mirror the block's own style so editing stays WYSIWYG — the canvas
              // suppresses this block's text while editing, so this overlay is the
              // sole render. Highlight a word for the per-word styling toolbar.
              <RichTextEditOverlay
                block={b}
                idx={idx}
                onCommit={onSetRuns}
                onDone={() => setEditingIdx(null)}
                baseStyle={{
                  color: b.color || '#ffffff',
                  textAlign: b.align === 'left' ? 'left' : b.align === 'right' ? 'right' : 'center',
                  fontWeight: b.fontWeight || 700,
                  fontStyle: b.italic ? 'italic' : 'normal',
                  textTransform: (typeof b.uppercase === 'boolean' ? b.uppercase : b.role === 'hook') ? 'uppercase' : 'none',
                  textShadow: '0 2px 8px rgba(0,0,0,.6)',
                }}
              />
            ) : sel ? (
              <FloatingTextToolbar block={b} idx={idx} below={tbBelow} onSetStyle={onSetStyle} stop={stop} />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// ── Caption section — post caption, collapsed by default (written last, like IG)
// ── Real Quotes — verbatim lines from the source interview ────────────────────
// Shows the actual words the clinician said that grounded this post.
// Tapping a quote inserts it as a body text block on the active slide.
function RealQuotesSection({ pieceId, onInsertQuote }) {
  const { data: quotes = [], isLoading } = useVerbatimQuotes(pieceId)

  if (!isLoading && quotes.length === 0) return null

  return (
    <div>
      <div className="pb-2 flex items-center justify-between">
        <span className="text-sm font-bold uppercase tracking-wide text-foreground/80 flex items-center gap-1.5">
          <Type className="h-4 w-4" /> Real quotes
        </span>
        <span className="text-xs text-muted-foreground">from your interview · tap to add</span>
      </div>
      {isLoading ? (
        <div className="pb-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-2">
          {quotes.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => onInsertQuote?.(q.quote)}
              className="w-full text-left rounded-lg border border-l-[3px] border-l-verbatim-accent bg-card px-3 py-2.5 text-sm leading-snug text-foreground hover:bg-verbatim-accent/5 transition-colors"
            >
              <span className="text-xs font-bold uppercase tracking-wide text-verbatim-accent block mb-1">● verbatim</span>
              &ldquo;{q.quote}&rdquo;
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Accordion layer row ────────────────────────────────────────────────────────
// ── Caption panel (the "Words" rail tool) ─────────────────────────────────────
// Renders inside the inspector when the Words tool is selected.

function CaptionPanel({ piece, onUseAsHook, updateItem }) {
  const [draft, setDraft] = useState(() => (typeof piece?.content === 'string' ? piece.content : ''))
  const savedRef = useRef(draft)

  useEffect(() => {
    const next = typeof piece?.content === 'string' ? piece.content : ''
    setDraft(next)
    savedRef.current = next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece?.id])

  async function handleBlur() {
    if (draft === savedRef.current) return
    try {
      await updateItem.mutateAsync({ id: piece.id, patch: { content: draft } })
      savedRef.current = draft
    } catch (e) {
      toast.error('Caption save failed', { description: e.message })
    }
  }

  // Not every platform caps captions (see CAPTION_LIMITS) — only warn when
  // the destination actually enforces one. GBP silently truncates over-limit
  // text at publish time (api/_routes/publish/buffer.js), so this is the only
  // place the author can see and fix it before that happens.
  const limit = CAPTION_LIMITS[piece?.platform]
  const overLimit = limit ? draft.length > limit : false
  const nearLimit = limit ? !overLimit && draft.length > limit * 0.9 : false

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-foreground/80">
          <Type className="h-4 w-4" /> Caption
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <textarea
          aria-label="Caption"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          placeholder="Caption visible to followers…"
          className="min-h-[160px] flex-1 w-full resize-none rounded-xl border bg-muted/40 px-3 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:bg-background focus:border-primary focus:outline-none"
        />
        {overLimit && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              {PLATFORM_META[piece.platform]?.label || 'This platform'} caps captions at {limit} characters — the last {draft.length - limit} will be cut off when published.
            </span>
          </div>
        )}
        <div className="flex shrink-0 items-center justify-between">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  const firstLine = (draft || '').split('\n')[0].trim()
                  if (firstLine) onUseAsHook(firstLine)
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
              >
                ↑ Use as slide hook
              </button>
            </TooltipTrigger>
            <TooltipContent>Copy the first line of the caption into slide 1&apos;s hook text block</TooltipContent>
          </Tooltip>
          <span className={`text-sm ${overLimit ? 'text-destructive font-semibold' : nearLimit ? 'text-warning font-semibold' : 'text-muted-foreground'}`}>
            {limit ? `${draft.length} / ${limit}` : `${draft.length} chars`}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Mini slide render — a real renderFreeformSlide miniature for the theme grid
// (so theme tiles look like what they actually produce, not a placeholder). The
// canvas bitmap is set by the renderer; CSS scales it down. `renderKey` gates
// re-renders so we don't redraw 6 canvases on every keystroke.

function MiniSlideCanvas({ renderSlide, photoUrl, brandStyle, theme, renderKey }) {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    renderFreeformSlide({
      sourceUrl: photoUrl || null,
      slide: renderSlide,
      brandStyle: brandStyle || {},
      canvas: c,
      theme,
      width: SLIDE_W,
      height: SLIDE_H,
    }).catch(() => { /* thumbnail render best-effort */ })
    // renderKey encodes every input that affects the pixels — intentional sole dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey])
  return <canvas ref={ref} className="block h-full w-full" />
}

// One template tile — a real rendered miniature of the active slide in that
// template. Module scope (react-hooks/static-components); reused by both the
// Photo-templates and Text-cards groups in the picker.
function ThemeTile({ t, slide, photoUrl, brandStyle, customThemes, thumbSig, onChange }) {
  const resolved = resolveTheme(t.id, customThemes)
  const selected = slide.template_id === t.id
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onChange({ ...slide, template_id: t.id })}
          className={`group relative overflow-hidden rounded-md border text-left transition-all ${
            selected ? 'border-verbatim-accent ring-1 ring-verbatim-accent/40' : 'border-border hover:border-primary/40'
          }`}
        >
          <div className="aspect-[4/5] w-full bg-muted">
            <MiniSlideCanvas
              renderSlide={slide}
              photoUrl={photoUrl}
              brandStyle={brandStyle}
              theme={resolved}
              renderKey={`${t.id}|${thumbSig}`}
            />
          </div>
          <div className="px-2 py-1.5 text-xs font-medium truncate text-foreground">{t.name}</div>
          {selected && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-verbatim-accent ring-1 ring-verbatim-accent/40" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{`${t.name}${selected ? ' (this slide only)' : ''}`}</TooltipContent>
    </Tooltip>
  )
}

// ── SLIDE inspector body — layout + theme (nothing else selected) ────────────

function SlideInspector({
  slide, slideIdx, totalSlides, photoUrl, brandStyle, allThemes, customThemes, globalThemeId,
  onChange, onApplyThemeToAll, onAddBlock, onMoveLeft, onMoveRight, onRemove,
}) {
  const [addOpen, setAddOpen] = useState(false)
  // Signature of everything (besides the theme) that changes a thumbnail's pixels.
  const thumbSig = `${photoUrl || ''}|${slide.photo_zoom || 1}|${slide.photo_offset ? `${slide.photo_offset.x},${slide.photo_offset.y}` : ''}|${slide.blocks.map((b) => `${b.role}:${b.text}`).join('~')}`
  return (
    <div className="space-y-5">
      {/* Slide management — reorder + delete this slide */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onMoveLeft}
          disabled={slideIdx === 0}
          className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Move slide earlier"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="flex-1 text-center text-sm font-semibold">
          Slide {slideIdx + 1} <span className="font-normal text-muted-foreground">of {totalSlides}</span>
        </span>
        <button
          type="button"
          onClick={onMoveRight}
          disabled={slideIdx === totalSlides - 1}
          className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Move slide later"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={totalSlides <= 1}
          className="ml-1 rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground"
          aria-label="Delete slide"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Theme — visual swatch grid with deck inheritance */}
      <div className="space-y-3">
        <p className="text-sm font-bold uppercase tracking-wide text-foreground/80">
          Theme <span className="font-normal normal-case text-muted-foreground/70">· colour &amp; style</span>
        </p>
        <button
          type="button"
          onClick={() => onChange({ ...slide, template_id: null })}
          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors ${
            !slide.template_id
              ? 'border-primary bg-primary/10 text-primary font-semibold'
              : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/40'
          }`}
        >
          <span>Same as deck</span>
          {!slide.template_id && <span className="text-xs">✓ inheriting</span>}
        </button>
        {/* Two families: Photo templates (full-bleed photo + overlay) and Text
            cards (no photo, branded). Family derived via templateFamily. */}
        <p className="pt-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground/80">
          Photo templates <span className="font-normal normal-case text-muted-foreground/60">· full-bleed photo</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          {allThemes.filter((t) => templateFamily(resolveTheme(t.id, customThemes)) === 'photo').map((t) => (
            <ThemeTile key={t.id} t={t} slide={slide} photoUrl={photoUrl} brandStyle={brandStyle} customThemes={customThemes} thumbSig={thumbSig} onChange={onChange} />
          ))}
        </div>
        <p className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground/80">
          Text cards <span className="font-normal normal-case text-muted-foreground/60">· no photo</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          {allThemes.filter((t) => templateFamily(resolveTheme(t.id, customThemes)) === 'text').map((t) => (
            <ThemeTile key={t.id} t={t} slide={slide} photoUrl={photoUrl} brandStyle={brandStyle} customThemes={customThemes} thumbSig={thumbSig} onChange={onChange} />
          ))}
        </div>
        <button
          type="button"
          onClick={() => onApplyThemeToAll(slide.template_id || globalThemeId)}
          className="w-full rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          Apply this theme to all slides
        </button>
      </div>

      {/* Add text block */}
      <div className="space-y-2">
        <p className="text-sm font-bold uppercase tracking-wide text-foreground/80">Text</p>
        <div className="relative">
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            className="w-full rounded-lg border border-dashed border-primary/60 bg-primary/5 px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            <Plus className="inline h-4 w-4 -mt-0.5 mr-1" />
            Add text block
          </button>
          {addOpen && (
            <div className="absolute left-0 right-0 z-40 mt-1 rounded-lg border bg-popover p-1.5 shadow-lg">
              {BLOCK_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => { onAddBlock(role); setAddOpen(false) }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${ROLE_META[role].chip}`}>
                    {ROLE_META[role].label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Click any layer above, or the photo/text on the canvas, to edit it.
        </p>
      </div>
    </div>
  )
}

// ── SWAP / ADD A PHOTO — the media-attach capability lifted from the choose-
// media screen (StoryboardPiece) INTO the editor's Photo inspector. AI picks +
// describe-the-shot search (both via /api/content-items/suggest-media) and the
// Library/Upload picker (MediaPicker). Selecting any of them ATTACHES the photo
// to media_urls and rebinds the active slide via onAttach. Photos only here —
// the carousel renderer only draws stills (videos publish as Reels).

// One lightweight suggestion thumbnail (avoids importing the heavy CandidateCard).
function SuggestionThumb({ clip, attached, attaching, onAttach }) {
  const thumb = clip.thumbnailUrl || clip.blobUrl || clip.url
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={attaching}
          onClick={onAttach}
          className={`group relative aspect-square overflow-hidden rounded-xl border-2 transition-all ${
            attached ? 'border-primary' : 'border-border hover:border-primary'
          }`}
        >
          {thumb
            ? <img src={thumb} alt="" className="h-full w-full object-cover" />
            : <div className="flex h-full w-full items-center justify-center bg-muted"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>}
          <span className="absolute left-2 top-2 rounded-md bg-primary px-1.5 py-0.5 text-xs font-bold leading-tight text-primary-foreground">AI</span>
          <span className={`absolute inset-0 flex items-center justify-center bg-black/40 text-white transition-opacity ${attaching ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            {attaching ? <Loader2 className="h-7 w-7 animate-spin" /> : attached ? <Check className="h-7 w-7" /> : <Plus className="h-7 w-7" />}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{attached ? 'Already in this post — click to use it on this slide' : 'Use this photo'}</TooltipContent>
    </Tooltip>
  )
}

function SwapAddPhoto({ pieceId, attachedKeys, onAttach, onCancel }) {
  const [tab, setTab] = useState('ai')          // 'ai' | 'library'
  const [pickerOpen, setPickerOpen] = useState(false)
  const [attachingKey, setAttachingKey] = useState(null)
  // Describe-the-shot — a manual query into the same suggest-media brain.
  const [shotQ, setShotQ] = useState('')
  const [shotRes, setShotRes] = useState(null)
  const [shotLoading, setShotLoading] = useState(false)

  // AI picks — photos only. Lazily fetched (only when this panel renders).
  const { data: sugg, isLoading: suggLoading, isError: suggError, refetch } =
    useMediaSuggestions(pieceId, { enabled: !!pieceId, kind: 'photo', k: 6 })

  async function attach(entry) {
    const key = mediaEntryKey(entry)
    setAttachingKey(key)
    try {
      // Always call through — onAttach (attachPhoto) dedupes the media_urls add
      // and rebinds THIS slide, so picking an already-attached photo reuses it
      // on the current slide (per-slide model; reuse across slides is allowed).
      await onAttach(entry)
    } finally {
      setAttachingKey(null)
    }
  }

  async function runShotSearch() {
    const q = shotQ.trim()
    if (!q || shotLoading) return
    setShotLoading(true)
    try {
      const resp = await apiFetch('/api/content-items/suggest-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pieceId, query: q, k: 6, kind: 'photo' }),
      })
      setShotRes(resp?.clips || [])
    } catch (e) {
      toast.error('Search failed', { description: e?.message })
    } finally {
      setShotLoading(false)
    }
  }
  function clearShot() { setShotRes(null); setShotQ('') }

  // A describe-the-shot search overrides the automatic ranking until cleared.
  const autoClips = (sugg?.clips || [])
  const clips = shotRes ?? autoClips

  function handlePicked(asset) {
    setPickerOpen(false)
    const list = (Array.isArray(asset) ? asset : [asset]).filter(Boolean)
    // Photos only — the carousel renderer can't draw video frames.
    const photo = list.map(pickerItemToMediaEntry).find((e) => e.type !== 'video')
    if (!photo) {
      toast.warning('Pick a photo — carousels are photo-only')
      return
    }
    attach(photo)
  }

  const tabBtn = (k, label, Icon) => (
    <button
      type="button"
      onClick={() => setTab(k)}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
        tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4" />{label}
    </button>
  )

  return (
    <div className="space-y-3">
      <p className="text-sm font-bold uppercase tracking-wide text-foreground/80">Swap / add a photo</p>
      <div className="flex gap-1.5 rounded-xl border border-border p-1">
        {tabBtn('ai', 'AI picks', Sparkles)}
        {tabBtn('library', 'Library', FolderOpen)}
      </div>

      {tab === 'ai' ? (
        <div className="space-y-2.5">
          {/* Describe the shot — manual query into the same picks brain */}
          <div className="flex items-center gap-2 rounded-xl border border-input bg-background px-3.5 py-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              type="text"
              aria-label="Describe the shot"
              value={shotQ}
              onChange={(e) => setShotQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runShotSearch() }}
              placeholder="Describe the shot…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              disabled={shotLoading}
            />
            {shotRes != null && (
              <button type="button" onClick={clearShot} className="shrink-0 text-xs font-medium text-primary hover:underline">clear</button>
            )}
            {shotLoading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          </div>

          {suggLoading && shotRes == null ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : suggError && shotRes == null ? (
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t load picks.{' '}
              <button type="button" onClick={() => refetch()} className="text-primary hover:underline">Try again</button>
            </p>
          ) : clips.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-5 text-center text-sm text-muted-foreground">
              {shotRes != null ? `Nothing matched “${shotQ}”.` : 'No photo picks — browse your library instead.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {clips.slice(0, 6).map((clip) => {
                const key = clip.assetId || clip.blobUrl || clip.url
                return (
                  <SuggestionThumb
                    key={clip.chunkId || key}
                    clip={clip}
                    attached={attachedKeys.has(clip.assetId)}
                    attaching={attachingKey === key}
                    onAttach={() => attach(clipToMediaEntry(clip))}
                  />
                )
              })}
            </div>
          )}
          <p className="text-sm text-muted-foreground">Picks re-rank from your words. Click one to attach &amp; bind it.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/60 bg-primary/5 px-3 py-5 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            <Upload className="h-4 w-4" />
            Browse library / upload
          </button>
          <p className="text-sm text-muted-foreground">Search your whole library or upload a new photo.</p>
        </div>
      )}

      {pickerOpen && (
        <MediaPicker onClose={() => setPickerOpen(false)} onSelect={handlePicked} />
      )}

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          cancel — keep current photo
        </button>
      )}
    </div>
  )
}

// ── PHOTO inspector body — swap/add + bind + reframe + colorist ──────────────

// Draw a photo into a tiny offscreen canvas and read its pixels. Used by
// Auto-adjust and the "from photo" swatches. Vercel Blob serves CORS-enabled
// images (the publish bake reads the same canvas), so pixel reads don't taint.
async function sampleImagePixels(url, size = 48) {
  const img = await new Promise((res, rej) => {
    const im = new Image(); im.crossOrigin = 'anonymous'
    im.onload = () => res(im); im.onerror = rej; im.src = url
  })
  const w = size
  const h = Math.max(1, Math.round(size * ((img.naturalHeight || img.height) / (img.naturalWidth || img.width) || 1)))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h).data
}
// One-tap enhance: push mean luminance toward a mid target + add contrast when
// the image is flat + a gentle vibrance. Falls back to a clean-bright preset if
// the pixels can't be read.
async function autoGradeFromImage(url) {
  try {
    const data = await sampleImagePixels(url, 48)
    let sum = 0, sumSq = 0, n = 0
    for (let i = 0; i < data.length; i += 4) {
      const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
      sum += l; sumSq += l * l; n++
    }
    const mean = n ? sum / n : 0.5
    const std = Math.sqrt(Math.max(0, (n ? sumSq / n : 0) - mean * mean))
    const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)))
    return normalizeGrade({ exposure: cl((0.56 - mean) * 140, -40, 45), contrast: cl((0.19 - std) * 180, 0, 34), saturation: 12, depth: 6 })
  } catch { return normalizeGrade(GRADE_VIBES[0].params) }
}
// A handful of dominant colours from the photo, so text can match the image.
async function paletteFromImage(url, count = 4) {
  try {
    const data = await sampleImagePixels(url, 40)
    const buckets = new Map()
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue
      const key = ((data[i] >> 5) << 10) | ((data[i + 1] >> 5) << 5) | (data[i + 2] >> 5)
      const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 }
      e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]
      buckets.set(key, e)
    }
    const hx = (v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')
    return [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, count).map((e) => `#${hx(e.r / e.n)}${hx(e.g / e.n)}${hx(e.b / e.n)}`)
  } catch { return [] }
}

function PhotoInspector({ slide, photoUrl, mediaUrls, pieceId, attachedKeys, onAttachPhoto, onChange, singleSlide = false }) {
  // One photo control: the slide's current photo + Replace, or an empty state
  // that prompts a pick. Picking ALWAYS attaches+binds in one step (per-slide
  // model) — the old "use an attached photo" pool dropdown is gone. `replacing`
  // reveals the picker over an existing photo; reset when the active slide changes.
  const [replacing, setReplacing] = useState(false)
  useEffect(() => { setReplacing(false) }, [photoUrl])
  const [vibePrompt, setVibePrompt] = useState('')
  const [proposing, setProposing] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)

  const hasPhoto = !!photoUrl
  const photoThumb = (typeof slide.photo_idx === 'number' && mediaUrls[slide.photo_idx]?.thumbnailUrl) || photoUrl

  const grade = slide.grade || NEUTRAL_GRADE
  const graded = !isNeutralGrade(grade)
  function setGradeParam(key, value) {
    onChange({ ...slide, grade: normalizeGrade({ ...grade, [key]: Number(value) }) })
  }
  function applyVibe(params) {
    onChange({ ...slide, grade: normalizeGrade(params) })
  }
  function resetGrade() {
    const s = { ...slide }; delete s.grade; onChange(s)
  }
  async function runAutoAdjust() {
    if (autoBusy || !photoUrl) return
    setAutoBusy(true)
    try {
      const g = await autoGradeFromImage(photoUrl)
      onChange({ ...slide, grade: normalizeGrade(g) })
      toast.success('Auto-adjusted — fine-tune below')
    } finally {
      setAutoBusy(false)
    }
  }
  function removePhoto() {
    const s = { ...slide }; s.photo_idx = null; onChange(s)
  }
  async function proposeFromText() {
    const prompt = vibePrompt.trim()
    if (!prompt || proposing) return
    setProposing(true)
    try {
      const res = await apiFetch('/api/editorial/propose-grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      if (res?.params) {
        onChange({ ...slide, grade: normalizeGrade(res.params) })
        toast.success('Look applied — fine-tune below')
      } else {
        toast.error('Could not read a look from that')
      }
    } catch (err) {
      toast.error('Describe-a-look failed', { description: err?.message })
    } finally {
      setProposing(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5" style={{ background: 'hsl(var(--primary)/.08)' }}>
        <ImageIcon className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold text-primary">This slide&apos;s photo</span>
      </div>

      {singleSlide && (
        <p className="flex items-start gap-2 rounded-xl border border-dashed border-muted-foreground/30 px-3 py-2.5 text-sm leading-snug text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          This platform supports one photo — picking a new one replaces this one.
        </p>
      )}

      {/* The slide's photo — the photo IS the control: click it to open the
          picker (replace), the corner ✕ removes it. Picking attaches+binds in
          one step (per-slide model). Empty state prompts the first pick. */}
      {hasPhoto ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setReplacing((o) => !o)}
            className={`group relative block aspect-[4/5] w-full overflow-hidden rounded-2xl border-2 transition-colors ${
              replacing ? 'border-primary' : 'border-border hover:border-primary'
            }`}
            aria-label="Replace this photo"
          >
            <img src={photoUrl || photoThumb} alt="Photo on this slide" className="absolute inset-0 h-full w-full object-cover" />
            <span className={`absolute inset-0 flex items-center justify-center gap-2 text-base font-semibold text-white transition-opacity ${replacing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} style={{ background: 'rgba(12,17,29,.42)' }}>
              <Repeat className="h-5 w-5" />
              {replacing ? 'Choose below…' : 'Click to replace'}
            </span>
            {graded && (
              <span className="absolute bottom-2.5 left-2.5 rounded-md bg-primary/90 px-2 py-0.5 text-xs font-semibold text-primary-foreground">Graded</span>
            )}
          </button>
          <button
            type="button"
            onClick={removePhoto}
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-destructive"
            style={{ background: 'rgba(12,17,29,.55)' }}
            title="Remove photo"
            aria-label="Remove photo"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-primary/50 bg-primary/5 px-4 py-8 text-center">
          <ImagePlus className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="text-base font-semibold text-primary">Add a photo to this slide</p>
          <p className="mt-1 text-sm text-muted-foreground">Pick from AI picks, your library, or upload — it lands straight on the slide.</p>
        </div>
      )}

      {/* Picker — AI picks · describe-the-shot · library/upload. Shown over the
          empty state, or behind "Replace" for an existing photo. */}
      {(!hasPhoto || replacing) && (
        <SwapAddPhoto
          pieceId={pieceId}
          attachedKeys={attachedKeys}
          onAttach={onAttachPhoto}
          onCancel={hasPhoto ? () => setReplacing(false) : null}
        />
      )}

      {/* Reframe (zoom + reset). Drag-to-pan happens on the canvas. */}
      {photoUrl && (
        <div className="space-y-2">
          <p className="text-sm font-bold uppercase tracking-wide text-foreground/80">Frame</p>
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <span className="shrink-0">Zoom</span>
            <input
              type="range"
              min="1"
              max="4"
              step="0.01"
              value={slide.photo_zoom || 1}
              onChange={(e) => onChange({ ...slide, photo_zoom: parseFloat(e.target.value) })}
              className="h-5 flex-1 accent-primary"
              aria-label="Photo zoom"
            />
            {(slide.photo_zoom > 1 || slide.photo_offset) && (
              <button
                type="button"
                onClick={() => { const s = { ...slide }; delete s.photo_zoom; delete s.photo_offset; onChange(s) }}
                className="shrink-0 font-medium text-primary hover:underline"
              >
                reset
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">Slider far-left = whole photo fits (blurred backdrop fills the rest); zoom in to crop. Drag the photo to reposition · scroll to zoom.</p>
        </div>
      )}

      {/* AI Photo Editor — the colorist. Describe a vibe, tap a preset, or fine-
          tune the five essentials. Same param schema as the server bake. */}
      {photoUrl && (
        <div className="space-y-3 border-t border-border/60 pt-4">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            <span className="text-sm font-bold uppercase tracking-wide text-primary">AI Photo Editor</span>
            {graded && (
              <button type="button" onClick={resetGrade} className="ml-auto text-sm text-muted-foreground hover:text-foreground hover:underline">
                reset
              </button>
            )}
          </div>

          {/* One-tap auto-adjust — samples the photo, sets a gentle grade */}
          <button
            type="button"
            onClick={runAutoAdjust}
            disabled={autoBusy}
            className="flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-semibold disabled:opacity-60"
            style={{ borderColor: 'hsl(var(--action))', background: 'hsl(var(--action)/0.08)', color: 'hsl(var(--action))' }}
          >
            {autoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Auto-adjust lighting
          </button>

          {/* Describe the look */}
          <div className="flex gap-2">
            <input
              type="text"
              aria-label="Describe the grade or look"
              value={vibePrompt}
              onChange={(e) => setVibePrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') proposeFromText() }}
              placeholder="Describe a look — e.g. bright, warm, clinical"
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary/50"
              disabled={proposing}
            />
            <button
              type="button"
              onClick={proposeFromText}
              disabled={proposing || !vibePrompt.trim()}
              className="shrink-0 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {proposing ? '…' : 'Apply'}
            </button>
          </div>

          {/* One-tap vibes */}
          <div className="flex flex-wrap gap-2">
            {GRADE_VIBES.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => applyVibe(v.params)}
                className="rounded-full border border-border px-3.5 py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Fine-tune essentials */}
          <div className="space-y-3 pt-1">
            {GRADE_SLIDERS.map((s) => {
              const val = Number(grade[s.key]) || 0
              return (
                <div key={s.key}>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{s.label}</span>
                    <span>{val > 0 ? '+' : ''}{val}</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    value={val}
                    onChange={(e) => setGradeParam(s.key, e.target.value)}
                    className="h-5 w-full accent-primary"
                    aria-label={s.label}
                  />
                </div>
              )
            })}
          </div>
          <p className="text-sm text-muted-foreground">Applies to this photo. The same grade ships in the published post.</p>
        </div>
      )}
    </div>
  )
}

// ── TEXT inspector body — single block via the shared BlockRow ───────────────

// Per-block text styling — Size / Colour / Weight / Case / Font. All optional;
// "Auto" clears the override so the block inherits the role + theme (renderer
// precedence: block > theme > role). The swatch palette is the brand set.
const TEXT_COLORS = [
  { label: 'White',  value: '#ffffff' },
  { label: 'Navy',   value: '#0c1a2e' },
  { label: 'Sage',   value: '#83957c' },
  { label: 'Orange', value: '#e8843c' },
  { label: 'Paper',  value: '#f6f4ef' },
  { label: 'Black',  value: '#111111' },
]
function SegRow({ label, options, value, onPick }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex gap-1.5">
        {options.map((o) => {
          const active = value === o.value || (value == null && o.value == null)
          return (
            <button
              key={o.label}
              type="button"
              onClick={() => onPick(o.value)}
              className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
function TextStyleControls({ block, onSet, photoPalette = [] }) {
  const workspace = useWorkspace()
  const swatches = useMemo(() => [...brandSwatches(workspace), ...photoPalette, ...NEUTRAL_SWATCHES], [workspace, photoPalette])
  const scale = Number.isFinite(block.fontScale) && block.fontScale > 0 ? block.fontScale : 1
  return (
    <div className="space-y-3.5 rounded-xl border border-border/60 p-3.5">
      <p className="text-sm font-bold uppercase tracking-wide text-foreground/80">Style</p>

      {/* Size */}
      <div>
        <div className="mb-1 flex justify-between text-sm text-muted-foreground">
          <span>Size</span><span>{Math.round(scale * 100)}%</span>
        </div>
        <input
          type="range" min="0.6" max="1.8" step="0.05" value={scale}
          onChange={(e) => onSet('fontScale', parseFloat(e.target.value))}
          className="h-5 w-full accent-primary" aria-label="Text size"
        />
      </div>

      {/* Text width (wrap width) — 100% = Auto (role default) */}
      <div>
        <div className="mb-1 flex justify-between text-sm text-muted-foreground">
          <span>Text width</span>
          <span>{Number.isFinite(block.width) && block.width > 0 ? `${Math.round(block.width * 100)}%` : 'Auto'}</span>
        </div>
        <input
          type="range" min="0.3" max="1" step="0.05"
          value={Number.isFinite(block.width) && block.width > 0 ? block.width : 1}
          onChange={(e) => { const v = parseFloat(e.target.value); onSet('width', v >= 1 ? null : v) }}
          className="h-5 w-full accent-primary" aria-label="Text width"
        />
      </div>

      {/* Colour */}
      <div>
        <p className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Colour</p>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button" onClick={() => onSet('color', null)}
                className={`h-8 rounded-lg px-2.5 text-sm font-medium ${!block.color ? 'bg-primary/10 text-primary ring-1 ring-primary' : 'bg-muted text-muted-foreground'}`}
              >Auto</button>
            </TooltipTrigger>
            <TooltipContent>Auto (theme)</TooltipContent>
          </Tooltip>
          {TEXT_COLORS.map((c) => (
            <button
              key={c.value} type="button" onClick={() => onSet('color', c.value)} aria-label={c.label}
              className={`h-8 w-8 rounded-full border ${block.color === c.value ? 'ring-2 ring-primary ring-offset-1' : 'border-border'}`}
              style={{ background: c.value }}
            />
          ))}
          <ColorPickerPopover
            value={/^#[0-9a-f]{6}$/i.test(block.color || '') ? block.color : '#ffffff'}
            onChange={(hex) => onSet('color', hex)}
            swatches={swatches}
            swatchClassName="h-8 w-8 rounded-full"
            ariaLabel="Pick custom text color"
          />
        </div>
      </div>

      {photoPalette.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">From photo</p>
          <div className="flex flex-wrap items-center gap-2">
            {photoPalette.map((c) => (
              <button
                key={c} type="button" onClick={() => onSet('color', c)} aria-label={`Photo colour ${c}`}
                className={`h-8 w-8 rounded-full border ${block.color === c ? 'ring-2 ring-primary ring-offset-1' : 'border-border'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      )}

      <SegRow
        label="Weight"
        options={[{ label: 'Auto', value: null }, { label: 'Reg', value: '400' }, { label: 'Med', value: '500' }, { label: 'Bold', value: '700' }]}
        value={block.fontWeight ?? null}
        onPick={(v) => onSet('fontWeight', v)}
      />
      <SegRow
        label="Font"
        options={[{ label: 'Auto', value: null }, { label: 'Heading', value: 'heading' }, { label: 'Body', value: 'body' }]}
        value={block.font ?? null}
        onPick={(v) => onSet('font', v)}
      />
      <SegRow
        label="Align"
        options={[{ label: 'Left', value: 'left' }, { label: 'Center', value: null }, { label: 'Right', value: 'right' }]}
        value={block.align ?? null}
        onPick={(v) => onSet('align', v)}
      />
      {/* Italic / Underline toggles */}
      <div>
        <p className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Format</p>
        <div className="flex gap-1.5">
          {[
            { key: 'italic',    label: 'I',  className: 'italic'    },
            { key: 'underline', label: 'U',  className: 'underline' },
            { key: 'uppercase', label: 'AA', className: 'uppercase' },
          ].map(({ key, label, className: cls }) => {
            const active = block[key] === true
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSet(key, active ? null : true)}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${cls} ${
                  active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Spacing — whole-box letter + line. 0 / 100% = Auto (role default). */}
      <div>
        <p className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Spacing</p>
        <div className="mb-1 flex justify-between text-sm text-muted-foreground">
          <span>Letter</span><span>{Number.isFinite(block.letterSpacing) ? block.letterSpacing : 0}</span>
        </div>
        <input
          type="range" min="-10" max="40" step="1"
          value={Number.isFinite(block.letterSpacing) ? block.letterSpacing : 0}
          onChange={(e) => { const v = parseInt(e.target.value, 10); onSet('letterSpacing', v === 0 ? null : v) }}
          className="h-5 w-full accent-primary" aria-label="Letter spacing"
        />
        <div className="mb-1 mt-2 flex justify-between text-sm text-muted-foreground">
          <span>Line</span><span>{Math.round((Number.isFinite(block.lineHeight) && block.lineHeight > 0 ? block.lineHeight : 1) * 100)}%</span>
        </div>
        <input
          type="range" min="0.8" max="2" step="0.05"
          value={Number.isFinite(block.lineHeight) && block.lineHeight > 0 ? block.lineHeight : 1}
          onChange={(e) => { const v = parseFloat(e.target.value); onSet('lineHeight', v === 1 ? null : v) }}
          className="h-5 w-full accent-primary" aria-label="Line height"
        />
      </div>

      {/* Effects — text shadow depth for legibility on photos. */}
      <SegRow
        label="Effects (shadow)"
        options={[
          { label: 'Auto', value: null },
          { label: 'None', value: 'none' },
          { label: 'Soft', value: 'soft' },
          { label: 'Med', value: 'medium' },
          { label: 'Heavy', value: 'heavy' },
        ]}
        value={block.shadow ?? null}
        onPick={(v) => onSet('shadow', v)}
      />
    </div>
  )
}

function TextInspector({ slide, blockIdx, photoUrl, onChange, onRemoved, onCenter }) {
  const block = slide.blocks[blockIdx]
  const [photoPalette, setPhotoPalette] = useState([])
  useEffect(() => {
    let live = true
    if (!photoUrl) { setPhotoPalette([]); return }
    paletteFromImage(photoUrl).then((p) => { if (live) setPhotoPalette(p) })
    return () => { live = false }
  }, [photoUrl])
  if (!block) return null
  function updateBlock(next) {
    const blocks = slide.blocks.slice()
    blocks[blockIdx] = next
    onChange({ ...slide, blocks })
  }
  function setStyle(key, val) {
    const next = { ...block }
    if (val == null || val === '' || (key === 'fontScale' && val === 1)) delete next[key]
    else next[key] = val
    updateBlock(next)
  }
  function removeBlock() {
    const blocks = slide.blocks.slice()
    blocks.splice(blockIdx, 1)
    onChange({ ...slide, blocks })
    if (onRemoved) onRemoved()
  }
  function alignBlock(h, v) {
    const cur = (typeof block.position === 'object' && block.position) ? block.position : { x: 0.5, y: 0.5 }
    updateBlock({ ...block, position: { x: h ? 0.5 : cur.x, y: v ? 0.5 : cur.y } })
    onCenter?.()
  }
  const alignBtnCls = 'flex h-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary'
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5" style={{ background: 'hsl(var(--primary)/.08)' }}>
        <Type className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold text-primary">Text layer</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => alignBlock(true, false)} title="Center horizontally" className={`${alignBtnCls} w-8`} aria-label="Center horizontally">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5"/><rect x="2" y="5" width="10" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
          <button type="button" onClick={() => alignBlock(false, true)} title="Center vertically" className={`${alignBtnCls} w-8`} aria-label="Center vertically">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5"/><rect x="5" y="2" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
          <button type="button" onClick={() => alignBlock(true, true)} title="Center on canvas" className={`${alignBtnCls} gap-1 px-2.5 text-sm font-semibold text-primary`} style={{ borderColor: 'hsl(var(--primary)/.35)', background: 'hsl(var(--primary)/.06)' }} aria-label="Center on canvas">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><line x1="6" y1="0" x2="6" y2="12" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5"/><line x1="0" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5"/><circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>
            Center
          </button>
        </div>
      </div>
      <BlockRow
        block={block}
        onChange={updateBlock}
        onRemove={removeBlock}
      />
      <TextStyleControls block={block} onSet={setStyle} photoPalette={photoPalette} />
    </div>
  )
}

// ── Slide picker strip (floats directly under the preview photo — no bar,
// no label row, no card background; reads as part of the canvas). Each
// thumbnail carries its own hover-delete (X) so add/remove both happen right
// where you pick a slide, instead of being buried in the Slide tool's
// inspector panel. Mockup-approved: .claude/mockups/slide-picker-artifact.html

function SlidePickerStrip({ slides, activeIdx, mediaUrls, onSelect, onAdd, onRemove, canAdd = true }) {
  return (
    <div className="mt-3 flex shrink-0 items-center gap-1.5 overflow-x-auto">
      {slides.map((slide, idx) => {
        const photoUrl = typeof slide.photo_idx === 'number' && mediaUrls[slide.photo_idx]
          ? (mediaUrls[slide.photo_idx].thumbnailUrl || photoSourceUrl(mediaUrls[slide.photo_idx]))
          : null
        const isActive = idx === activeIdx
        return (
          <div key={idx} className="group relative shrink-0">
            <button
              type="button"
              onClick={() => onSelect(idx)}
              className={`relative aspect-[4/5] h-14 overflow-hidden rounded-md border transition-all ${
                isActive ? 'border-primary ring-1 ring-primary/40' : 'border-border hover:border-primary/40'
              }`}
            >
              {photoUrl
                ? <img src={photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                : <div className="absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-500" />
              }
              <div className="absolute inset-0 bg-black/15" />
              <span className="absolute left-0.5 top-0.5 rounded bg-black/55 px-1 text-3xs font-semibold leading-tight text-white">{idx + 1}</span>
              {slide.template_id && (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full" style={{ background: 'hsl(var(--action))' }} />
              )}
            </button>
            {slides.length > 1 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemove(idx) }}
                aria-label={`Delete slide ${idx + 1}`}
                className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:text-destructive group-hover:flex"
              >
                <X className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            )}
          </div>
        )
      })}
      {canAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="flex h-14 w-[45px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      ) : (
        <div className="flex h-14 w-[120px] shrink-0 items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/30 px-1.5 text-center text-3xs leading-snug text-muted-foreground/70">
          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Locked to 1 photo</span>
        </div>
      )}
    </div>
  )
}

// ── Phone-mockup preview overlay (renders the REAL slide) ────────────────────

// Per-platform chrome for the full-preview overlay — mirrors the treatments in
// PostPreview.jsx so this overlay stops always looking like Instagram
// regardless of the piece's actual target platform (facebook/linkedin/gbp
// carousels and single-visual posts all route through SlideEditor).
const OVERLAY_PLATFORM_CHROME = {
  facebook: {
    avatar: <div className="h-7 w-7 rounded-full bg-[#1877f2] flex items-center justify-center"><Facebook className="h-4 w-4 text-white" /></div>,
    actions: (
      <>
        <ThumbsUp className="h-4.5 w-4.5" />
        <MessageCircle className="h-4.5 w-4.5" />
        <Repeat2 className="ml-auto h-4.5 w-4.5" />
      </>
    ),
  },
  linkedin: {
    avatar: <div className="h-7 w-7 rounded bg-[#0a66c2] flex items-center justify-center"><Linkedin className="h-4 w-4 text-white" /></div>,
    actions: (
      <>
        <ThumbsUp className="h-4.5 w-4.5" />
        <MessageCircle className="h-4.5 w-4.5" />
        <Repeat2 className="h-4.5 w-4.5" />
        <Send className="ml-auto h-4.5 w-4.5" />
      </>
    ),
  },
  gbp: {
    avatar: <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center"><MapPin className="h-4 w-4 text-white" /></div>,
    actions: null,
  },
}
const DEFAULT_OVERLAY_CHROME = {
  avatar: (
    <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-amber-400 to-rose-500 p-[2px]">
      <div className="h-full w-full rounded-full bg-white p-[1.5px]"><div className="h-full w-full rounded-full bg-muted" /></div>
    </div>
  ),
  actions: (
    <>
      <Heart className="h-5 w-5" />
      <MessageCircle className="h-5 w-5" />
      <Send className="h-5 w-5" />
      <Bookmark className="ml-auto h-5 w-5" />
    </>
  ),
}

function FullPreviewOverlay({ slides, activeIdx, mediaUrls, brandStyle, themeId, customThemes, workspace, caption, platform, aspect = '4:5', onClose, onNav }) {
  // Keyboard navigation + ESC
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onNav(1)
      if (e.key === 'ArrowLeft') onNav(-1)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, onNav])

  const slide = slides[activeIdx]
  if (!slide) return null

  // Render the REAL slide (renderFreeformSlide via MiniSlideCanvas) inside a
  // phone frame — "how people actually see it", and identical to what publishes.
  // Replaces the old fullscreen CSS approximation, which drew a DIFFERENT look
  // from the canvas/bake (a preview != published gap).
  const photoUrl = typeof slide.photo_idx === 'number' && mediaUrls[slide.photo_idx]
    ? photoSourceUrl(mediaUrls[slide.photo_idx])
    : null
  const theme = resolveTheme(slide.template_id || themeId, customThemes)
  const handle = workspace?.slug || workspace?.display_name || 'yourbrand'
  const text = (caption || '').replace(/\s+/g, ' ').trim()
  const snippet = text.slice(0, 90)
  const chrome = OVERLAY_PLATFORM_CHROME[platform] || DEFAULT_OVERLAY_CHROME
  const stageAspect = ASPECT_STAGE[aspect]?.twAspect || 'aspect-[4/5]'
  // Re-render the canvas when anything that affects the pixels changes.
  const renderKey = [
    activeIdx, photoUrl || '', slide.template_id || themeId || '',
    (slide.blocks || []).map((b) => `${b.role}:${b.text}:${typeof b.position === 'object' ? `${b.position.x},${b.position.y}` : b.position}:${b.fontScale || ''}:${b.color || ''}:${b.fontWeight || ''}:${b.uppercase ?? ''}:${b.italic ? 'i' : ''}:${b.underline ? 'u' : ''}:${b.letterSpacing || ''}:${b.lineHeight || ''}:${b.shadow || ''}:${b.runs ? JSON.stringify(b.runs) : ''}`).join('~'),
    slide.photo_zoom || 1,
    slide.photo_offset ? `${slide.photo_offset.x},${slide.photo_offset.y}` : '',
    slide.grade ? JSON.stringify(slide.grade) : '',
  ].join('|')

  return (
    <div role="dialog" aria-modal="true" aria-label="Slide preview" className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 p-6">
      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-3 px-5 py-3">
        <Smartphone className="h-4 w-4 text-white/70" />
        <span className="text-sm font-medium text-white/90">Preview — how it’ll appear</span>
        <span className="text-xs text-white/50">{activeIdx + 1} / {slides.length}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
          aria-label="Close preview"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => onNav(-1)}
          disabled={activeIdx === 0}
          aria-label="Previous slide"
          className="h-12 w-12 shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center disabled:opacity-20 transition-colors"
        >
          <ChevronLeft className="h-7 w-7" aria-hidden="true" />
        </button>

        {/* iPhone frame with platform-specific chrome + the real rendered slide */}
        <div className="relative rounded-[2.5rem] border-[10px] border-black bg-black shadow-2xl" style={{ width: 320 }}>
          <div className="absolute left-1/2 top-0 z-20 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-black" />
          <div className="overflow-hidden rounded-[1.9rem] bg-white">
            {/* Header — avatar + handle styled per target platform */}
            <div className="flex items-center gap-2 px-3 py-2">
              {chrome.avatar}
              <span className="text-2xs font-semibold text-foreground">{handle}</span>
            </div>
            {/* The real slide */}
            <div className={`relative ${stageAspect} w-full bg-muted`}>
              <MiniSlideCanvas
                renderSlide={slide}
                photoUrl={photoUrl}
                brandStyle={brandStyle}
                theme={theme}
                renderKey={renderKey}
              />
              {slides.length > 1 && (
                <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-3xs font-semibold text-white">{activeIdx + 1}/{slides.length}</span>
              )}
            </div>
            {/* Action row — platform-specific (or omitted, e.g. GBP has none) */}
            {chrome.actions && (
              <div className="flex items-center gap-4 px-3 py-2 text-foreground" aria-hidden="true">
                {chrome.actions}
              </div>
            )}
            {slides.length > 1 && (
              <div className="flex justify-center gap-1 pb-1">
                {slides.map((_, i) => (
                  <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === activeIdx ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                ))}
              </div>
            )}
            {snippet && (
              <p className="px-3 pb-3 pt-1 text-2xs leading-snug text-foreground">
                <span className="font-semibold">{handle}</span> {snippet}{text.length > 90 ? '… ' : ' '}
                {text.length > 90 && <span className="text-muted-foreground">more</span>}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNav(1)}
          disabled={activeIdx === slides.length - 1}
          aria-label="Next slide"
          className="h-12 w-12 shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center disabled:opacity-20 transition-colors"
        >
          <ChevronRight className="h-7 w-7" aria-hidden="true" />
        </button>
      </div>

      <p className="mt-4 text-xs text-white/45">← → to navigate · Esc to close · the real rendered slide — exactly what publishes</p>
    </div>
  )
}

// Canvas stage dimensions for each output aspect ratio. Tailwind's scanner
// needs the full class strings present in source to include them in the bundle.
const ASPECT_STAGE = {
  '1:1':  { twAspect: 'aspect-[1/1]',  hFactor: 1.0 },
  '4:5':  { twAspect: 'aspect-[4/5]',  hFactor: 1.25 },
  '9:16': { twAspect: 'aspect-[9/16]', hFactor: 1.778 },
}

// ── Top-level SlideEditor ─────────────────────────────────────────────────────

export default function SlideEditor({ piece, onBack, formatLabel, formatSub, photoCount, scheduleNode, singleSlide = false, badgeIcon = null, forcedAspect = null }) {
  const workspace = useWorkspace()
  const smartBack = useSmartBack('/publish')
  const brandStyle = workspace?.brand_style || {}
  const pieceMediaUrls = piece?.media_urls
  const mediaUrls = (pieceMediaUrls || []).filter((m) => m && m.type !== 'video' && m.url)
  const hasMedia = mediaUrls.length > 0
  // Keys of every already-attached entry (photo or video) — so the swap/add
  // picks can mark which suggestions are already on the piece.
  const attachedKeys = useMemo(
    () => new Set((pieceMediaUrls || []).map(mediaEntryKey)),
    [pieceMediaUrls],
  )
  const [scheduleOpen, setScheduleOpen] = useState(false)
  // Drag-reveal guides: while a text block is being dragged we show the safe-zone
  // margins + centre snap lines (no more "safe zones" checkbox). `snap` tracks
  // which centre axis the block is currently snapped to.
  const [dragging, setDragging] = useState(false)
  const [snap, setSnap] = useState({ x: null, y: null })
  const [guidesOn, setGuidesOn] = useState(false)
  const guidesTimerRef = useRef(null)
  function flashGuides() {
    if (guidesTimerRef.current) clearTimeout(guidesTimerRef.current)
    setGuidesOn(true)
    guidesTimerRef.current = setTimeout(() => setGuidesOn(false), 800)
  }
  // Clear the flash timer on unmount so it can't fire setGuidesOn after teardown.
  useEffect(() => () => { if (guidesTimerRef.current) clearTimeout(guidesTimerRef.current) }, [])

  // Seed: stored slides if any, else one empty cover slide bound to photo 0.
  // Instagram Story rows predate the slide model — their headline/sticker text
  // lived in content/text_card (see storyFields.js). A Story with no `slides`
  // yet gets that legacy text migrated into a hook/cta block pair on first
  // open, using the 'cta' template (headline top, CTA bottom) so it doesn't
  // silently vanish when the piece opens in this editor for the first time.
  function seedSlides() {
    const stored = Array.isArray(piece?.slides) ? piece.slides : null
    if (stored && stored.length > 0) return stored.map((s, i) => normalizeSlide(s, i))
    if (piece?.platform === 'instagram_story') {
      const { overlay, sticker } = deriveStory(piece)
      const blocks = []
      if (overlay) blocks.push({ role: 'hook', text: overlay, position: defaultPositionFor('cta', 'hook') })
      if (sticker) blocks.push({ role: 'cta', text: sticker, position: defaultPositionFor('cta', 'cta') })
      return [{ photo_idx: hasMedia ? 0 : null, template: 'cta', blocks }]
    }
    return [{ photo_idx: hasMedia ? 0 : null, template: 'cover', blocks: [] }]
  }

  const [slides, setSlides] = useState(seedSlides)
  const [themeId, setThemeId] = useState(() => piece?.photo_template_id || DEFAULT_DECK_THEME)
  const [aspect, setAspect] = useState(() => forcedAspect || piece?.aspect_ratio || '4:5')
  const [activeSlideIdx, setActiveSlideIdx] = useState(0)
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false)
  const [adExportOpen, setAdExportOpen] = useState(false)
  // Contextual selection driving the canvas (photo ring + text-block drag). One of:
  //   { type: null } | { type: 'slide' } | { type: 'photo' } | { type: 'text', idx }
  const [selection, setSelection] = useState({ type: null })
  // Which text block is being edited inline on the canvas (double-click). The
  // canvas skips this block's text while editing so the inline editor doesn't
  // double up with the baked render. Reset when the active slide changes.
  const [editingBlockIdx, setEditingBlockIdx] = useState(null)
  useEffect(() => { setEditingBlockIdx(null) }, [activeSlideIdx])
  // Unified-shell rail tool — which single inspector panel is shown. Orthogonal
  // to `selection` (which drives the canvas), but picking a tool syncs an
  // appropriate selection so the canvas highlight follows the rail.
  //   'words' | 'slide' | 'photo' | 'text'
  const [tool, setTool] = useState('slide')
  const pickTool = (t) => {
    setTool(t)
    if (t === 'photo') setSelection({ type: 'photo' })
    else if (t === 'text') setSelection((s) => (s.type === 'text' ? s : { type: 'text', idx: 0 }))
    else setSelection({ type: null })
  }

  // Re-seed ONLY on a genuine piece switch (piece?.id changing) — not on every
  // `piece.slides` change. StoryboardPublish already gates rendering until
  // `piece` is loaded, so slides are never "still loading" here; once mounted,
  // local `slides` state is authoritative and autosave is what pushes it to
  // the server. Depending on `JSON.stringify(piece?.slides)` used to re-fire
  // this effect every time OUR OWN save echoed back through the query cache
  // (`useUpdateContentItem`'s onSuccess writes the saved row straight into
  // the detail query) — a delete-then-undo inside that echo's round-trip got
  // silently clobbered back to the deleted state, because the reseed fired
  // between the undo's local setSlides and the undo's own (later) autosave.
  // seedSlides()/photo_template_id/aspect_ratio still read the LATEST `piece`
  // via closure when the effect runs; they just don't need to be dependencies.
  useEffect(() => {
    const next = seedSlides()
    setSlides(next)
    setThemeId(piece?.photo_template_id || DEFAULT_DECK_THEME)
    setAspect(forcedAspect || piece?.aspect_ratio || '4:5')
    setActiveSlideIdx(0)
    setSelection({ type: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece?.id])

  // Fetch workspace custom templates for the picker
  const { data: allThemes = [] } = usePhotoTemplates()
  const customThemes = allThemes.filter((t) => t.custom)
  const theme = resolveTheme(themeId, customThemes)

  const updateItem = useUpdateContentItem()

  // Auto-attach top AI pick per slide on first open when slides have no photos.
  // A ref guards against re-firing; only fires when ALL slides are photo-less (fresh carousel).
  const autoAttachDoneRef = useRef(false)
  // k:10 covers Instagram's max carousel length (10 slides) so there are
  // enough distinct picks to avoid repeating a photo across slides.
  const { data: photoSuggestions } = useMediaSuggestions(piece?.id, { enabled: !!piece?.id, kind: 'photo', k: 10 })
  useEffect(() => {
    if (autoAttachDoneRef.current) return
    // useMediaSuggestions returns the raw suggest-media response — { clips: [...] },
    // NOT a bare array. (The Swap-photo panel reads `sugg.clips` correctly; this
    // effect previously read `photoSuggestions.length`/`[i]`, so the guard always
    // bailed and the auto-attach silently never ran — "5 slides from 0 photos".)
    // Each clip is a SUGGESTION shape ({ blobUrl, assetId, kind, … }), NOT a
    // media_urls entry — it must go through clipToMediaEntry (same as the Swap
    // panel's `attach(clipToMediaEntry(clip))`) or the stored entry has url:null
    // and mediaEntryKey (which reads mediaAssetId) can't dedup or bind it.
    const picks = (Array.isArray(photoSuggestions?.clips) ? photoSuggestions.clips : [])
      .map(clipToMediaEntry)
      .filter((e) => e && e.url && e.type !== 'video')
    if (!picks.length) return
    const allEmpty = mediaUrls.length === 0
    if (!allEmpty) { autoAttachDoneRef.current = true; return }
    autoAttachDoneRef.current = true
    const raw = Array.isArray(piece?.media_urls) ? piece.media_urls : []
    const seen = new Set(raw.map(mediaEntryKey))
    const toAdd = []
    // Straight index, NOT modulo — wrapping back into `picks` once slides
    // outnumber distinct suggestions was reusing the same photo across
    // multiple slides in one carousel. Better to leave a trailing slide
    // photo-less (the producer picks manually) than to duplicate a shot.
    for (let i = 0; i < slides.length; i++) {
      const pick = picks[i]
      if (!pick) break
      const key = mediaEntryKey(pick)
      if (!seen.has(key)) { toAdd.push(pick); seen.add(key) }
    }
    const nextRaw = [...raw, ...toAdd]
    const photoOnly = nextRaw.filter((m) => m && m.type !== 'video' && m.url)
    const newSlides = slides.map((s, i) => {
      const pick = picks[i]
      if (!pick) return s
      const idx = photoOnly.findIndex((m) => mediaEntryKey(m) === mediaEntryKey(pick))
      return idx >= 0 ? { ...s, photo_idx: idx } : s
    })
    setSlides(newSlides)
    if (toAdd.length > 0) {
      // Persist BOTH the new media_urls AND the per-slide photo_idx binding in one
      // patch. media_urls alone (the previous behavior) survives reload but the
      // binding lived only in local state until the next autosave — so a reload
      // before that tick showed "N photos" attached but unbound (auto-attach won't
      // re-fire once media is non-empty). Saving the binding here makes the
      // auto-populate durable immediately. No bake: the slide images bake on
      // the next autosave, and publish has its own render fallback (same as
      // the render-failed path).
      updateItem.mutateAsync({ id: piece.id, patch: { mediaUrls: nextRaw, slides: newSlides } }).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoSuggestions])

  const [rendering, setRendering] = useState(false)

  function updateSlide(idx, next) {
    const out = slides.slice()
    out[idx] = next
    setSlides(out)
  }
  function moveSlide(idx, dir) {
    const swap = idx + dir
    if (swap < 0 || swap >= slides.length) return
    const out = slides.slice()
    ;[out[idx], out[swap]] = [out[swap], out[idx]]
    setSlides(out)
  }
  function removeSlide(idx) {
    if (slides.length <= 1) {
      toast('A post needs at least one slide')
      return
    }
    const removed = slides[idx]
    const next = slides.filter((_, i) => i !== idx)
    setSlides(next)
    setActiveSlideIdx((prev) => Math.min(prev, Math.max(0, next.length - 1)))
    setSelection({ type: null })
    // Delete is recoverable until the next action — an undo toast instead of a
    // silent, instant, soon-permanent removal of the slide's block text.
    toast('Slide deleted', {
      action: {
        label: 'Undo',
        onClick: () => setSlides((cur) => {
          const out = cur.slice()
          out.splice(Math.min(idx, out.length), 0, removed)
          return out
        }),
      },
    })
  }
  function addSlide() {
    // New slide starts BLANK — pick a photo onto it (per-slide model). No more
    // auto-binding the next pool photo; select the Photo layer so the "Add a
    // photo" picker is front-and-centre immediately.
    const next = slides.concat([{ photo_idx: null, template: 'custom', blocks: [] }])
    setSlides(next)
    setActiveSlideIdx(next.length - 1)
    setSelection({ type: 'photo' })
  }

  // Attach a NEW photo to the piece (media_urls belongs to the content_item, not
  // the slides) and rebind the ACTIVE slide to it. media_urls is the content_item
  // field — mutate it via useUpdateContentItem, NOT the slides Save. After the
  // attach, recompute the new photo's index in the PHOTO-ONLY filtered list
  // (`photo_idx` indexes that filtered list, not raw media_urls) and bind it.
  async function attachPhoto(entry) {
    if (!entry || !piece?.id) return
    const raw = Array.isArray(piece?.media_urls) ? piece.media_urls : []
    const key = mediaEntryKey(entry)
    const already = raw.some((m) => mediaEntryKey(m) === key)
    // Single-slide posts (GBP, LinkedIn, Facebook, X, …) support exactly one
    // photo — replace media_urls outright instead of appending, or every swap
    // leaves the previous photo orphaned in the array (no slide references it,
    // but it's still there). GBP's Local Post API hard-rejects >1 media item
    // at publish time (400) — 3 accumulated swaps → 3 media_urls → publish
    // failure. Multi-slide carousels keep the append/reuse behavior.
    const nextRaw = singleSlide ? [entry] : (already ? raw : [...raw, entry])
    const noop = singleSlide ? (raw.length === 1 && already) : already
    try {
      if (!noop) {
        await updateItem.mutateAsync({ id: piece.id, patch: { mediaUrls: nextRaw } })
      }
      // Index in the photo-only filtered list (videos excluded) — the same filter
      // the editor uses for `mediaUrls`/`photo_idx` everywhere.
      const photoOnly = nextRaw.filter((m) => m && m.type !== 'video' && m.url)
      const photoIdx = photoOnly.findIndex((m) => mediaEntryKey(m) === key)
      if (photoIdx >= 0) {
        setSlides((cur) => cur.map((s, i) => (i === activeSlideIdx ? { ...s, photo_idx: photoIdx } : s)))
      }
      if (singleSlide && !already && raw.length > 0) {
        toast.success('Photo replaced', { description: 'This platform supports one photo — the previous photo was removed.' })
      } else {
        toast.success(already ? 'Photo swapped' : 'Photo attached')
      }
    } catch (e) {
      toast.error('Could not attach photo', { description: e?.message })
    }
  }

  // Switch the active slide and close all accordion rows.
  function goToSlide(idx) {
    setActiveSlideIdx(idx)
    setSelection({ type: null })
  }

  // "Apply this theme to all slides" — set the deck theme to the chosen one and
  // clear every per-slide override so the whole deck reads uniformly again.
  function handleApplyThemeToAll(themeIdToApply) {
    const id = themeIdToApply || DEFAULT_DECK_THEME
    setThemeId(id)
    setSlides((prev) => prev.map((s) => (s.template_id ? { ...s, template_id: null } : s)))
    toast.success('Theme applied to all slides')
  }

  function handleUseAsHook(text) {
    const slide0 = slides[0]
    if (!slide0) return
    const hookIdx = slide0.blocks.findIndex((b) => b.role === 'hook')
    let newBlocks
    if (hookIdx >= 0) {
      newBlocks = slide0.blocks.map((b, i) => (i === hookIdx ? { ...b, text } : b))
    } else {
      newBlocks = [{ role: 'hook', text, position: defaultPositionFor(slide0.template, 'hook') }, ...slide0.blocks]
    }
    const out = slides.slice()
    out[0] = { ...slide0, blocks: newBlocks }
    setSlides(out)
    setActiveSlideIdx(0)
    setSelection({ type: 'text', idx: hookIdx >= 0 ? hookIdx : 0 })
    toast.success('Hook updated — Save to bake')
  }

  // Draft snapshot shared by autosave + undo/redo — the wholesale-restorable
  // shape of "what this editor persists" (slide content, theme, aspect).
  const draftState = useMemo(() => ({ slides, themeId, aspect }), [slides, themeId, aspect])

  // Autosave — bakes each slide (photo + on-screen text) into an image and
  // uploads it, so the overlay actually ships at publish, then persists the
  // slide/theme/aspect patch. Debounced by useAutosave; retries automatically
  // on the next edit if the render step fails (text is saved either way).
  async function saveDraft(next) {
    const cleaned = next.slides.map((s) => ({
      photo_idx: typeof s.photo_idx === 'number' ? s.photo_idx : null,
      template:  s.template,
      // Preserve the per-slide theme override. Without this it was silently
      // dropped on save — the picker set slide.template_id, the resolver and the
      // bake honored it, but this rebuilt slides without it, so a per-slide
      // theme never persisted. (P0 data-loss fix.)
      template_id: s.template_id || null,
      // Persist the photo reframe (pan/zoom) so it survives reload and ships in
      // the bake. Omit when neutral to keep rows lean + legacy slides identical.
      ...(s.photo_zoom > 1 ? { photo_zoom: s.photo_zoom } : {}),
      ...(s.photo_offset && (s.photo_offset.x || s.photo_offset.y)
        ? { photo_offset: { x: s.photo_offset.x || 0, y: s.photo_offset.y || 0 } }
        : {}),
      // Persist the colorist grade; omit when neutral so legacy slides stay lean.
      ...(s.grade && !isNeutralGrade(s.grade) ? { grade: normalizeGrade(s.grade) } : {}),
      blocks:    s.blocks.filter((b) => (b.text || '').trim() !== ''),
    }))

    let toPersist = cleaned
    let renderFailed = false
    setRendering(true)
    try {
      const { slides: rendered } = await ensureRenderedSlides({
        slides:    cleaned,
        mediaUrls: piece?.media_urls,
        brandStyle,
        theme:     resolveTheme(next.themeId, customThemes),
        themeId:   next.themeId,
        customThemes,
        pieceId:   piece.id,
        aspect:    next.aspect,
      })
      toPersist = rendered
    } catch (e) {
      // Never lose the user's text on a render/upload hiccup — persist the slide
      // data anyway. Publish has its own render fallback, and the next autosave retries.
      renderFailed = true
      console.warn('[SlideEditor] slide render failed, saving text only', e.message)
    } finally {
      setRendering(false)
    }

    await updateItem.mutateAsync({
      id: piece.id,
      patch: { slides: toPersist, photo_template_id: next.themeId || null, aspectRatio: next.aspect },
    })
    if (renderFailed) {
      toast.error('Saved, but slide images need a retry', { description: 'Text is safe — the next autosave will retry baking the on-screen text into the images.' })
    }
  }

  const { status: saveStatus } = useAutosave(draftState, saveDraft, { debounceMs: 1500, resetKey: piece?.id })
  const { undo, redo, canUndo, canRedo } = useUndoHistory(draftState, (snap) => {
    setSlides(snap.slides)
    setThemeId(snap.themeId)
    setAspect(snap.aspect)
  })
  useUndoRedoShortcut(undo, redo)

  // Version history (WS5) — auto-snapshot the slide draft (throttled ~3 min,
  // pruned to 30 server-side) + restore a past version.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [revisions, setRevisions] = useState([])
  const lastRevRef = useRef(0)
  function applyDoc(d) {
    if (!d || typeof d !== 'object') return
    if (Array.isArray(d.slides)) setSlides(d.slides)
    if (d.themeId !== undefined) setThemeId(d.themeId)
    if (d.aspect) setAspect(d.aspect)
  }
  useEffect(() => {
    if (!piece?.id) return
    const now = Date.now()
    if (now - lastRevRef.current < 180000) return
    lastRevRef.current = now
    saveRevision('slides', piece.id, draftState).catch(() => {})
  }, [draftState, piece?.id])
  async function openHistory() {
    if (historyOpen) { setHistoryOpen(false); return }
    try { const r = await listRevisions('slides', piece.id); setRevisions(r?.revisions || []) } catch { setRevisions([]) }
    setHistoryOpen(true)
  }

  // Active slide derived values — used by the canvas and the inspector.
  const activeSlide = slides[activeSlideIdx] || slides[0]
  const activePhotoUrl = typeof activeSlide?.photo_idx === 'number' && mediaUrls[activeSlide.photo_idx]
    ? photoSourceUrl(mediaUrls[activeSlide.photo_idx])
    : null
  const activeTheme = resolveTheme(activeSlide?.template_id || themeId, customThemes)

  function goBack() {
    if (onBack) onBack()
    else smartBack()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {fullPreviewOpen && (
        <FullPreviewOverlay
          slides={slides}
          activeIdx={activeSlideIdx}
          mediaUrls={mediaUrls}
          brandStyle={brandStyle}
          themeId={themeId}
          customThemes={customThemes}
          workspace={workspace}
          caption={piece?.content}
          platform={piece?.platform}
          aspect={forcedAspect || aspect}
          onClose={() => setFullPreviewOpen(false)}
          onNav={(delta) => setActiveSlideIdx((prev) => Math.max(0, Math.min(slides.length - 1, prev + delta)))}
        />
      )}
      {adExportOpen && (
        <AdCarouselExportModal
          piece={piece}
          slides={slides}
          mediaUrls={piece?.media_urls}
          brandStyle={brandStyle}
          theme={theme}
          themeId={themeId}
          customThemes={customThemes}
          onClose={() => setAdExportOpen(false)}
        />
      )}

      {/* Schedule & publish — folded into the top bar, opens here */}
      {scheduleNode && (
        <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Schedule &amp; publish</DialogTitle>
            </DialogHeader>
            {scheduleNode}
          </DialogContent>
        </Dialog>
      )}

      {/* ── TOP BAR — shared EditorChrome (unified shell) ─────────────────── */}
      <EditorChrome
        onBack={goBack}
        title={piece?.topic}
        badge={{ icon: badgeIcon || Instagram, label: formatLabel || 'Instagram Carousel', sub: formatSub || `${slides.length} slides` }}
        note={photoCount != null && photoCount !== slides.length
          ? `${slides.length} slides from ${photoCount} photo${photoCount === 1 ? '' : 's'}`
          : null}
        aspect={forcedAspect ? null : { value: aspect, options: ['1:1', '4:5', '9:16'], onChange: setAspect }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setFullPreviewOpen(true)}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Smartphone className="mr-1 inline h-3.5 w-3.5" />
              Preview
            </button>
          </TooltipTrigger>
          <TooltipContent>Preview as Instagram</TooltipContent>
        </Tooltip>
        {hasMedia && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setAdExportOpen(true)}
                className="rounded-lg border border-action/40 px-2.5 py-1.5 text-xs text-action hover:bg-action/10 transition-colors"
              >
                <Megaphone className="mr-1 inline h-3.5 w-3.5" />
                Ads
              </button>
            </TooltipTrigger>
            <TooltipContent>Render into ad sizes</TooltipContent>
          </Tooltip>
        )}
        <UndoRedoButtons canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
        <SaveStatus status={rendering ? 'saving' : saveStatus} />
        {/* Version history — auto-snapshots + restore */}
        <div className="relative">
          <button onClick={openHistory} className="flex h-8 items-center gap-1 rounded-lg border px-2 text-sm text-muted-foreground hover:border-primary/60 hover:text-primary" style={{ borderColor: 'hsl(var(--border))' }} title="Version history" aria-label="Version history"><History className="h-4 w-4" /></button>
          {historyOpen && (
            <>
              <div className="fixed inset-0 z-30" aria-hidden="true" onClick={() => setHistoryOpen(false)} />
              <div role="menu" aria-label="Version history" className="absolute right-0 top-full z-40 mt-1 max-h-72 w-64 overflow-auto rounded-lg border border-border bg-card p-1.5 shadow-lg">
                <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Version history</p>
                {revisions.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">No saved versions yet — they appear as you edit.</p>
                ) : revisions.map((rv) => (
                  <button key={rv.id} onClick={() => { applyDoc(rv.doc); setHistoryOpen(false); toast.success('Restored a previous version') }} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <span>{new Date(rv.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    <span className="font-medium text-primary">Restore</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* Approve · voice check · publish — inline, no modal or backing out.
            The full Publish panel (export, metrics, schedule details) stays one
            click away behind the sliders button for the cases the bar can't
            cover (export-only channels, published metrics). */}
        <EditorWorkflowBar piece={piece} />
        {scheduleNode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setScheduleOpen(true)}
                className="rounded-lg border border-border px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Full publish panel"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Full publish panel — export, metrics, schedule details</TooltipContent>
          </Tooltip>
        )}
      </EditorChrome>

      {/* ── WORK AREA: rail | inspector | canvas ─────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* 1. Icon rail — unified shell; picks the single inspector panel */}
        {activeSlide && (
          <EditorIconRail
            items={[
              { key: 'words', icon: MessageCircle, label: 'Words' },
              { key: 'slide', icon: Layers, label: 'Slide' },
              { key: 'photo', icon: ImageIcon, label: 'Media' },
              { key: 'text', icon: Type, label: 'Text' },
            ]}
            active={tool}
            onPick={pickTool}
          />
        )}

        {/* 2. Inspector — single panel chosen by the rail */}
        <aside className="flex w-[480px] shrink-0 flex-col border-r bg-card overflow-hidden">
          {!activeSlide ? (
            <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
              Add a slide to start editing
            </div>
          ) : tool === 'words' ? (
            <CaptionPanel piece={piece} onUseAsHook={handleUseAsHook} updateItem={updateItem} />
          ) : (
            <>
              {/* Slide N of M + prev/next nav */}
              <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
                <span className="text-sm font-semibold">Slide {activeSlideIdx + 1} of {slides.length}</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveSlideIdx((i) => Math.max(0, i - 1))}
                    disabled={activeSlideIdx === 0}
                    className="rounded-lg border px-2 py-1 text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSlideIdx((i) => Math.min(slides.length - 1, i + 1))}
                    disabled={activeSlideIdx === slides.length - 1}
                    className="rounded-lg border px-2 py-1 text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {tool === 'slide' && (
                  <SlideInspector
                    slide={activeSlide}
                    slideIdx={activeSlideIdx}
                    totalSlides={slides.length}
                    photoUrl={activePhotoUrl}
                    brandStyle={brandStyle}
                    allThemes={allThemes}
                    customThemes={customThemes}
                    globalThemeId={themeId}
                    onChange={(next) => updateSlide(activeSlideIdx, next)}
                    onApplyThemeToAll={handleApplyThemeToAll}
                    onAddBlock={(role) => {
                      const blocks = activeSlide.blocks.concat(emptyBlockFor(activeSlide.template, role))
                      updateSlide(activeSlideIdx, { ...activeSlide, blocks })
                      setTool('text'); setSelection({ type: 'text', idx: blocks.length - 1 })
                    }}
                    onMoveLeft={() => {
                      moveSlide(activeSlideIdx, -1)
                      setActiveSlideIdx((i) => Math.max(0, i - 1))
                    }}
                    onMoveRight={() => {
                      moveSlide(activeSlideIdx, 1)
                      setActiveSlideIdx((i) => Math.min(slides.length - 1, i + 1))
                    }}
                    onRemove={() => removeSlide(activeSlideIdx)}
                  />
                )}

                {tool === 'photo' && (
                  <PhotoInspector
                    slide={activeSlide}
                    photoUrl={activePhotoUrl}
                    mediaUrls={mediaUrls}
                    pieceId={piece?.id}
                    attachedKeys={attachedKeys}
                    onAttachPhoto={attachPhoto}
                    onChange={(next) => updateSlide(activeSlideIdx, next)}
                    singleSlide={singleSlide}
                  />
                )}

                {tool === 'text' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      {activeSlide.blocks.map((b, i) => {
                        const meta = ROLE_META[b.role] || ROLE_META.body
                        const snippet = (b.text || '').trim().slice(0, 22)
                        const on = selection.type === 'text' && selection.idx === i
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setSelection({ type: 'text', idx: i })}
                            className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${on ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}
                          >
                            <span className={`shrink-0 text-xs font-semibold uppercase tracking-wide ${on ? 'text-primary' : 'text-muted-foreground'}`}>{meta.label}</span>
                            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{snippet || 'Empty'}{snippet && b.text.trim().length > 22 ? '…' : ''}</span>
                          </button>
                        )
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          const blocks = activeSlide.blocks.concat(emptyBlockFor(activeSlide.template, 'body'))
                          updateSlide(activeSlideIdx, { ...activeSlide, blocks })
                          setSelection({ type: 'text', idx: blocks.length - 1 })
                        }}
                        className="w-full rounded-lg border border-dashed border-border px-3 py-2.5 text-sm font-medium text-primary hover:bg-muted transition-colors"
                      >
                        + Add text block
                      </button>
                    </div>

                    {selection.type === 'text' && activeSlide.blocks[selection.idx] && (
                      <div className="border-t pt-4">
                        <TextInspector
                          slide={activeSlide}
                          blockIdx={selection.idx}
                          photoUrl={activePhotoUrl}
                          onChange={(next) => updateSlide(activeSlideIdx, next)}
                          onRemoved={() => setSelection({ type: null })}
                          onCenter={flashGuides}
                        />
                      </div>
                    )}

                    <div className="border-t pt-3">
                      <RealQuotesSection
                        pieceId={piece?.id}
                        onInsertQuote={(text) => {
                          if (!activeSlide) return
                          const blocks = activeSlide.blocks.concat({ role: 'body', text, position: defaultPositionFor(activeSlide.template, 'body') })
                          updateSlide(activeSlideIdx, { ...activeSlide, blocks })
                          setSelection({ type: 'text', idx: blocks.length - 1 })
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>

        {/* 3. Canvas — centre, takes remaining space. The photo box is bounded by
            BOTH viewport height and width (min(...)) so it letterboxes instead of
            overflowing either axis. Constants leave room for the top bar + the
            slide picker strip sitting directly under the photo (height), and the
            icon rail + inspector (width). */}
        <section className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-5" style={{ background: 'hsl(var(--muted))' }}>
          {activeSlide ? (
            <div className="flex flex-col items-center">
              <div
                className={`relative ${ASPECT_STAGE[aspect]?.twAspect ?? 'aspect-[4/5]'} rounded-xl ${selection.type === 'photo' ? 'ring-[2.5px] ring-primary ring-offset-2 ring-offset-muted' : ''}`}
                style={{ height: `min(calc(100vh - 210px), calc((100vw - 470px) * ${ASPECT_STAGE[aspect]?.hFactor ?? 1.25}))` }}
              >
                <SlidePreview
                  slide={editingBlockIdx != null ? { ...activeSlide, blocks: activeSlide.blocks.map((b, i) => (i === editingBlockIdx ? { ...b, text: '' } : b)) } : activeSlide}
                  photoUrl={activePhotoUrl}
                  brandStyle={brandStyle}
                  theme={activeTheme}
                  aspect={aspect}
                  onReframe={(next) => updateSlide(activeSlideIdx, next)}
                  onSelectPhoto={() => { setSelection({ type: 'photo' }); setTool('photo') }}
                  className={`h-full w-full rounded-xl border bg-muted shadow-lg ${activePhotoUrl ? 'cursor-move' : 'cursor-pointer'}`}
                />
                {/* Draggable text-layer handles — click to select, drag to place */}
                <TextDragLayer
                  slide={activeSlide}
                  theme={activeTheme}
                  selection={selection}
                  editingIdx={editingBlockIdx}
                  setEditingIdx={setEditingBlockIdx}
                  onDragging={setDragging}
                  onSnap={setSnap}
                  onSelectBlock={(idx) => { setSelection({ type: 'text', idx }); setTool('text') }}
                  onMoveBlock={(idx, pos) => updateSlide(activeSlideIdx, {
                    ...activeSlide,
                    blocks: activeSlide.blocks.map((b, i) => (i === idx ? { ...b, position: pos } : b)),
                  })}
                  onSetStyle={(idx, key, val) => updateSlide(activeSlideIdx, {
                    ...activeSlide,
                    blocks: activeSlide.blocks.map((b, i) => {
                      if (i !== idx) return b
                      const nb = { ...b }
                      if (val == null || val === '' || (key === 'fontScale' && val === 1)) delete nb[key]
                      else nb[key] = val
                      return nb
                    }),
                  })}
                  onSetRuns={(idx, { text, runs }) => updateSlide(activeSlideIdx, {
                    ...activeSlide,
                    blocks: activeSlide.blocks.map((b, i) => {
                      if (i !== idx) return b
                      const nb = { ...b, text }
                      // Per-word style lives in runs; drop the key when the edit
                      // left no styled runs so the row stays clean (renderer falls
                      // back to the block's base typography).
                      if (runs && runs.length) nb.runs = runs
                      else delete nb.runs
                      return nb
                    }),
                  })}
                />
                {/* Drag-reveal guides — safe-zone margins appear while dragging text;
                    centre lines light up when the block snaps to centre. The Center
                    button also flashes them briefly (guidesOn). */}
                <div className="pointer-events-none absolute inset-0 rounded-xl" aria-hidden="true">
                  <div className="absolute inset-0 transition-opacity duration-200" style={{ opacity: dragging ? 1 : 0 }}>
                    <div className="absolute inset-[7%] rounded border border-dashed border-white/50" />
                    <div className="absolute inset-x-0 top-0 h-[10%] bg-rose-500/10" />
                    <div className="absolute inset-x-0 bottom-0 h-[14%] bg-rose-500/10" />
                  </div>
                  {snap.y != null && <div className="absolute inset-x-0 h-px -translate-y-px bg-primary/80" style={{ top: `${snap.y * 100}%` }} />}
                  {snap.x != null && <div className="absolute inset-y-0 w-px -translate-x-px bg-primary/80" style={{ left: `${snap.x * 100}%` }} />}
                  {guidesOn && (
                    <>
                      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-px bg-primary/70" />
                      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-px bg-primary/70" />
                    </>
                  )}
                  <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary transition-opacity duration-150" style={{ opacity: guidesOn ? 1 : 0, boxShadow: '0 0 0 2px white' }} />
                </div>
              </div>

              {/* 4. Slide picker — floats directly under the photo, no bar */}
              <SlidePickerStrip
                slides={slides}
                activeIdx={activeSlideIdx}
                mediaUrls={mediaUrls}
                onSelect={goToSlide}
                onAdd={addSlide}
                onRemove={removeSlide}
                canAdd={!singleSlide}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No slides yet</p>
          )}
        </section>
      </div>
    </div>
  )
}
