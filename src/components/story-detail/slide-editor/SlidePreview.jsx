import { useEffect, useRef } from 'react'
import { renderFreeformSlide, SLIDE_W, SLIDE_H } from '@/lib/overlayTemplates'
import { AD_CAROUSEL_DIMS } from '@/lib/renderSlides'

// ── Slide card ────────────────────────────────────────────────────────────────

export default function SlidePreview({ slide, photoUrl, brandStyle, theme, onReframe, onSelectPhoto, className, aspect }) {
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
