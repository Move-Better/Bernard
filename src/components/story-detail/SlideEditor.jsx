import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import Moveable from 'moveable'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, X, Plus, Image as ImageIcon, Loader2, Move, Wand2, Layers, Megaphone, ArrowLeft, Smartphone, CalendarClock, Instagram } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUpdateContentItem, usePhotoTemplates } from '@/lib/queries'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { apiFetch } from '@/lib/api'
import {
  BLOCK_ROLES,
  POSITION_PRESETS,
  SLIDE_TEMPLATES,
  TEMPLATE_DEFAULT_POSITIONS,
  renderFreeformSlide,
} from '@/lib/overlayTemplates'
import { resolveTheme } from '@/lib/photoTemplates'
import { ensureRenderedSlides } from '@/lib/renderSlides'
import AdCarouselExportModal from '@/components/AdCarouselExportModal'

// Role label + chip colors. Mirrors the mockup palette.
const ROLE_META = {
  hook:        { label: 'Hook',        chip: 'bg-amber-100 text-amber-800' },
  body:        { label: 'Body',        chip: 'bg-blue-100 text-blue-800' },
  caption:     { label: 'Caption',     chip: 'bg-indigo-100 text-indigo-800' },
  cta:         { label: 'CTA',         chip: 'bg-orange-100 text-orange-800' },
  attribution: { label: 'Attribution', chip: 'bg-green-100 text-green-800' },
  page:        { label: 'Page #',      chip: 'bg-slate-200 text-slate-700' },
}

const POSITION_LABEL = {
  'top-left':      'Top L',
  'top':           'Top',
  'top-right':     'Top R',
  'center-left':   'Center L',
  'center':        'Center',
  'center-right':  'Center R',
  'bottom-left':   'Bot. L',
  'bottom':        'Bottom',
  'bottom-right':  'Bot. R',
}

function positionDisplay(pos) {
  if (pos && typeof pos === 'object' && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    return `Custom (${Math.round(pos.x * 100)},${Math.round(pos.y * 100)})`
  }
  return POSITION_LABEL[pos] || POSITION_LABEL.center
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
    blocks: Array.isArray(s?.blocks)
      ? s.blocks.map((b) => ({
          role:     typeof b?.role === 'string' && ROLE_META[b.role] ? b.role : 'body',
          text:     typeof b?.text === 'string' ? b.text : '',
          position: b?.position ?? 'center',
          // Per-block wrap width (fraction of canvas), set by the editor's resize
          // handle. Optional — renderer falls back to the role default when absent.
          ...(Number.isFinite(b?.width) ? { width: b.width } : {}),
        }))
      : [],
  }
}

function defaultPositionFor(template, role) {
  const map = TEMPLATE_DEFAULT_POSITIONS[template] || {}
  return map[role] || 'center'
}

function emptyBlockFor(template, role) {
  return { role, text: '', position: defaultPositionFor(template, role) }
}

// ── Position picker (preset grid + custom drag) ───────────────────────────────

