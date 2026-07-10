import { useEffect, useMemo, useRef, useState } from 'react'
import { useSmartBack } from '@/lib/useSmartBack'
import { toast } from 'sonner'
import { X, Plus, Image as ImageIcon, Layers, Megaphone, Smartphone, SlidersHorizontal, Instagram, Type, ChevronLeft, ChevronRight, Heart, MessageCircle, Send, Bookmark, Facebook, Linkedin, ThumbsUp, Repeat2, MapPin, Lock, AlertTriangle, History, BadgeCheck } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUpdateContentItem, usePhotoTemplates, useMediaSuggestions } from '@/lib/queries'
import { useWorkspace } from '@/lib/WorkspaceContext'
import {
  textEffectCss,
  renderFreeformSlide,
  SLIDE_W,
  SLIDE_H,
} from '@/lib/overlayTemplates'
import { resolveTheme, DEFAULT_DECK_THEME } from '@/lib/photoTemplates'
import { normalizeGrade, isNeutralGrade } from '@/lib/gradeParams'
import { ensureRenderedSlides, AD_CAROUSEL_DIMS } from '@/lib/renderSlides'
import { photoSourceUrl, clipToMediaEntry, mediaEntryKey } from '@/lib/mediaEntry'
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
import {
  ROLE_META,
  normalizeSlide,
  richRunsToHTML,
  serializeRichCE,
  runsHaveStyle,
  richFlagsAt,
  wrapSelectionInSpan,
  unwrapIfBare,
  RICH_SIZE_STEPS,
  RICH_CASES,
  RICH_CASE_CSS,
  RICH_FONTS,
  RICH_FONT_CSS,
  defaultPositionFor,
  emptyBlockFor,
  WHOOP_CONTENT,
  blockFraction,
  TEXT_COLORS,
  ASPECT_STAGE,
} from './slide-editor/shared'
import MiniSlideCanvas from './slide-editor/MiniSlideCanvas'
import FloatingTextToolbar from './slide-editor/FloatingTextToolbar'
import RealQuotesSection from './slide-editor/RealQuotesSection'
import ObjectInspector from './slide-editor/ObjectInspector'
import SlideInspector from './slide-editor/SlideInspector'
import PhotoInspector from './slide-editor/PhotoInspector'
import TextInspector from './slide-editor/TextInspector'

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
                  // WS3.2: mirror the block's text effect so editing stays WYSIWYG
                  // with the baked canvas (falls back to a legible shadow).
                  ...textEffectCss(b, {}, 40),
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

