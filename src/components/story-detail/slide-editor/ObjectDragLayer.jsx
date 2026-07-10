import { useRef } from 'react'

// ── Object drag layer (WS3.1) ────────────────────────────────────────────────
// Transparent hit-targets over the canvas for the objects layer (logo/watermark
// today). The canvas (renderFreeformSlide → drawSlideObject) is the truth; this
// layer only handles selection + drag, reusing the SAME snap targets as text
// (canvas centre, safe margins, and every other element's position) so objects
// align to text and to each other. An invisible <img> sizes the hit box to the
// logo's real footprint so the selection ring matches what's drawn.
export default function ObjectDragLayer({ slide, selection, onSelectObject, onMoveObject, onDragging, onSnap }) {
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
