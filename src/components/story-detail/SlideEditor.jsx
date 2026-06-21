import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { X, Plus, Image as ImageIcon, ImagePlus, Repeat, Move, Layers, Megaphone, ArrowLeft, Smartphone, CalendarClock, Instagram, Type, ChevronLeft, ChevronRight, Wand2, Sparkles, FolderOpen, Upload, Search, Loader2, Check, Heart, MessageCircle, Send, Bookmark } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { ensureRenderedSlides } from '@/lib/renderSlides'
import { photoSourceUrl, clipToMediaEntry, pickerItemToMediaEntry, mediaEntryKey } from '@/lib/mediaEntry'
import AdCarouselExportModal from '@/components/AdCarouselExportModal'

// Role label + chip colors. Mirrors the mockup palette.
const ROLE_META = {
  hook:        { label: 'Hook',        chip: 'bg-amber-100 text-amber-800' },
  body:        { label: 'Body',        chip: 'bg-primary/10 text-primary' },
  caption:     { label: 'Caption',     chip: 'bg-primary/10 text-primary' },
  cta:         { label: 'CTA',         chip: 'bg-muted text-muted-foreground' },
  attribution: { label: 'Attribution', chip: 'bg-muted text-muted-foreground' },
  page:        { label: 'Page #',      chip: 'bg-slate-200 text-slate-700' },
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
          ...(Array.isArray(b?.runs) && b.runs.some((r) => r.color) ? { runs: b.runs } : {}),
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

// Convert block.runs → innerHTML for the contenteditable field.
function runsToHTML(runs, text) {
  if (!Array.isArray(runs) || !runs.some((r) => r.color)) return escapeHtml(text || '')
  return runs.map((r) => {
    const t = escapeHtml(r.text)
    return r.color ? `<span style="color:${r.color}">${t}</span>` : t
  }).join('')
}

// Walk a contenteditable element's DOM → [{text, color?}] runs.
// Handles <font color="…"> (execCommand in most browsers) and <span style="color:…">.
function serializeCE(el) {
  const runs = []
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) runs.push({ text: node.textContent })
      return
    }
    if (node.nodeName === 'BR') { runs.push({ text: '\n' }); return }
    const color = node.nodeName === 'FONT' && node.getAttribute('color')
      ? cssColorToHex(node.getAttribute('color'))
      : node.style?.color ? cssColorToHex(node.style.color) : null
    if (color) {
      const text = node.textContent
      if (text) runs.push({ text, color })
    } else {
      node.childNodes.forEach(walk)
    }
  }
  el.childNodes.forEach(walk)
  // Merge adjacent runs with identical colour
  const merged = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && last.color === (r.color || undefined)) { last.text += r.text }
    else merged.push(r.color ? { text: r.text, color: r.color } : { text: r.text })
  }
  return merged
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
    ceRef.current.innerHTML = runsToHTML(block.runs, block.text)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function serializeAndSync() {
    if (suppressRef.current) return
    const el = ceRef.current
    if (!el) return
    const runs = serializeCE(el)
    const text = runs.map((r) => r.text).join('')
    const hasColor = runs.some((r) => r.color)
    const result = { ...block, text }
    if (hasColor) result.runs = runs
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
    <div className="flex items-start gap-2 rounded-md border bg-background/50 p-2">
      <div className="flex-1 min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <select
            value={block.role}
            onChange={(e) => onChange({ ...block, role: e.target.value })}
            className={`rounded-full px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide ${meta.chip} border border-transparent cursor-pointer`}
          >
            {BLOCK_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_META[r]?.label || r}</option>
            ))}
          </select>
          <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-rose-600" title="Delete block">
            <X className="h-3.5 w-3.5" />
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
                key={color} type="button" title={color} onClick={() => applyColor(color)}
                className="h-5 w-5 rounded-full border border-zinc-600 transition-all hover:ring-2 hover:ring-white/40 hover:ring-offset-1"
                style={{ background: color }}
              />
            ))}
            {bSwatches.length > 0 && <span className="mx-0.5 h-4 w-px bg-zinc-700" />}
            {['#FFFFFF', '#000000'].map((c) => (
              <button
                key={c} type="button" title={c === '#FFFFFF' ? 'White' : 'Black'} onClick={() => applyColor(c)}
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
          className="w-full rounded border border-input bg-background px-2 py-1 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/50 empty:before:text-muted-foreground/50 empty:before:content-[attr(data-placeholder)]"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '2rem' }}
          data-placeholder={`${meta.label} text…`}
        />
        <p className="mt-1 flex items-center gap-1 text-3xs text-muted-foreground">
          <Move className="h-3 w-3" /> Drag the text on the canvas to place it. Highlight text to pick a colour.
        </p>
      </div>
    </div>
  )
}

// ── Slide card ────────────────────────────────────────────────────────────────

function SlidePreview({ slide, photoUrl, brandStyle, theme, onReframe, onSelectPhoto, className }) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const movedRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    async function draw() {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        await renderFreeformSlide({
          sourceUrl: photoUrl || null,
          slide,
          brandStyle: brandStyle || {},
          canvas,
          theme,
          width: SLIDE_W,
          height: SLIDE_H,
        })
      } catch (e) {
        if (!cancelled) console.warn('[SlidePreview] render failed', e.message)
      }
    }
    draw()
    return () => { cancelled = true }
  }, [slide, photoUrl, brandStyle, theme])

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
function blockFraction(block, theme) {
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
  if (zone && WHOOP_CONTENT.has(block.role)) {
    y = row === 'top' ? zone[0] : row === 'bottom' ? zone[1] : (zone[0] + zone[1]) / 2
  }
  return { x, y }
}

