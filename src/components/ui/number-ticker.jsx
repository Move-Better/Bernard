import * as React from 'react'

// NumberTicker — counts a number up to its target with an eased requestAnimationFrame
// sweep (magicui-style), with NO dependency (motion/framer-motion not needed for a
// count-up). Animates the first time it scrolls into view, and re-animates from the
// current value whenever `value` changes — so async-loaded stats (e.g. the all-time
// recap numbers that arrive after mount) animate when their data resolves, not just
// on mount. Honors prefers-reduced-motion by snapping straight to the value.

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function NumberTicker({
  value,
  // How to render the animating number. Default rounds + thousands-separates.
  format = (v) => Math.round(v).toLocaleString(),
  duration = 1100,
  className,
  style,
}) {
  const ref = React.useRef(null)
  const rafRef = React.useRef(0)
  const displayRef = React.useRef(0)
  const [display, setDisplay] = React.useState(0)
  const finite = Number.isFinite(value)

  const set = React.useCallback((v) => {
    displayRef.current = v
    setDisplay(v)
  }, [])

  const animateTo = React.useCallback((target) => {
    cancelAnimationFrame(rafRef.current)
    if (prefersReduced()) { set(target); return }
    const from = displayRef.current
    const start = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
      set(from + (target - from) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(step)
      else set(target)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [duration, set])

  React.useEffect(() => {
    if (!finite) return
    const el = ref.current
    if (!el) return
    // Fire when the element is at least partly visible. Re-running on `value`
    // change re-observes; if already on screen the callback fires synchronously
    // and animates from the current display value to the new target.
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) animateTo(value) },
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(rafRef.current) }
  }, [value, finite, animateTo])

  // Non-numeric values (shouldn't happen, but be safe) render as-is.
  if (!finite) {
    return <span ref={ref} className={className} style={style}>{value}</span>
  }
  return <span ref={ref} className={className} style={style}>{format(display)}</span>
}

export { NumberTicker }
