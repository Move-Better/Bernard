import { useEffect, useRef } from 'react'
import { renderFreeformSlide, SLIDE_W, SLIDE_H } from '@/lib/overlayTemplates'

// ── Mini slide render — a real renderFreeformSlide miniature for the theme grid
// (so theme tiles look like what they actually produce, not a placeholder). The
// canvas bitmap is set by the renderer; CSS scales it down. `renderKey` gates
// re-renders so we don't redraw 6 canvases on every keystroke.

export default function MiniSlideCanvas({ renderSlide, photoUrl, brandStyle, theme, renderKey }) {
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
