import { useRef } from 'react'
import { textEffectCss } from '@/lib/overlayTemplates'
import { blockFraction, WHOOP_CONTENT } from './shared'
import RichTextEditOverlay from './RichTextEditOverlay'
import FloatingTextToolbar from './FloatingTextToolbar'

// Approximate the canvas font metrics (overlayTemplates.roleTypography) closely
// enough to size the invisible hit-box mirror below. This drives the CLICK
// TARGET only — never a rendered or published pixel — so a small drift just
// makes the box marginally taller/shorter, never produces wrong output. Font
// SIZE is px on the 1080-wide canvas; the mirror emits it as `cqw` against the
// stage container so the box scales with the preview at any aspect/zoom.
const ROLE_SIZE = { hook: 84, body: 44, caption: 36, cta: 42, attribution: 30, page: 28 }
const ROLE_WEIGHT = { hook: 800, body: 600, caption: 500, cta: 700, attribution: 500, page: 600 }
const THEME_SIZE_PX = { xs: 28, sm: 36, base: 44, lg: 56, xl: 72, '2xl': 84, '3xl': 100 }
function hitBoxTextStyle(block, theme) {
  const role = ROLE_SIZE[block.role] != null ? block.role : 'body'
  const themeBlock = theme?.blocks?.[role] ?? null
  let size = ROLE_SIZE[role]
  let upper = role === 'hook'
  if (themeBlock) {
    size = THEME_SIZE_PX[themeBlock.fontSize] ?? (role === 'cta' ? 42 : 44)
    if (typeof themeBlock.uppercase === 'boolean') upper = themeBlock.uppercase
  }
  if (Number.isFinite(block.fontScale) && block.fontScale > 0 && block.fontScale !== 1) size *= block.fontScale
  if (typeof block.uppercase === 'boolean') upper = block.uppercase
  return {
    fontSize: `${(size / 1080) * 100}cqw`,
    lineHeight: 1.18,
    fontWeight: block.fontWeight || ROLE_WEIGHT[role],
    textTransform: upper ? 'uppercase' : 'none',
  }
}

// On-canvas text layer: each block is a box you click to select, drag to place,
// and DOUBLE-CLICK to edit inline (a contentEditable over the block; the canvas
// skips that block's text while editing so there's no double-vision). When a
// block is selected, the floating toolbar rides above it. The canvas underneath
// is the true render.
export default function TextDragLayer({ slide, theme, selection, onSelectBlock, onMoveBlock, onSetStyle, onSetRuns, editingIdx, setEditingIdx, onDragging, onSnap }) {
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
    <div ref={rootRef} className="pointer-events-none absolute inset-0 rounded-xl" style={{ containerType: 'inline-size' }}>
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
            {/* Invisible text mirror: grows the hit box to the block's real
                rendered height so the WHOLE headline is clickable, not just the
                central band. color:transparent + pointer-events-none means it
                never shows and never steals a click — the canvas below stays the
                true render. Absent while editing (the contentEditable sizes the
                box then) so there's no double text. */}
            {!editing && (b.text || '').trim() && (
              <span
                aria-hidden="true"
                className="pointer-events-none block w-full select-none whitespace-pre-wrap break-words text-center"
                style={{ color: 'transparent', ...hitBoxTextStyle(b, theme) }}
              >
                {b.text}
              </span>
            )}
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