function PositionPickerPopover({ anchorRef, photoUrl, value, width, text, roleLabel, onChange, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        const anchor = anchorRef?.current
        if (!anchor || !anchor.contains(e.target)) onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [anchorRef, onClose])

  const stageRef = useRef(null)
  const isCustom = value && typeof value === 'object'
  const initial = {
    xFrac: isCustom ? value.x : 0.5,
    yFrac: isCustom ? value.y : 0.5,
    widthFrac: Number.isFinite(width) ? width : 0.62,
  }

  return (
    <div
      ref={ref}
      className="absolute z-50 mt-1 w-[280px] rounded-lg border bg-white p-3 shadow-lg"
      style={{ top: '100%', left: 0 }}
    >
      <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        Position
      </p>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {POSITION_PRESETS.map((p) => {
          const selected = !isCustom && value === p
          return (
            <button
              key={p}
              type="button"
              onClick={() => { onChange({ position: p }); onClose() }}
              className={`aspect-square rounded border text-3xs font-medium transition-colors ${
                selected
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}
            >
              {POSITION_LABEL[p]}
            </button>
          )
        })}
      </div>
      <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        Custom — drag to move, pull the side handles to set width
      </p>
      <div
        ref={stageRef}
        className="relative aspect-square w-full overflow-hidden rounded border bg-muted select-none"
        style={photoUrl ? { backgroundImage: `url(${photoUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        <div className="absolute inset-0 bg-black/25 pointer-events-none" />
        <PositionMoveableBox
          stageRef={stageRef}
          initial={initial}
          text={text}
          roleLabel={roleLabel}
          onCommit={({ x, y, width: w }) => onChange({ position: { x, y }, width: w })}
        />
      </div>
    </div>
  )
}

// Vanilla `moveable` (the framework-agnostic core that react-moveable wraps —
// chosen over the React binding to avoid a transitive dual-React dependency)
// driving a WYSIWYG text proxy on the photo stage. Dragging sets the block's
// {x,y} anchor (the box center); the side handles set block.width (fraction of
// the canvas). The live SlidePreview canvas remains the true render — this box
// is just the manipulation surface. Seeded once on mount; moveable owns the DOM
// thereafter and reports fractions back on drag/resize end.
function PositionMoveableBox({ stageRef, initial, text, roleLabel, onCommit }) {
  const boxRef = useRef(null)
  useEffect(() => {
    const stage = stageRef.current
    const box = boxRef.current
    if (!stage || !box) return
    const sw = stage.clientWidth || 1
    const sh = stage.clientHeight || 1
    const w = Math.max(0.15, Math.min(1, initial.widthFrac || 0.62)) * sw
    box.style.width = `${w}px`
    const bh = box.offsetHeight
    const tx = Math.max(0, Math.min(sw - w, (initial.xFrac ?? 0.5) * sw - w / 2))
    const ty = Math.max(0, Math.min(sh - bh, (initial.yFrac ?? 0.5) * sh - bh / 2))
    box.style.transform = `translate(${tx}px, ${ty}px)`

    const m = new Moveable(stage, {
      target: box,
      container: stage,
      draggable: true,
      resizable: true,
      renderDirections: ['w', 'e'],
      origin: false,
      keepRatio: false,
      throttleDrag: 0,
      throttleResize: 0,
      bounds: { left: 0, top: 0, right: sw, bottom: sh, position: 'css' },
    })
    const commit = () => {
      const sr = stage.getBoundingClientRect()
      if (!sr.width || !sr.height) return
      const br = box.getBoundingClientRect()
      const cx = ((br.left + br.width / 2) - sr.left) / sr.width
      const cy = ((br.top + br.height / 2) - sr.top) / sr.height
      const wf = br.width / sr.width
      onCommit({
        x: Math.max(0, Math.min(1, cx)),
        y: Math.max(0, Math.min(1, cy)),
        width: Math.max(0.15, Math.min(1, wf)),
      })
    }
    m.on('drag', ({ target, transform }) => { target.style.transform = transform })
      .on('dragEnd', commit)
      .on('resize', ({ target, width: rw, drag }) => { target.style.width = `${rw}px`; target.style.transform = drag.transform; m.updateRect() })
      .on('resizeEnd', commit)
    const ro = new ResizeObserver(() => {
      const nsw = stage.clientWidth || 1
      const nsh = stage.clientHeight || 1
      m.bounds = { left: 0, top: 0, right: nsw, bottom: nsh, position: 'css' }
      m.updateRect()
    })
    ro.observe(stage)
    return () => { m.destroy(); ro.disconnect() }
    // Seed once on mount; the box is uncontrolled thereafter (moveable owns it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={boxRef}
      className="absolute left-0 top-0 box-border px-1.5 py-1 rounded-sm bg-primary/20 border border-primary text-white text-2xs font-bold leading-snug shadow"
      style={{ textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}
    >
      {(text && text.trim()) || roleLabel || 'Text'}
    </div>
  )
}

// ── Block row ─────────────────────────────────────────────────────────────────

function BlockRow({ block, photoUrl, canMoveUp, canMoveDown, onChange, onMoveUp, onMoveDown, onRemove }) {
  const [posOpen, setPosOpen] = useState(false)
  const triggerRef = useRef(null)
  const meta = ROLE_META[block.role] || ROLE_META.body
  const isCustomPos = block.position && typeof block.position === 'object'

  return (
    <div className="flex items-start gap-2 rounded-md border bg-background/50 p-2">
      <div className="flex flex-col">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          title="Move up"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          title="Move down"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <select
              value={block.role}
              onChange={(e) => onChange({ ...block, role: e.target.value })}
              className={`rounded-full px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide ${meta.chip} border border-transparent cursor-pointer`}
            >
              {BLOCK_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_META[r]?.label || r}</option>
              ))}
            </select>
            <div className="relative">
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setPosOpen((o) => !o)}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide hover:bg-muted ${
                  isCustomPos ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                }`}
                title="Set position"
              >
                {isCustomPos && <Move className="h-2.5 w-2.5" />}
                {positionDisplay(block.position)}
              </button>
              {posOpen && (
                <PositionPickerPopover
                  anchorRef={triggerRef}
                  photoUrl={photoUrl}
                  value={block.position}
                  width={block.width}
                  text={block.text}
                  roleLabel={meta.label}
                  onChange={(patch) => onChange({ ...block, ...patch })}
                  onClose={() => setPosOpen(false)}
                />
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-rose-600"
            title="Delete block"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <textarea
          value={block.text}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
          rows={Math.min(4, Math.max(1, (block.text || '').split('\n').length))}
          className="w-full resize-none rounded border border-input bg-background px-2 py-1 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/50"
          placeholder={`${meta.label} text…`}
        />
      </div>
    </div>
  )
}

// ── Slide card ────────────────────────────────────────────────────────────────

function SlidePreview({ slide, photoUrl, brandStyle, theme, onReframe, className }) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
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
    if (!canReframe) return
    const rect = canvasRef.current.getBoundingClientRect()
    const off = slide.photo_offset || { x: 0, y: 0 }
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: off.x || 0, oy: off.y || 0, w: rect.width, h: rect.height }
    e.preventDefault()
  }
  function onPointerMove(e) {
    const d = dragRef.current
    if (!d) return
    const nx = Math.max(-0.5, Math.min(0.5, d.ox + (e.clientX - d.sx) / d.w))
    const ny = Math.max(-0.5, Math.min(0.5, d.oy + (e.clientY - d.sy) / d.h))
    onReframe({ ...slide, photo_offset: { x: nx, y: ny } })
  }
  function endDrag() { dragRef.current = null }
  function onWheel(e) {
    if (!canReframe) return
    e.preventDefault()
    const z = Math.max(1, Math.min(3, (slide.photo_zoom || 1) - e.deltaY * 0.0015))
    onReframe({ ...slide, photo_zoom: z })
  }

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={onPointerDown}
      onMouseMove={onPointerMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onWheel={onWheel}
      title={canReframe ? 'Drag to reposition · scroll to zoom' : undefined}
      className={className || `w-full aspect-[4/5] rounded-md border bg-muted ${canReframe ? 'cursor-move' : ''}`}
    />
  )
}

// ── Active slide inspector (right panel) ─────────────────────────────────────
// Houses all per-slide controls for the currently selected slide.

function ActiveSlideInspector({
  slide, slideIdx, totalSlides, photoUrl, mediaUrls,
  allThemes, customThemes, globalThemeId,
  onChange, onRemove, onMoveLeft, onMoveRight, onBindPhoto, onApplyThemeToAll,
  slideCount, onThemeChange, onFontSizeStep, onPageNumbers, onSlideCountTarget,
}) {
  function updateBlock(blockIdx, next) {
    const blocks = slide.blocks.slice()
    blocks[blockIdx] = next
    onChange({ ...slide, blocks })
  }
  function removeBlock(blockIdx) {
    const blocks = slide.blocks.slice()
    blocks.splice(blockIdx, 1)
    onChange({ ...slide, blocks })
  }
  function moveBlock(blockIdx, dir) {
    const blocks = slide.blocks.slice()
    const swap = blockIdx + dir
    if (swap < 0 || swap >= blocks.length) return
    ;[blocks[blockIdx], blocks[swap]] = [blocks[swap], blocks[blockIdx]]
    onChange({ ...slide, blocks })
  }
  function addBlock(role) {
    const blocks = slide.blocks.concat(emptyBlockFor(slide.template, role))
    onChange({ ...slide, blocks })
  }
  function changeTemplate(template) {
    // Switching templates updates default positions for blocks whose
    // current position is a preset that matches the old template default;
    // user-customized positions stay. Also gives a sensible default block
    // set if the slide was empty.
    const defaults = TEMPLATE_DEFAULT_POSITIONS[template] || {}
    const blocks = slide.blocks.length === 0
      ? (SLIDE_TEMPLATES[template]?.default_blocks || []).map((role) => emptyBlockFor(template, role))
      : slide.blocks.map((b) => {
          if (b.position && typeof b.position === 'object') return b
          const oldDefault = (TEMPLATE_DEFAULT_POSITIONS[slide.template] || {})[b.role]
          const newDefault = defaults[b.role] || 'center'
          if (b.position === oldDefault) return { ...b, position: newDefault }
          return b
        })
    onChange({ ...slide, template, blocks })
  }

  const [addOpen, setAddOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Slide nav header */}
      <div className="flex items-center gap-1 px-3 py-2 border-b shrink-0">
        <button
          type="button"
          onClick={onMoveLeft}
          disabled={slideIdx === 0}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5"
          title="Move slide left"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="flex-1 text-center text-xs font-semibold">
          Slide {slideIdx + 1} <span className="text-muted-foreground font-normal">of {totalSlides}</span>
        </span>
        <button
          type="button"
          onClick={onMoveRight}
          disabled={slideIdx === totalSlides - 1}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5"
          title="Move slide right"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 text-muted-foreground hover:text-rose-600 p-0.5"
          title="Delete slide"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Scrollable inspector body */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/60">
        {/* Layout — segmented control */}
        <div className="px-3 py-2.5 space-y-1.5">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Layout <span className="font-normal normal-case text-muted-foreground/70">· structure</span>
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(SLIDE_TEMPLATES).map(([k, t]) => {
              const active = slide.template === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => changeTemplate(k)}
                  className={`rounded-md border px-2 py-1.5 text-2xs font-semibold transition-colors ${
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Theme — visual swatch grid with deck inheritance */}
        <div className="px-3 py-2.5 space-y-2">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Theme <span className="font-normal normal-case text-muted-foreground/70">· colour &amp; style</span>
          </p>
          {/* Inherit-from-deck row */}
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
          <div className="grid grid-cols-2 gap-1.5">
            {allThemes.map((t) => {
              const resolved = resolveTheme(t.id, customThemes)
              const isDark = resolved?.palette !== 'light'
              const selected = slide.template_id === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onChange({ ...slide, template_id: t.id })}
                  className={`group relative overflow-hidden rounded-md border text-left transition-all ${
                    selected ? 'border-amber-400 ring-1 ring-amber-400/40' : 'border-border hover:border-primary/40'
                  }`}
                  title={`${t.name}${selected ? ' (this slide only)' : ''}`}
                >
                  <div
                    className="h-9 w-full flex items-end px-1.5 pb-1"
                    style={{ background: isDark ? '#0c1a2e' : '#f6f4ef' }}
                  >
                    <span
                      className="h-1.5 w-8 rounded-full"
                      style={{ background: '#e8843c' }}
                    />
                  </div>
                  <div className="px-1.5 py-1 text-3xs font-medium truncate text-foreground">
                    {t.name}
                  </div>
                  {selected && (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-amber-400/40" />
                  )}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => onApplyThemeToAll(slide.template_id || globalThemeId)}
            className="w-full rounded-md border border-border px-2 py-1.5 text-2xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            Apply this theme to all slides
          </button>
        </div>

        {/* Photo */}
        <div className="px-3 py-2.5 space-y-2">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Photo</p>
          <div className="relative">
            <button
              type="button"
              onClick={() => setPhotoOpen((o) => !o)}
              className="flex w-full items-center justify-between rounded border bg-muted/40 px-2 py-1 text-2xs hover:bg-muted"
            >
              <span className="flex items-center gap-1 text-muted-foreground">
                <ImageIcon className="h-3 w-3" />
                {photoUrl
                  ? `Photo ${(slide.photo_idx ?? 0) + 1} of ${mediaUrls.length}`
                  : 'No photo bound'}
              </span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
            {photoOpen && (
              <div className="absolute left-0 right-0 z-40 mt-1 rounded-md border bg-white p-1.5 shadow-lg max-h-48 overflow-auto">
                <button
                  type="button"
                  onClick={() => { onBindPhoto(null); setPhotoOpen(false) }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-2xs hover:bg-muted ${
                    slide.photo_idx === null ? 'bg-muted' : ''
                  }`}
                >
                  <span className="h-6 w-6 rounded bg-muted-foreground/20 flex items-center justify-center">
                    <ImageIcon className="h-3 w-3 text-muted-foreground" />
                  </span>
                  No photo
                </button>
                {mediaUrls.map((m, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => { onBindPhoto(idx); setPhotoOpen(false) }}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-2xs hover:bg-muted ${
                      slide.photo_idx === idx ? 'bg-muted' : ''
                    }`}
                  >
                    <img src={m.thumbnailUrl || m.url} alt="" className="h-6 w-6 rounded object-cover" />
                    Photo {idx + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
          {photoUrl && (
            <div className="flex items-center gap-2 text-2xs text-muted-foreground">
              <span className="shrink-0">Zoom</span>
              <input
                type="range"
                min="1"
                max="3"
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
          )}
        </div>

        {/* Text blocks */}
        <div className="px-3 py-2.5 space-y-1.5">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Text blocks</p>
          {slide.blocks.map((block, blockIdx) => (
            <BlockRow
              key={blockIdx}
              block={block}
              photoUrl={photoUrl}
              canMoveUp={blockIdx > 0}
              canMoveDown={blockIdx < slide.blocks.length - 1}
              onChange={(next) => updateBlock(blockIdx, next)}
              onMoveUp={() => moveBlock(blockIdx, -1)}
              onMoveDown={() => moveBlock(blockIdx, 1)}
              onRemove={() => removeBlock(blockIdx)}
            />
          ))}
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
                    onClick={() => { addBlock(role); setAddOpen(false) }}
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
        </div>

        {/* AI — change the look (collapsed, bottom of inspector) */}
        <div>
          <ChangeTheLookPanel
            slideCount={slideCount}
            onThemeChange={onThemeChange}
            onFontSizeStep={onFontSizeStep}
            onPageNumbers={onPageNumbers}
            onSlideCountTarget={onSlideCountTarget}
          />
        </div>
      </div>
    </div>
  )
}

// ── Slide filmstrip (compact thumbnail strip) ────────────────────────────────

function SlideFilmstrip({ slides, activeIdx, mediaUrls, onSelect, onAdd }) {
  return (
    <div className="bg-card p-2.5">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Slides</span>
        <span className="text-2xs text-muted-foreground">· click to switch</span>
        <span className="ml-auto text-2xs text-muted-foreground">{slides.length} slide{slides.length === 1 ? '' : 's'}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {slides.map((slide, idx) => {
          const photoUrl = typeof slide.photo_idx === 'number' && mediaUrls[slide.photo_idx]
            ? mediaUrls[slide.photo_idx].url
            : null
          const isActive = idx === activeIdx
          const primaryRole = slide.blocks?.[0]?.role
          const roleMeta = primaryRole ? (ROLE_META[primaryRole] || null) : null
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelect(idx)}
              className={`shrink-0 w-[60px] rounded border text-left transition-all ${
                isActive
                  ? 'border-primary ring-1 ring-primary/40'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <div className="aspect-[4/5] relative overflow-hidden rounded-sm bg-muted flex items-center justify-center">
                {photoUrl
                  ? <img src={photoUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  : <div className="absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-500" />
                }
                <div className="absolute inset-0 bg-black/20" />
                {roleMeta && (
                  <span className={`absolute top-0.5 left-0.5 text-3xs font-semibold uppercase tracking-wide px-1 py-0.5 rounded ${roleMeta.chip}`}>
                    {roleMeta.label}
                  </span>
                )}
                <span className="absolute bottom-0.5 right-0.5 text-3xs text-white/70 font-medium">
                  {idx + 1}
                </span>
              </div>
            </button>
          )
        })}
        <button
          type="button"
          onClick={onAdd}
          className="shrink-0 w-[60px] aspect-[4/5] rounded border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span className="text-3xs mt-0.5">Add</span>
        </button>
      </div>
    </div>
  )
}

// ── Full edge-to-edge preview overlay ────────────────────────────────────────

function FullPreviewOverlay({ slides, activeIdx, mediaUrls, onClose, onNav }) {
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

  const photoUrl = typeof slide.photo_idx === 'number' && mediaUrls[slide.photo_idx]
    ? mediaUrls[slide.photo_idx].url
    : null
  const primaryBlock = slide.blocks?.[0]
  const primaryRole = primaryBlock?.role
  const roleMeta = primaryRole ? (ROLE_META[primaryRole] || null) : null

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-3 px-5 py-3">
        <Layers className="h-4 w-4 text-white/70" />
        <span className="text-sm font-medium text-white/90">Full preview</span>
        <span className="text-xs text-white/50">
          {activeIdx + 1} / {slides.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
          title="Close (Esc)"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Main slide area */}
      <div className="flex-1 relative flex items-center justify-center">
        {/* Background photo */}
        {photoUrl && (
          <img
            src={photoUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-70"
          />
        )}
        {!photoUrl && (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-600" />
        )}
        <div className="absolute inset-0 bg-black/40" />

        {/* Prev / next */}
        <button
          type="button"
          onClick={() => onNav(-1)}
          disabled={activeIdx === 0}
          className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="h-7 w-7" />
        </button>
        <button
          type="button"
          onClick={() => onNav(1)}
          disabled={activeIdx === slides.length - 1}
          className="absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="h-7 w-7" />
        </button>

        {/* Slide role badge */}
        {roleMeta && (
          <span className="absolute top-16 left-1/2 -translate-x-1/2 text-xs uppercase tracking-widest font-semibold px-3 py-1 rounded-full bg-white/15 text-white/90">
            {roleMeta.label}
          </span>
        )}

        {/* Text blocks */}
        <div className="relative z-10 text-center px-12 max-w-3xl w-full space-y-3">
          {slide.blocks?.length > 0
            ? slide.blocks.map((block, bi) => (
                <p
                  key={bi}
                  className={`font-semibold leading-tight text-white ${
                    bi === 0 ? 'text-4xl md:text-5xl' : 'text-lg md:text-xl opacity-90'
                  }`}
                >
                  {block.text || <span className="opacity-40 italic">No text</span>}
                </p>
              ))
            : <p className="text-2xl text-white/50 italic">Slide {activeIdx + 1}</p>
          }
        </div>
      </div>

      {/* Bottom: dots */}
      <div className="shrink-0 px-5 pb-6 pt-3 flex flex-col items-center gap-2">
        <div className="flex gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onNav(i - activeIdx)}
              className={`rounded-full transition-all ${
                i === activeIdx
                  ? 'w-5 h-2 bg-white'
                  : 'w-2 h-2 bg-white/40 hover:bg-white/60'
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-white/40">← → to navigate · Esc to close</p>
      </div>
    </div>
  )
}

// ── Change the look panel (collapsed accordion) ───────────────────────────────

const CHANGE_THE_LOOK_CHIPS = [
  { id: 'bigger', label: 'Bigger headlines' },
  { id: 'pages', label: 'Add page numbers' },
  { id: 'tighten', label: 'Tighten slides' },
  { id: 'brand', label: 'Match brand book' },
]

function ChangeTheLookPanel({ slideCount, onThemeChange, onFontSizeStep, onPageNumbers, onSlideCountTarget }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  async function fireRestyle(instruction) {
    if (!instruction.trim() || loading) return
    setLoading(true)
    try {
      const result = await apiFetch('/api/editorial/restyle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surface: 'carousel',
          instruction: instruction.trim(),
          slideCount,
        }),
      })
      const changes = result?.changes || {}
      if (changes.themeId && onThemeChange) onThemeChange(changes.themeId)
      if (typeof changes.fontSizeStep === 'number' && onFontSizeStep) onFontSizeStep(changes.fontSizeStep)
      if (changes.addPageNumbers && onPageNumbers) onPageNumbers(true)
      if (typeof changes.slideCountTarget === 'number' && onSlideCountTarget) onSlideCountTarget(changes.slideCountTarget)
      toast.success(result?.explanation || 'Done!')
    } catch (e) {
      toast.error(`Could not apply: ${e?.message || 'unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-md border border-primary/30 bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 bg-primary/5 hover:bg-primary/10 transition-colors text-left"
      >
        <Wand2 className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-semibold text-foreground">Change the look</span>
        <span className="text-2xs text-muted-foreground">· works across all slides</span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />}
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border/50">
          <div className="flex flex-wrap gap-1.5">
            {CHANGE_THE_LOOK_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                disabled={loading}
                onClick={() => fireRestyle(chip.label)}
                className="px-2.5 py-1 rounded-full border border-border text-2xs text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && input.trim()) {
                  fireRestyle(input)
                  setInput('')
                }
              }}
              placeholder="e.g. bigger headlines, brand navy, add page numbers…"
              className="flex-1 px-2.5 py-1.5 rounded-md border border-input bg-background text-xs outline-none focus:ring-1 focus:ring-primary/50"
              disabled={loading}
            />
            <button
              type="button"
              disabled={loading || !input.trim()}
              onClick={() => { fireRestyle(input); setInput('') }}
              className="px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Ask
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Top-level SlideEditor ─────────────────────────────────────────────────────

export default function SlideEditor({ piece, onBack, formatLabel, formatSub, photoCount, scheduleNode }) {
  const workspace = useWorkspace()
  const navigate = useNavigate()
  const brandStyle = workspace?.brand_style || {}
  const mediaUrls = (piece?.media_urls || []).filter((m) => m && m.type !== 'video' && m.url)
  const hasMedia = mediaUrls.length > 0
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
  const [themeId, setThemeId] = useState(() => piece?.photo_template_id || null)
  const [activeSlideIdx, setActiveSlideIdx] = useState(0)
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false)
  const [adExportOpen, setAdExportOpen] = useState(false)

  useEffect(() => {
    const next = seedSlides()
    setSlides(next)
    setSavedSlidesJson(JSON.stringify(next))
    setThemeId(piece?.photo_template_id || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece?.id, JSON.stringify(piece?.slides)])

  // Fetch workspace custom templates for the picker
  const { data: allThemes = [] } = usePhotoTemplates()
  const customThemes = allThemes.filter((t) => t.custom)
  const theme = resolveTheme(themeId, customThemes)

  // Global font size step applied on top of the active template (0 = template default)
  const [_globalFontSizeStep, setGlobalFontSizeStep] = useState(0)

  const dirty = JSON.stringify(slides) !== savedSlidesJson || themeId !== (piece?.photo_template_id || null)
  const updateItem = useUpdateContentItem()
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
    // New slide binds to the first un-bound photo, falling back to last photo
    const usedIdxs = new Set(slides.map((s) => s.photo_idx).filter((p) => typeof p === 'number'))
    const nextPhoto = mediaUrls.findIndex((_, i) => !usedIdxs.has(i))
    setSlides(slides.concat([{
      photo_idx: nextPhoto >= 0 ? nextPhoto : (mediaUrls.length > 0 ? mediaUrls.length - 1 : null),
      template: 'custom',
      blocks: [],
    }]))
  }
  function bindPhoto(idx, photoIdx) {
    updateSlide(idx, { ...slides[idx], photo_idx: photoIdx })
  }

  // "Apply this theme to all slides" — set the deck theme to the chosen one and
  // clear every per-slide override so the whole deck reads uniformly again.
  function handleApplyThemeToAll(themeIdToApply) {
    const id = themeIdToApply || 'dark-split'
    setThemeId(id)
    setSlides((prev) => prev.map((s) => (s.template_id ? { ...s, template_id: null } : s)))
    toast.success('Theme applied to all slides')
  }

  // ChangeTheLookPanel callbacks
  function handleThemeChange(newThemeId) {
    setThemeId(newThemeId || null)
  }
  function handleFontSizeStep(step) {
    setGlobalFontSizeStep((prev) => Math.max(-2, Math.min(2, prev + step)))
  }
  function handlePageNumbers(enabled) {
    // Mark each slide to show page numbers by adding a 'page' block if not present
    setSlides((prev) => prev.map((s) => {
      const hasPage = s.blocks.some((b) => b.role === 'page')
      if (enabled && !hasPage) {
        return { ...s, blocks: [...s.blocks, emptyBlockFor(s.template, 'page')] }
      }
      return s
    }))
  }
  function handleSlideCountTarget(target) {
    setSlides((prev) => {
      if (prev.length <= target) return prev
      // Keep first slide (hook) and last slide (CTA), trim body slides from the middle
      const first = prev[0]
      const last = prev[prev.length - 1]
      if (target <= 1) return [first]
      if (target === 2) return [first, last]
      const body = prev.slice(1, prev.length - 1)
      const keep = body.slice(0, target - 2)
      return [first, ...keep, last]
    })
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
        patch: { slides: toPersist, photo_template_id: themeId || null },
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
    ? mediaUrls[activeSlide.photo_idx].url
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

      {/* ── WORK AREA — canvas (dominant) + right inspector ──────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Active slide canvas */}
        <section className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto p-6" style={{ background: 'hsl(220 18% 94%)' }}>
          <div className="flex items-center gap-2 text-2xs text-muted-foreground">
            <span className="font-semibold">Slide {activeSlideIdx + 1} of {slides.length}</span>
            <span>·</span>
            <label className="flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={safeZones} onChange={(e) => setSafeZones(e.target.checked)} className="accent-primary" />
              safe zones
            </label>
            <span>·</span>
            <span>4:5</span>
          </div>

          {activeSlide ? (
            <div className="relative" style={{ width: 'min(360px, 60vh)' }}>
              <SlidePreview
                slide={activeSlide}
                photoUrl={activePhotoUrl}
                brandStyle={brandStyle}
                theme={activeTheme}
                onReframe={(next) => updateSlide(activeSlideIdx, next)}
                className={`w-full aspect-[4/5] rounded-xl border bg-muted shadow-lg ${activePhotoUrl ? 'cursor-move' : ''}`}
              />
              {safeZones && (
                <div className="pointer-events-none absolute inset-0 rounded-xl">
                  <div className="absolute inset-[7%] rounded border border-dashed border-white/50" />
                  <div className="absolute inset-x-0 top-0 h-[10%] bg-rose-500/10" />
                  <div className="absolute inset-x-0 bottom-0 h-[14%] bg-rose-500/10" />
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No slides yet</p>
          )}
          <p className="text-3xs text-muted-foreground">Drag the photo to reposition · scroll to zoom · edit text in the panel →</p>
        </section>

        {/* Right inspector */}
        <aside className="flex w-80 shrink-0 flex-col border-l bg-white overflow-hidden">
          {activeSlide ? (
            <ActiveSlideInspector
              slide={activeSlide}
              slideIdx={activeSlideIdx}
              totalSlides={slides.length}
              photoUrl={activePhotoUrl}
              mediaUrls={mediaUrls}
              allThemes={allThemes}
              customThemes={customThemes}
              globalThemeId={themeId}
              onChange={(next) => updateSlide(activeSlideIdx, next)}
              onRemove={() => removeSlide(activeSlideIdx)}
              onMoveLeft={() => {
                moveSlide(activeSlideIdx, -1)
                setActiveSlideIdx((i) => Math.max(0, i - 1))
              }}
              onMoveRight={() => {
                moveSlide(activeSlideIdx, 1)
                setActiveSlideIdx((i) => Math.min(slides.length - 1, i + 1))
              }}
              onBindPhoto={(photoIdx) => bindPhoto(activeSlideIdx, photoIdx)}
              onApplyThemeToAll={handleApplyThemeToAll}
              slideCount={slides.length}
              onThemeChange={handleThemeChange}
              onFontSizeStep={handleFontSizeStep}
              onPageNumbers={handlePageNumbers}
              onSlideCountTarget={handleSlideCountTarget}
            />
          ) : (
            <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground p-4">
              Add a slide to start editing
            </div>
          )}
        </aside>
      </div>

      {/* ── BOTTOM filmstrip navigator ───────────────────────────────────── */}
      <div className="border-t bg-white shrink-0">
        <SlideFilmstrip
          slides={slides}
          activeIdx={activeSlideIdx}
          mediaUrls={mediaUrls}
          onSelect={(idx) => setActiveSlideIdx(idx)}
          onAdd={addSlide}
        />
      </div>
    </div>
  )
}