// ── Object drag layer (WS3.1) ────────────────────────────────────────────────
// Transparent hit-targets over the canvas for the objects layer (logo/watermark
// today). The canvas (renderFreeformSlide → drawSlideObject) is the truth; this
// layer only handles selection + drag, reusing the SAME snap targets as text
// (canvas centre, safe margins, and every other element's position) so objects
// align to text and to each other. An invisible <img> sizes the hit box to the
// logo's real footprint so the selection ring matches what's drawn.
function ObjectDragLayer({ slide, selection, onSelectObject, onMoveObject, onDragging, onSnap }) {
  const rootRef = useRef(null)
  const objects = slide.objects || []
  function startDrag(e, idx) {
    e.stopPropagation()
    e.preventDefault()
    onSelectObject(idx)
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const SNAP = 0.02
    const others = [
      ...(slide.blocks || []).filter((b) => (b.text || '').trim() && typeof b.position === 'object')
        .map((b) => b.position),
      ...objects.filter((_, i) => i !== idx).map((o) => ({ x: o.x, y: o.y })),
    ].filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
    const XT = [0.5, 0.08, 0.92, ...others.map((o) => o.x)]
    const YT = [0.5, 0.08, 0.92, ...others.map((o) => o.y)]
    let moved = false
    function move(ev) {
      if (!moved) { moved = true; onDragging?.(true) }
      let x = Math.max(0.04, Math.min(0.96, (ev.clientX - rect.left) / rect.width))
      let y = Math.max(0.04, Math.min(0.96, (ev.clientY - rect.top) / rect.height))
      let gx = null, gy = null
      for (const t of XT) { if (Math.abs(x - t) < SNAP) { x = t; gx = t; break } }
      for (const t of YT) { if (Math.abs(y - t) < SNAP) { y = t; gy = t; break } }
      onSnap?.({ x: gx, y: gy })
      onMoveObject(idx, { x, y })
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) { onDragging?.(false); onSnap?.({ x: null, y: null }) }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 rounded-xl">
      {objects.map((o, idx) => {
        const sel = selection.type === 'object' && selection.idx === idx
        return (
          <div
            key={o.id || idx}
            onPointerDown={(e) => startDrag(e, idx)}
            title="Drag to place"
            className={`pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 cursor-move items-center justify-center rounded ${
              sel ? 'border-2 border-dashed border-primary bg-primary/5' : 'border border-transparent hover:border-white/70 hover:bg-white/5'
            }`}
            style={{ left: `${(o.x ?? 0.82) * 100}%`, top: `${(o.y ?? 0.9) * 100}%`, width: `${(o.scale ?? 0.16) * 100}%` }}
          >
            {/* Invisible — the canvas draws the real logo; this only sizes the box. */}
            <img src={o.src} alt="" draggable="false" className="pointer-events-none block h-auto w-full select-none opacity-0" />
          </div>
        )
      })}
    </div>
  )
}

// ── Caption section — post caption, collapsed by default (written last, like IG)
// ── Accordion layer row ────────────────────────────────────────────────────────
// ── Caption panel (the "Words" rail tool) ─────────────────────────────────────
// Renders inside the inspector when the Words tool is selected.