// Draggable text-layer handles overlaid on the active canvas. Each text block
// is a box you click to select and drag to place (free x/y) — text is a layer
// like any other, no position presets. The canvas underneath is the true render.
function TextDragLayer({ slide, theme, selection, onSelectBlock, onMoveBlock }) {
  const rootRef = useRef(null)
  function startDrag(e, idx, f) {
    e.stopPropagation()
    e.preventDefault()
    onSelectBlock(idx)
    // Convert preset position to custom {x,y} immediately so there's no jump
    // when the first pointermove fires. blockFraction already accounts for WHOOP
    // zone offsets, so this custom position renders at the same visual spot.
    if (f) onMoveBlock(idx, { x: f.x, y: f.y })
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    function move(ev) {
      const x = Math.max(0.06, Math.min(0.94, (ev.clientX - rect.left) / rect.width))
      const y = Math.max(0.06, Math.min(0.94, (ev.clientY - rect.top) / rect.height))
      onMoveBlock(idx, { x, y })
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 rounded-xl">
      {(slide.blocks || []).map((b, idx) => {
        if (!(b.text || '').trim()) return null
        const f = blockFraction(b, theme)
        const sel = selection.type === 'text' && selection.idx === idx
        const w = Math.max(0.2, Math.min(1, Number.isFinite(b.width) ? b.width : 0.72))
        return (
          <div
            key={idx}
            onPointerDown={(e) => startDrag(e, idx, f)}
            title="Drag to place"
            className={`pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 cursor-move items-center justify-center rounded ${
              sel ? 'border-2 border-dashed border-primary bg-primary/5' : 'border border-transparent hover:border-white/70 hover:bg-white/5'
            }`}
            style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${w * 100}%`, minHeight: '8%' }}
          >
            {sel && (
              <span className="absolute -top-5 left-0 inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-3xs font-semibold text-primary-foreground">
                <Move className="h-2.5 w-2.5" />{ROLE_META[b.role]?.label || b.role}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Caption section — post caption, collapsed by default (written last, like IG)
function CaptionSection({ piece, onUseAsHook, updateItem }) {
  const [draft, setDraft] = useState(() => (typeof piece?.content === 'string' ? piece.content : ''))
  const [open, setOpen] = useState(false)
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

  return (
    <div className="border-t">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-3xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/50"
      >
        <span className="flex items-center gap-1.5">
          <Type className="h-3 w-3" /> Caption
        </span>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            rows={5}
            placeholder="Caption visible to followers…"
            className="w-full resize-y rounded-md border bg-muted/40 px-2 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:bg-background focus:border-primary focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                const firstLine = (draft || '').split('\n')[0].trim()
                if (firstLine) onUseAsHook(firstLine)
              }}
              title="Copy the first line of the caption into slide 1's hook text block"
              className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-3xs font-semibold text-primary hover:bg-primary/10 transition-colors"
            >
              ↑ Use 1st line as slide hook
            </button>
            <span className="text-3xs text-muted-foreground">{draft.length} chars</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Real Quotes — verbatim lines from the source interview ────────────────────
// Shows the actual words the clinician said that grounded this post.
// Tapping a quote inserts it as a body text block on the active slide.
function RealQuotesSection({ pieceId, onInsertQuote }) {
  const { data: quotes = [], isLoading } = useVerbatimQuotes(pieceId)

  if (!isLoading && quotes.length === 0) return null

  return (
    <div className="border-t">
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Type className="h-3 w-3" /> Real quotes
        </span>
        <span className="text-3xs text-muted-foreground">from your interview · tap to add</span>
      </div>
      {isLoading ? (
        <div className="px-3 pb-3 flex items-center gap-2 text-2xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="px-3 pb-3 space-y-1.5">
          {quotes.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => onInsertQuote?.(q.quote)}
              className="w-full text-left rounded-md border border-l-[3px] border-l-amber-400 bg-card px-2.5 py-2 text-2xs leading-snug text-foreground hover:bg-amber-50/60 transition-colors"
            >
              <span className="text-3xs font-bold uppercase tracking-wide text-amber-500 block mb-0.5">● verbatim</span>
              &ldquo;{q.quote}&rdquo;
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Layers list (top of the right inspector) ─────────────────────────────────
// Always-visible list of the active slide's layers: Slide settings, Photo, and
// one row per text block. Clicking a row drives the contextual `selection`.

function LayerRow({ icon: Icon, label, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-2xs transition-colors ${
        active
          ? 'border-primary bg-primary/10 text-primary font-semibold'
          : 'border-transparent text-foreground hover:bg-muted'
      }`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
      <span className="truncate">{label}</span>
    </button>
  )
}

function LayersList({ slide, mediaUrls, selection, onSelect }) {
  const photoLabel = typeof slide.photo_idx === 'number'
    ? `Photo ${slide.photo_idx + 1}${mediaUrls.length ? ` of ${mediaUrls.length}` : ''}`
    : 'No photo'
  return (
    <div className="border-b px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Layers className="h-3.5 w-3.5" /> Layers
        <span className="ml-auto font-normal normal-case text-muted-foreground/70">click to select</span>
      </div>
      <div className="space-y-1">
        <LayerRow
          icon={Layers}
          label="Slide — layout & theme"
          active={selection.type === 'slide'}
          onSelect={() => onSelect({ type: 'slide' })}
        />
        <LayerRow
          icon={ImageIcon}
          label={photoLabel}
          active={selection.type === 'photo'}
          onSelect={() => onSelect({ type: 'photo' })}
        />
        {slide.blocks.map((b, i) => {
          const meta = ROLE_META[b.role] || ROLE_META.body
          const snippet = (b.text || '').trim().slice(0, 22)
          const label = `${meta.label}${snippet ? ` — ${snippet}${b.text.trim().length > 22 ? '…' : ''}` : ''}`
          return (
            <LayerRow
              key={i}
              icon={Type}
              label={label}
              active={selection.type === 'text' && selection.idx === i}
              onSelect={() => onSelect({ type: 'text', idx: i })}
            />
          )
        })}
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
    <button
      type="button"
      onClick={() => onChange({ ...slide, template_id: t.id })}
      className={`group relative overflow-hidden rounded-md border text-left transition-all ${
        selected ? 'border-amber-400 ring-1 ring-amber-400/40' : 'border-border hover:border-primary/40'
      }`}
      title={`${t.name}${selected ? ' (this slide only)' : ''}`}
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
      <div className="px-1.5 py-1 text-3xs font-medium truncate text-foreground">{t.name}</div>
      {selected && (
        <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-amber-400/40" />
      )}
    </button>
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
    <div className="space-y-4 p-3">
      {/* Slide management — reorder + delete this slide */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onMoveLeft}
          disabled={slideIdx === 0}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
          title="Move slide earlier"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="flex-1 text-center text-xs font-semibold">
          Slide {slideIdx + 1} <span className="font-normal text-muted-foreground">of {totalSlides}</span>
        </span>
        <button
          type="button"
          onClick={onMoveRight}
          disabled={slideIdx === totalSlides - 1}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
          title="Move slide later"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 rounded p-0.5 text-muted-foreground hover:text-rose-600"
          title="Delete slide"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Theme — visual swatch grid with deck inheritance */}
      <div className="space-y-2">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Theme <span className="font-normal normal-case text-muted-foreground/70">· colour &amp; style</span>
        </p>
        <button
          type="button"
          onClick={() => onChange({ ...slide, template_id: null })}
          className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-2xs transition-colors ${
            !slide.template_id
              ? 'border-primary bg-primary/10 text-primary font-semibold'
              : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/40'
          }`}
        >
          <span>Same as deck</span>
          {!slide.template_id && <span className="text-3xs">✓ inheriting</span>}
        </button>
        {/* Two families: Photo templates (full-bleed photo + overlay) and Text
            cards (no photo, branded). Family derived via templateFamily. */}
        <p className="pt-0.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground/80">
          Photo templates <span className="font-normal normal-case text-muted-foreground/60">· full-bleed photo</span>
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {allThemes.filter((t) => templateFamily(resolveTheme(t.id, customThemes)) === 'photo').map((t) => (
            <ThemeTile key={t.id} t={t} slide={slide} photoUrl={photoUrl} brandStyle={brandStyle} customThemes={customThemes} thumbSig={thumbSig} onChange={onChange} />
          ))}
        </div>
        <p className="pt-1.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground/80">
          Text cards <span className="font-normal normal-case text-muted-foreground/60">· no photo</span>
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {allThemes.filter((t) => templateFamily(resolveTheme(t.id, customThemes)) === 'text').map((t) => (
            <ThemeTile key={t.id} t={t} slide={slide} photoUrl={photoUrl} brandStyle={brandStyle} customThemes={customThemes} thumbSig={thumbSig} onChange={onChange} />
          ))}
        </div>
        <button
          type="button"
          onClick={() => onApplyThemeToAll(slide.template_id || globalThemeId)}
          className="w-full rounded-md border border-border px-2 py-1.5 text-2xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          Apply this theme to all slides
        </button>
      </div>

      {/* Add text block */}
      <div className="space-y-1.5">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Text</p>
        <div className="relative">
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            className="w-full rounded-md border border-dashed border-primary/60 bg-primary/5 px-2 py-1.5 text-2xs font-semibold text-primary hover:bg-primary/10"
          >
            <Plus className="inline h-3 w-3 -mt-0.5 mr-0.5" />
            Add text block
          </button>
          {addOpen && (
            <div className="absolute left-0 right-0 z-40 mt-1 rounded-md border bg-white p-1 shadow-lg">
              {BLOCK_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => { onAddBlock(role); setAddOpen(false) }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-2xs hover:bg-muted"
                >
                  <span className={`inline-block rounded-full px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide ${ROLE_META[role].chip}`}>
                    {ROLE_META[role].label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-3xs text-muted-foreground">
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
    <button
      type="button"
      disabled={attaching}
      onClick={onAttach}
      title={attached ? 'Already in this post — click to use it on this slide' : 'Use this photo'}
      className={`group relative aspect-square overflow-hidden rounded-md border transition-all ${
        attached ? 'border-primary' : 'border-border hover:border-primary'
      }`}
    >
      {thumb
        ? <img src={thumb} alt="" className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center bg-muted"><ImageIcon className="h-4 w-4 text-muted-foreground" /></div>}
      <span className="absolute left-1 top-1 rounded bg-primary px-1 text-3xs font-bold leading-tight text-primary-foreground">AI</span>
      <span className={`absolute inset-0 flex items-center justify-center bg-black/40 text-white transition-opacity ${attaching ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {attaching ? <Loader2 className="h-4 w-4 animate-spin" /> : attached ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      </span>
    </button>
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
      className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors ${
        tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="h-3 w-3" />{label}
    </button>
  )

  return (
    <div className="space-y-2">
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Swap / add a photo</p>
      <div className="flex gap-1 rounded-lg border border-border p-0.5">
        {tabBtn('ai', 'AI picks', Sparkles)}
        {tabBtn('library', 'Library', FolderOpen)}
      </div>

      {tab === 'ai' ? (
        <div className="space-y-1.5">
          {/* Describe the shot — manual query into the same picks brain */}
          <div className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={shotQ}
              onChange={(e) => setShotQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runShotSearch() }}
              placeholder="Describe the shot…"
              className="min-w-0 flex-1 bg-transparent text-2xs outline-none"
              disabled={shotLoading}
            />
            {shotRes != null && (
              <button type="button" onClick={clearShot} className="shrink-0 text-3xs text-primary hover:underline">clear</button>
            )}
            {shotLoading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
          </div>

          {suggLoading && shotRes == null ? (
            <div className="grid grid-cols-3 gap-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : suggError && shotRes == null ? (
            <p className="text-3xs text-muted-foreground">
              Couldn&apos;t load picks.{' '}
              <button type="button" onClick={() => refetch()} className="text-primary hover:underline">Try again</button>
            </p>
          ) : clips.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/20 px-2 py-3 text-center text-3xs text-muted-foreground">
              {shotRes != null ? `Nothing matched “${shotQ}”.` : 'No photo picks — browse your library instead.'}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
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
          <p className="text-3xs text-muted-foreground">Picks re-rank from your words. Click one to attach &amp; bind it.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-primary/60 bg-primary/5 px-2 py-3 text-2xs font-semibold text-primary hover:bg-primary/10"
          >
            <Upload className="h-3.5 w-3.5" />
            Browse library / upload
          </button>
          <p className="text-3xs text-muted-foreground">Search your whole library or upload a new photo.</p>
        </div>
      )}

      {pickerOpen && (
        <MediaPicker onClose={() => setPickerOpen(false)} onSelect={handlePicked} />
      )}

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full text-center text-3xs text-muted-foreground hover:text-foreground"
        >
          cancel — keep current photo
        </button>
      )}
    </div>
  )
}

// ── PHOTO inspector body — swap/add + bind + reframe + colorist ──────────────

function PhotoInspector({ slide, photoUrl, mediaUrls, pieceId, attachedKeys, onAttachPhoto, onChange }) {
  // One photo control: the slide's current photo + Replace, or an empty state
  // that prompts a pick. Picking ALWAYS attaches+binds in one step (per-slide
  // model) — the old "use an attached photo" pool dropdown is gone. `replacing`
  // reveals the picker over an existing photo; reset when the active slide changes.
  const [replacing, setReplacing] = useState(false)
  useEffect(() => { setReplacing(false) }, [photoUrl])
  const [vibePrompt, setVibePrompt] = useState('')
  const [proposing, setProposing] = useState(false)

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
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5" style={{ background: 'hsl(var(--primary)/.08)' }}>
        <ImageIcon className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold text-primary">This slide&apos;s photo</span>
      </div>

      {/* The slide's photo — current photo + Replace/Remove, or an empty state.
          ONE control: picking attaches+binds in one step (per-slide model). The
          old "use an attached photo" pool dropdown is gone. */}
      {hasPhoto ? (
        <div className="flex items-center gap-2.5 rounded-md border border-border bg-background/50 p-2">
          <img src={photoThumb} alt="" className="h-16 w-16 shrink-0 rounded-md border border-border object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-2xs font-semibold">Photo on this slide</p>
            <p className="text-3xs text-muted-foreground">{graded ? 'From your library · graded' : 'From your library'}</p>
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                onClick={() => setReplacing((o) => !o)}
                className="rounded-md bg-primary px-2 py-1 text-3xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Repeat className="mr-0.5 inline h-3 w-3" />Replace
              </button>
              <button
                type="button"
                onClick={removePhoto}
                className="rounded-md border border-border px-2 py-1 text-3xs text-muted-foreground hover:border-destructive/40 hover:text-destructive"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-primary/50 bg-primary/5 px-3 py-4 text-center">
          <ImagePlus className="mx-auto mb-1 h-5 w-5 text-primary" />
          <p className="text-2xs font-semibold text-primary">Add a photo to this slide</p>
          <p className="mt-0.5 text-3xs text-muted-foreground">Pick from AI picks, your library, or upload — it lands straight on the slide.</p>
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
        <div className="space-y-1.5">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Frame</p>
          <div className="flex items-center gap-2 text-2xs text-muted-foreground">
            <span className="shrink-0">Zoom</span>
            <input
              type="range"
              min="1"
              max="4"
              step="0.01"
              value={slide.photo_zoom || 1}
              onChange={(e) => onChange({ ...slide, photo_zoom: parseFloat(e.target.value) })}
              className="flex-1 accent-primary"
              aria-label="Photo zoom"
            />
            {(slide.photo_zoom > 1 || slide.photo_offset) && (
              <button
                type="button"
                onClick={() => { const s = { ...slide }; delete s.photo_zoom; delete s.photo_offset; onChange(s) }}
                className="shrink-0 text-primary hover:underline"
              >
                reset
              </button>
            )}
          </div>
          <p className="text-3xs text-muted-foreground">Slider far-left = whole photo fits (blurred backdrop fills the rest); zoom in to crop. Drag the photo to reposition · scroll to zoom.</p>
        </div>
      )}

      {/* AI Photo Editor — the colorist. Describe a vibe, tap a preset, or fine-
          tune the five essentials. Same param schema as the server bake. */}
      {photoUrl && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5 text-primary" />
            <span className="text-2xs font-semibold uppercase tracking-wide text-primary">AI Photo Editor</span>
            {graded && (
              <button type="button" onClick={resetGrade} className="ml-auto text-3xs text-muted-foreground hover:text-foreground hover:underline">
                reset
              </button>
            )}
          </div>

          {/* Describe the look */}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={vibePrompt}
              onChange={(e) => setVibePrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') proposeFromText() }}
              placeholder="Describe a look — e.g. bright, warm, clinical"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-2xs outline-none focus:ring-1 focus:ring-primary/50"
              disabled={proposing}
            />
            <button
              type="button"
              onClick={proposeFromText}
              disabled={proposing || !vibePrompt.trim()}
              className="shrink-0 rounded-md bg-primary px-2.5 py-1.5 text-2xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {proposing ? '…' : 'Apply'}
            </button>
          </div>

          {/* One-tap vibes */}
          <div className="flex flex-wrap gap-1.5">
            {GRADE_VIBES.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => applyVibe(v.params)}
                className="rounded-full border border-border px-2 py-0.5 text-3xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Fine-tune essentials */}
          <div className="space-y-1.5 pt-0.5">
            {GRADE_SLIDERS.map((s) => {
              const val = Number(grade[s.key]) || 0
              return (
                <div key={s.key}>
                  <div className="flex justify-between text-3xs text-muted-foreground">
                    <span>{s.label}</span>
                    <span>{val > 0 ? '+' : ''}{val}</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    value={val}
                    onChange={(e) => setGradeParam(s.key, e.target.value)}
                    className="w-full accent-primary"
                    aria-label={s.label}
                  />
                </div>
              )
            })}
          </div>
          <p className="text-3xs text-muted-foreground">Applies to this photo. The same grade ships in the published post.</p>
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
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex gap-1">
        {options.map((o) => {
          const active = value === o.value || (value == null && o.value == null)
          return (
            <button
              key={o.label}
              type="button"
              onClick={() => onPick(o.value)}
              className={`flex-1 rounded-md border px-1.5 py-1 text-2xs font-medium transition-colors ${
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
function TextStyleControls({ block, onSet }) {
  const workspace = useWorkspace()
  const swatches = useMemo(() => [...brandSwatches(workspace), ...NEUTRAL_SWATCHES], [workspace])
  const scale = Number.isFinite(block.fontScale) && block.fontScale > 0 ? block.fontScale : 1
  return (
    <div className="space-y-2.5 rounded-md border border-border/60 p-2.5">
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Style</p>

      {/* Size */}
      <div>
        <div className="mb-0.5 flex justify-between text-3xs text-muted-foreground">
          <span>Size</span><span>{Math.round(scale * 100)}%</span>
        </div>
        <input
          type="range" min="0.6" max="1.8" step="0.05" value={scale}
          onChange={(e) => onSet('fontScale', parseFloat(e.target.value))}
          className="w-full accent-primary" aria-label="Text size"
        />
      </div>

      {/* Colour */}
      <div>
        <p className="mb-1 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Colour</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button" onClick={() => onSet('color', null)} title="Auto (theme)"
            className={`h-6 rounded px-1.5 text-3xs font-medium ${!block.color ? 'bg-primary/10 text-primary ring-1 ring-primary' : 'bg-muted text-muted-foreground'}`}
          >Auto</button>
          {TEXT_COLORS.map((c) => (
            <button
              key={c.value} type="button" onClick={() => onSet('color', c.value)} title={c.label}
              className={`h-6 w-6 rounded-full border ${block.color === c.value ? 'ring-2 ring-primary ring-offset-1' : 'border-border'}`}
              style={{ background: c.value }}
            />
          ))}
          <ColorPickerPopover
            value={/^#[0-9a-f]{6}$/i.test(block.color || '') ? block.color : '#ffffff'}
            onChange={(hex) => onSet('color', hex)}
            swatches={swatches}
            swatchClassName="h-6 w-6 rounded-full"
            ariaLabel="Pick custom text color"
          />
        </div>
      </div>

      <SegRow
        label="Weight"
        options={[{ label: 'Auto', value: null }, { label: 'Reg', value: '400' }, { label: 'Med', value: '500' }, { label: 'Bold', value: '700' }]}
        value={block.fontWeight ?? null}
        onPick={(v) => onSet('fontWeight', v)}
      />
      {/* Italic / Underline toggles */}
      <div>
        <p className="mb-1 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Format</p>
        <div className="flex gap-1">
          {[
            { key: 'italic',    label: 'I', className: 'italic'    },
            { key: 'underline', label: 'U', className: 'underline' },
          ].map(({ key, label, className: cls }) => {
            const active = block[key] === true
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSet(key, active ? null : true)}
                className={`flex-1 rounded-md border px-1.5 py-1 text-2xs font-medium transition-colors ${cls} ${
                  active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TextInspector({ slide, blockIdx, onChange, onRemoved }) {
  const block = slide.blocks[blockIdx]
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
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5" style={{ background: 'hsl(var(--primary)/.08)' }}>
        <Type className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold text-primary">Text layer</span>
      </div>
      <BlockRow
        block={block}
        onChange={updateBlock}
        onRemove={removeBlock}
      />
      <TextStyleControls block={block} onSet={setStyle} />
    </div>
  )
}

// ── Slide rail (left vertical thumbnail column, replaces bottom filmstrip) ────

function SlideRail({ slides, activeIdx, mediaUrls, onSelect, onAdd }) {
  return (
    <aside className="flex w-[92px] shrink-0 flex-col border-r bg-white">
      <div className="flex items-center px-2 py-2 border-b">
        <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Slides</span>
        <span className="ml-auto text-3xs text-muted-foreground">{slides.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {slides.map((slide, idx) => {
          const photoUrl = typeof slide.photo_idx === 'number' && mediaUrls[slide.photo_idx]
            ? (mediaUrls[slide.photo_idx].thumbnailUrl || photoSourceUrl(mediaUrls[slide.photo_idx]))
            : null
          const isActive = idx === activeIdx
          return (
            <div key={idx} className="flex items-start gap-1">
              <span className="pt-0.5 text-3xs font-semibold text-muted-foreground">{idx + 1}</span>
              <button
                type="button"
                onClick={() => onSelect(idx)}
                className={`relative aspect-[4/5] w-full overflow-hidden rounded-md border transition-all ${
                  isActive ? 'border-primary ring-1 ring-primary/40' : 'border-border hover:border-primary/40'
                }`}
              >
                {photoUrl
                  ? <img src={photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  : <div className="absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-500" />
                }
                <div className="absolute inset-0 bg-black/15" />
                {slide.template_id && (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full" style={{ background: 'hsl(var(--action))' }} />
                )}
              </button>
            </div>
          )
        })}
        <button
          type="button"
          onClick={onAdd}
          className="ml-[14px] flex w-[calc(100%-14px)] flex-col items-center justify-center rounded-md border border-dashed border-muted-foreground/30 py-3 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span className="text-3xs mt-0.5">Add</span>
        </button>
      </div>
    </aside>
  )
}

// ── Phone-mockup preview overlay (renders the REAL slide) ────────────────────

function FullPreviewOverlay({ slides, activeIdx, mediaUrls, brandStyle, themeId, customThemes, workspace, caption, onClose, onNav }) {
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
  // Re-render the canvas when anything that affects the pixels changes.
  const renderKey = [
    activeIdx, photoUrl || '', slide.template_id || themeId || '',
    (slide.blocks || []).map((b) => `${b.role}:${b.text}:${typeof b.position === 'object' ? `${b.position.x},${b.position.y}` : b.position}:${b.fontScale || ''}:${b.color || ''}:${b.fontWeight || ''}:${b.uppercase ?? ''}:${b.italic ? 'i' : ''}:${b.underline ? 'u' : ''}:${b.runs ? b.runs.map((r) => r.color || '').join(',') : ''}`).join('~'),
    slide.photo_zoom || 1,
    slide.photo_offset ? `${slide.photo_offset.x},${slide.photo_offset.y}` : '',
    slide.grade ? JSON.stringify(slide.grade) : '',
  ].join('|')

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 p-6">
      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-3 px-5 py-3">
        <Smartphone className="h-4 w-4 text-white/70" />
        <span className="text-sm font-medium text-white/90">Preview — how it’ll appear</span>
        <span className="text-xs text-white/50">{activeIdx + 1} / {slides.length}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
          title="Close (Esc)"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => onNav(-1)}
          disabled={activeIdx === 0}
          className="h-12 w-12 shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center disabled:opacity-20 transition-colors"
        >
          <ChevronLeft className="h-7 w-7" />
        </button>

        {/* iPhone frame with IG chrome + the real rendered slide */}
        <div className="relative rounded-[2.5rem] border-[10px] border-black bg-black shadow-2xl" style={{ width: 320 }}>
          <div className="absolute left-1/2 top-0 z-20 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-black" />
          <div className="overflow-hidden rounded-[1.9rem] bg-white">
            {/* IG header */}
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-amber-400 to-rose-500 p-[2px]">
                <div className="h-full w-full rounded-full bg-white p-[1.5px]"><div className="h-full w-full rounded-full bg-muted" /></div>
              </div>
              <span className="text-2xs font-semibold text-foreground">{handle}</span>
            </div>
            {/* The real slide */}
            <div className="relative aspect-[4/5] w-full bg-muted">
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
            {/* IG actions */}
            <div className="flex items-center gap-4 px-3 py-2 text-foreground">
              <Heart className="h-5 w-5" />
              <MessageCircle className="h-5 w-5" />
              <Send className="h-5 w-5" />
              <Bookmark className="ml-auto h-5 w-5" />
            </div>
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
          className="h-12 w-12 shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center disabled:opacity-20 transition-colors"
        >
          <ChevronRight className="h-7 w-7" />
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

export default function SlideEditor({ piece, onBack, formatLabel, formatSub, photoCount, scheduleNode }) {
  const workspace = useWorkspace()
  const navigate = useNavigate()
  const brandStyle = workspace?.brand_style || {}
  const mediaUrls = (piece?.media_urls || []).filter((m) => m && m.type !== 'video' && m.url)
  const hasMedia = mediaUrls.length > 0
  // Keys of every already-attached entry (photo or video) — so the swap/add
  // picks can mark which suggestions are already on the piece.
  const attachedKeys = useMemo(
    () => new Set((piece?.media_urls || []).map(mediaEntryKey)),
    [piece?.media_urls],
  )
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [safeZones, setSafeZones] = useState(true)

  // Seed: stored slides if any, else one empty cover slide bound to photo 0.
  function seedSlides() {
    const stored = Array.isArray(piece?.slides) ? piece.slides : null
    if (stored && stored.length > 0) return stored.map((s, i) => normalizeSlide(s, i))
    return [{ photo_idx: hasMedia ? 0 : null, template: 'cover', blocks: [] }]
  }

  const [slides, setSlides] = useState(seedSlides)
  const [savedSlidesJson, setSavedSlidesJson] = useState(() => JSON.stringify(seedSlides()))
  const [themeId, setThemeId] = useState(() => piece?.photo_template_id || DEFAULT_DECK_THEME)
  const [aspect, setAspect] = useState(() => piece?.aspect_ratio || '4:5')
  const [activeSlideIdx, setActiveSlideIdx] = useState(0)
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false)
  const [adExportOpen, setAdExportOpen] = useState(false)
  // Contextual selection driving the right inspector. One of:
  //   { type: 'slide' } | { type: 'photo' } | { type: 'text', idx }
  // Reset to slide whenever the active slide changes (see goToSlide).
  const [selection, setSelection] = useState({ type: 'slide' })

  useEffect(() => {
    const next = seedSlides()
    setSlides(next)
    setSavedSlidesJson(JSON.stringify(next))
    setThemeId(piece?.photo_template_id || DEFAULT_DECK_THEME)
    setAspect(piece?.aspect_ratio || '4:5')
    setActiveSlideIdx(0)
    setSelection({ type: 'slide' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece?.id, JSON.stringify(piece?.slides)])

  // Fetch workspace custom templates for the picker
  const { data: allThemes = [] } = usePhotoTemplates()
  const customThemes = allThemes.filter((t) => t.custom)
  const theme = resolveTheme(themeId, customThemes)

  const dirty = JSON.stringify(slides) !== savedSlidesJson
    || themeId !== (piece?.photo_template_id || DEFAULT_DECK_THEME)
    || aspect !== (piece?.aspect_ratio || '4:5')
  const updateItem = useUpdateContentItem()

  // Auto-attach top AI pick per slide on first open when slides have no photos.
  // A ref guards against re-firing; only fires when ALL slides are photo-less (fresh carousel).
  const autoAttachDoneRef = useRef(false)
  const { data: photoSuggestions } = useMediaSuggestions(piece?.id, { enabled: !!piece?.id, kind: 'photo', k: 6 })
  useEffect(() => {
    if (autoAttachDoneRef.current) return
    if (!photoSuggestions?.length) return
    const allEmpty = slides.every((s) => s.photo_idx === null)
    if (!allEmpty) { autoAttachDoneRef.current = true; return }
    autoAttachDoneRef.current = true
    const raw = Array.isArray(piece?.media_urls) ? piece.media_urls : []
    const seen = new Set(raw.map(mediaEntryKey))
    const toAdd = []
    for (let i = 0; i < slides.length; i++) {
      const pick = photoSuggestions[i % photoSuggestions.length]
      if (!pick) break
      const key = mediaEntryKey(pick)
      if (!seen.has(key)) { toAdd.push(pick); seen.add(key) }
    }
    const nextRaw = [...raw, ...toAdd]
    const photoOnly = nextRaw.filter((m) => m && m.type !== 'video' && m.url)
    const newSlides = slides.map((s, i) => {
      const pick = photoSuggestions[i % photoSuggestions.length]
      if (!pick) return s
      const idx = photoOnly.findIndex((m) => mediaEntryKey(m) === mediaEntryKey(pick))
      return idx >= 0 ? { ...s, photo_idx: idx } : s
    })
    if (toAdd.length > 0) {
      updateItem.mutateAsync({ id: piece.id, patch: { mediaUrls: nextRaw } }).catch(() => {})
    }
    setSlides(newSlides)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoSuggestions])

  const [rendering, setRendering] = useState(false)
  const busy = updateItem.isPending || rendering

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
    const removed = slides[idx]
    const next = slides.filter((_, i) => i !== idx)
    setSlides(next)
    setActiveSlideIdx((prev) => Math.min(prev, Math.max(0, next.length - 1)))
    setSelection({ type: 'slide' })
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
    const nextRaw = already ? raw : [...raw, entry]
    try {
      if (!already) {
        await updateItem.mutateAsync({ id: piece.id, patch: { mediaUrls: nextRaw } })
      }
      // Index in the photo-only filtered list (videos excluded) — the same filter
      // the editor uses for `mediaUrls`/`photo_idx` everywhere.
      const photoOnly = nextRaw.filter((m) => m && m.type !== 'video' && m.url)
      const photoIdx = photoOnly.findIndex((m) => mediaEntryKey(m) === key)
      if (photoIdx >= 0) {
        setSlides((cur) => cur.map((s, i) => (i === activeSlideIdx ? { ...s, photo_idx: photoIdx } : s)))
      }
      toast.success(already ? 'Photo swapped' : 'Photo attached')
    } catch (e) {
      toast.error('Could not attach photo', { description: e?.message })
    }
  }

  // Switch the active slide and reset the contextual selection to the slide.
  function goToSlide(idx) {
    setActiveSlideIdx(idx)
    setSelection({ type: 'slide' })
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

  async function handleSave() {
    const cleaned = slides.map((s) => ({
      photo_idx: typeof s.photo_idx === 'number' ? s.photo_idx : null,
      template:  s.template,
      // Preserve the per-slide theme override. Without this it was silently
      // dropped on save — the picker set slide.template_id, the resolver and the
      // bake honored it, but handleSave rebuilt slides without it, so a per-slide
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

    // Bake each slide (photo + on-screen text) into an image and upload it, so
    // the overlay actually ships at publish — it previously lived only on the
    // preview canvas and never reached the post. Re-renders only changed slides.
    let toPersist = cleaned
    let renderFailed = false
    setRendering(true)
    try {
      const { slides: rendered } = await ensureRenderedSlides({
        slides:    cleaned,
        mediaUrls: piece?.media_urls,
        brandStyle,
        theme,
        themeId,
        customThemes,
        pieceId:   piece.id,
        aspect,
      })
      toPersist = rendered
    } catch (e) {
      // Never lose the user's text on a render/upload hiccup — persist the slide
      // data anyway. Publish has its own render fallback, and re-saving retries.
      renderFailed = true
      console.warn('[SlideEditor] slide render failed, saving text only', e.message)
    } finally {
      setRendering(false)
    }

    try {
      await updateItem.mutateAsync({
        id: piece.id,
        patch: { slides: toPersist, photo_template_id: themeId || null, aspectRatio: aspect },
      })
      setSavedSlidesJson(JSON.stringify(cleaned))
      if (renderFailed) {
        toast.error('Saved, but slide images need a retry', { description: 'Text is safe — click Save again to bake the on-screen text into the images.' })
      } else {
        toast.success('Slides saved')
      }
    } catch (e) {
      toast.error('Save failed', { description: e.message })
    }
  }

  function handleReset() {
    setSlides(JSON.parse(savedSlidesJson))
  }

  // Active slide derived values — used by the canvas and the inspector.
  const activeSlide = slides[activeSlideIdx] || slides[0]
  const activePhotoUrl = typeof activeSlide?.photo_idx === 'number' && mediaUrls[activeSlide.photo_idx]
    ? photoSourceUrl(mediaUrls[activeSlide.photo_idx])
    : null
  const activeTheme = resolveTheme(activeSlide?.template_id || themeId, customThemes)

  function goBack() {
    if (onBack) onBack()
    else navigate(-1)
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

      {/* ── TOP BAR (~52px) — the only persistent chrome ─────────────────── */}
      <header className="flex items-center gap-3 border-b bg-white px-4 py-2.5 shrink-0">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center text-muted-foreground hover:text-foreground"
          title="Back to media"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold truncate max-w-[200px]">{piece?.topic || 'Untitled'}</span>
        {/* Persistent format badge */}
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-semibold" style={{ background: 'hsl(var(--info)/.12)', color: 'hsl(var(--info))' }}>
          <Instagram className="h-3.5 w-3.5" />
          {formatLabel || 'Instagram Carousel'} · {formatSub || `${slides.length} slides`}
        </span>
        {photoCount != null && photoCount !== slides.length && (
          <span className="hidden text-3xs text-muted-foreground lg:inline">
            {slides.length} slides from {photoCount} photo{photoCount === 1 ? '' : 's'}
          </span>
        )}

        {/* Aspect selector */}
        <div className="flex overflow-hidden rounded-md border border-border">
          {['1:1', '4:5', '9:16'].map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAspect(a)}
              className={`px-2 py-0.5 text-2xs font-medium transition-colors ${aspect === a ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              {a}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFullPreviewOpen(true)}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Preview as Instagram"
          >
            <Smartphone className="mr-1 inline h-3.5 w-3.5" />
            Preview
          </button>
          {hasMedia && (
            <button
              type="button"
              onClick={() => setAdExportOpen(true)}
              className="rounded-lg border border-action/40 px-2.5 py-1.5 text-xs text-action hover:bg-action/10 transition-colors"
              title="Render into ad sizes"
            >
              <Megaphone className="mr-1 inline h-3.5 w-3.5" />
              Ads
            </button>
          )}
          {dirty && (
            <Button size="sm" variant="ghost" onClick={handleReset} disabled={busy}>Reset</Button>
          )}
          <Button size="sm" variant={dirty ? 'default' : 'outline'} onClick={handleSave} disabled={busy || !dirty} loading={busy}>
            {rendering ? 'Rendering…' : updateItem.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </Button>
          {scheduleNode && (
            <Button size="sm" onClick={() => setScheduleOpen(true)} className="bg-action text-action-foreground hover:bg-action/90">
              <CalendarClock className="mr-1 h-3.5 w-3.5" />
              Schedule
            </Button>
          )}
        </div>
      </header>

      {/* ── WORK AREA — left rail + scaling canvas + contextual inspector ── */}
      <div className="flex min-h-0 flex-1">
        {/* Left vertical slide rail (replaces the old bottom filmstrip) */}
        <SlideRail
          slides={slides}
          activeIdx={activeSlideIdx}
          mediaUrls={mediaUrls}
          onSelect={goToSlide}
          onAdd={addSlide}
        />

        {/* Canvas stage — fills the available height, scales to fit */}
        <section className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-5" style={{ background: 'hsl(220 16% 91%)' }}>
          {/* Slide counter + safe-zone toggle, floating over the stage */}
          <div className="absolute right-4 top-3 z-10 flex items-center gap-2 rounded-md bg-white/80 px-2 py-1 text-3xs text-muted-foreground backdrop-blur">
            <span className="font-semibold">Slide {activeSlideIdx + 1} of {slides.length}</span>
            <label className="flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={safeZones} onChange={(e) => setSafeZones(e.target.checked)} className="accent-primary" />
              safe zones
            </label>
          </div>

          {activeSlide ? (
            <div
              className={`relative ${ASPECT_STAGE[aspect]?.twAspect ?? 'aspect-[4/5]'} rounded-xl ${selection.type === 'photo' ? 'ring-[2.5px] ring-primary ring-offset-2 ring-offset-[hsl(220_16%_91%)]' : ''}`}
              style={{ height: `min(calc(100vh - 140px), calc((100vw - 480px) * ${ASPECT_STAGE[aspect]?.hFactor ?? 1.25}))` }}
            >
              <SlidePreview
                slide={activeSlide}
                photoUrl={activePhotoUrl}
                brandStyle={brandStyle}
                theme={activeTheme}
                onReframe={(next) => updateSlide(activeSlideIdx, next)}
                onSelectPhoto={() => setSelection({ type: 'photo' })}
                className={`h-full w-full rounded-xl border bg-muted shadow-lg ${activePhotoUrl ? 'cursor-move' : 'cursor-pointer'}`}
              />
              {safeZones && (
                <div className="pointer-events-none absolute inset-0 rounded-xl">
                  <div className="absolute inset-[7%] rounded border border-dashed border-white/50" />
                  <div className="absolute inset-x-0 top-0 h-[10%] bg-rose-500/10" />
                  <div className="absolute inset-x-0 bottom-0 h-[14%] bg-rose-500/10" />
                </div>
              )}
              {/* Draggable text-layer handles — click to select, drag to place */}
              <TextDragLayer
                slide={activeSlide}
                theme={activeTheme}
                selection={selection}
                onSelectBlock={(idx) => setSelection({ type: 'text', idx })}
                onMoveBlock={(idx, pos) => updateSlide(activeSlideIdx, {
                  ...activeSlide,
                  blocks: activeSlide.blocks.map((b, i) => (i === idx ? { ...b, position: pos } : b)),
                })}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No slides yet</p>
          )}
        </section>

        {/* Right contextual inspector: Layers (top) → editing body → Real Quotes → Caption */}
        <aside className="flex w-[300px] shrink-0 flex-col border-l bg-white overflow-hidden">
          {activeSlide ? (
            <>
              <LayersList
                slide={activeSlide}
                mediaUrls={mediaUrls}
                selection={selection}
                onSelect={setSelection}
              />
              <div className="min-h-0 flex-1 overflow-y-auto flex flex-col">
                {selection.type === 'photo' ? (
                  <PhotoInspector
                    slide={activeSlide}
                    photoUrl={activePhotoUrl}
                    mediaUrls={mediaUrls}
                    pieceId={piece?.id}
                    attachedKeys={attachedKeys}
                    onAttachPhoto={attachPhoto}
                    onChange={(next) => updateSlide(activeSlideIdx, next)}
                  />
                ) : selection.type === 'text' ? (
                  <TextInspector
                    slide={activeSlide}
                    blockIdx={selection.idx}
                    photoUrl={activePhotoUrl}
                    onChange={(next) => updateSlide(activeSlideIdx, next)}
                    onRemoved={() => setSelection({ type: 'slide' })}
                  />
                ) : (
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
                      setSelection({ type: 'text', idx: blocks.length - 1 })
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
                <RealQuotesSection
                  pieceId={piece?.id}
                  onInsertQuote={(text) => {
                    if (!activeSlide) return
                    const blocks = activeSlide.blocks.concat({ role: 'body', text, position: defaultPositionFor(activeSlide.template, 'body') })
                    updateSlide(activeSlideIdx, { ...activeSlide, blocks })
                    setSelection({ type: 'text', idx: blocks.length - 1 })
                  }}
                />
                <CaptionSection
                  piece={piece}
                  onUseAsHook={handleUseAsHook}
                  updateItem={updateItem}
                />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground p-4">
              Add a slide to start editing
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
