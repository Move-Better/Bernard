import { useRef } from 'react'
import { textEffectCss } from '@/lib/overlayTemplates'
import { blockFraction, WHOOP_CONTENT } from './shared'
import RichTextEditOverlay from './RichTextEditOverlay'
import FloatingTextToolbar from './FloatingTextToolbar'

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