function CaptionPanel({ piece, onUseAsHook, updateItem }) {
  const [draft, setDraft] = useState(() => (typeof piece?.content === 'string' ? piece.content : ''))
  const savedRef = useRef(draft)
  const taRef = useRef(null)

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
      {/* Clicking the panel's padding/gaps (outside the textarea's own box) used
          to be a dead click; focus the field so any click in the caption area
          lands the cursor in it. Guard on currentTarget so clicks on the button
          row / warning don't steal focus. */}
      <div
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
        onClick={(e) => { if (e.target === e.currentTarget) taRef.current?.focus() }}
      >
        <textarea
          ref={taRef}
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
    (slide.blocks || []).map((b) => `${b.role}:${b.text}:${typeof b.position === 'object' ? `${b.position.x},${b.position.y}` : b.position}:${b.fontScale || ''}:${b.color || ''}:${b.fontWeight || ''}:${b.uppercase ?? ''}:${b.italic ? 'i' : ''}:${b.underline ? 'u' : ''}:${b.letterSpacing || ''}:${b.lineHeight || ''}:${b.shadow || ''}:${b.textEffect || ''}:${b.effectIntensity || ''}:${b.effectColor || ''}:${b.runs ? JSON.stringify(b.runs) : ''}`).join('~'),
    (slide.objects || []).map((o) => `${o.type}:${o.src}:${o.x},${o.y}:${o.scale}:${o.opacity}`).join('~'),
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
    else if (t === 'object') setSelection((s) => (s.type === 'object' ? s : { type: 'object', idx: 0 }))
    else setSelection({ type: null })
  }
  // Workspace logo for the objects layer — same resolver PostPreview uses
  // (primary_logo_url is derived by /api/workspace/me from brand_kit_roles).
  const workspaceLogo = workspace?.primary_logo_url ?? workspace?.logo?.main ?? null

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

  // Magic Resize (WS2): switching aspect pulls any hand-placed text back into the
  // new format's safe zone so it never lands in the crop. Idempotent (clamps into
  // a margin) so switching back and forth is stable; preset-positioned blocks
  // already resolve per-aspect in the renderer, so only custom {x,y} blocks move.
  function reflowForAspect(sl) {
    return (sl || []).map((s) => ({
      ...s,
      blocks: (s.blocks || []).map((b) => {
        const p = b.position
        if (p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
          const x = Math.max(0.1, Math.min(0.9, p.x))
          const y = Math.max(0.12, Math.min(0.88, p.y))
          return (x !== p.x || y !== p.y) ? { ...b, position: { x, y } } : b
        }
        return b
      }),
    }))
  }
  function changeAspect(next) {
    if (!next || next === aspect) return
    setSlides((prev) => reflowForAspect(prev))
    setAspect(next)
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
        aspect={forcedAspect ? null : { value: aspect, options: ['1:1', '4:5', '9:16'], onChange: changeAspect }}
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
              { key: 'object', icon: BadgeCheck, label: 'Logo' },
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

                {tool === 'object' && (
                  <div className="space-y-4">
                    <button
                      type="button"
                      disabled={!workspaceLogo}
                      onClick={() => {
                        const objects = (activeSlide.objects || []).concat({
                          id: `obj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                          type: 'logo', mark: 'primary', src: workspaceLogo,
                          x: 0.82, y: 0.9, scale: 0.16, opacity: 1,
                        })
                        updateSlide(activeSlideIdx, { ...activeSlide, objects })
                        setSelection({ type: 'object', idx: objects.length - 1 })
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <BadgeCheck className="h-4 w-4" /> Add logo / watermark
                    </button>
                    {!workspaceLogo && (
                      <p className="text-xs text-muted-foreground">No logo in your Brand Kit yet. Add one in Settings → Brand Kit and it&apos;ll appear here.</p>
                    )}
                    {(activeSlide.objects || []).length > 0 && (
                      <div className="space-y-2">
                        {(activeSlide.objects || []).map((o, i) => {
                          const on = selection.type === 'object' && selection.idx === i
                          return (
                            <button
                              key={o.id || i} type="button"
                              onClick={() => setSelection({ type: 'object', idx: i })}
                              className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${on ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}
                            >
                              <img src={o.src} alt="" className="h-6 w-auto max-w-[60px] object-contain" />
                              <span className="text-sm text-muted-foreground">Logo {i + 1}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {selection.type === 'object' && (activeSlide.objects || [])[selection.idx] && (
                      <div className="border-t pt-4">
                        <ObjectInspector
                          slide={activeSlide}
                          objIdx={selection.idx}
                          onChange={(next) => updateSlide(activeSlideIdx, next)}
                          onRemoved={() => setSelection({ type: null })}
                        />
                      </div>
                    )}
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
        <section
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-5"
          style={{ background: 'hsl(var(--muted))' }}
          // Click the empty stage (letterbox/padding) to deselect — turns a dead
          // zone into the standard Canva/Figma "click canvas to dismiss" gesture.
          // e.target === e.currentTarget so bubbled clicks from the canvas, text /
          // object handles, and the picker strip don't fire it.
          onClick={(e) => { if (e.target === e.currentTarget && selection.type) setSelection({ type: null }) }}
        >
          {activeSlide ? (
            <div
              className="flex flex-col items-center"
              onClick={(e) => { if (e.target === e.currentTarget && selection.type) setSelection({ type: null }) }}
            >
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
                {/* Draggable objects layer — logo/watermark hit-targets (WS3.1) */}
                <ObjectDragLayer
                  slide={activeSlide}
                  selection={selection}
                  onDragging={setDragging}
                  onSnap={setSnap}
                  onSelectObject={(idx) => { setSelection({ type: 'object', idx }); setTool('object') }}
                  onMoveObject={(idx, pos) => updateSlide(activeSlideIdx, {
                    ...activeSlide,
                    objects: (activeSlide.objects || []).map((o, i) => (i === idx ? { ...o, x: pos.x, y: pos.y } : o)),
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
