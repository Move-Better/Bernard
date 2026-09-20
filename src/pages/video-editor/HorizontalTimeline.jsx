import { MAX_CLIP_SECONDS, clamp, isOverlaySel } from './constants'
import { nearestWithin } from '@/lib/captionTimeline'
import { Plus, Type } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// Bottom horizontal timeline (v4, CapCut-style) — source-relative
// (0..videoDuration). The Clip track shows the trim window [startSec,endSec]
// with left/right drag handles; the Text track shows overlay bars
// (clip-relative in/out, drawn at startSec+in) that drag freely (anchored to
// the grab point) and resize via their edges. Dragging (or clicking) anywhere
// on the track scrubs the red playhead, same as CapCut's timeline.
export function HorizontalTimeline({ ctx }) {
  const { startSec, endSec, durationSec, videoDuration, setStartSec, setEndSec, overlays, selectKey, sel, setOverlayWindow, displayClipT, setScrubT, addOverlay, seekClip, lines, editCaptionLine, trimSnaps } = ctx
  const span = videoDuration > 0 ? videoDuration : Math.max(endSec, 1)
  const trackRef = useRef(null)
  const scrollRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  // Timeline zoom: 1 = fit (the whole source fills the width). Below 1 shrinks
  // the clip into empty space (CapCut-style zoom-out); above 1 makes the track
  // wider than the viewport so it scrolls. The zoom slider is perceptual (log)
  // so the zoom-OUT range gets real slider travel instead of being squished
  // into the far left — that's the "easier control" people asked for.
  const MIN_ZOOM = 0.35, MAX_ZOOM = 12
  const zoomToSlider = (z) => Math.round(1000 * Math.log(z / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM))
  const sliderToZoom = (v) => +(MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, v / 1000)).toFixed(3)
  const f = (s) => clamp(s / span, 0, 1) * 100
  const SNAP_PX = 8
  const trim = (which) => (e) => {
    e.preventDefault(); e.stopPropagation()
    const move = (ev) => {
      const r = trackRef.current?.getBoundingClientRect(); if (!r || span <= 0) return
      let s = clamp((ev.clientX - r.left) / r.width, 0, 1) * span
      // Snap (within SNAP_PX) to the playhead / clip edges AND to transcript word
      // boundaries so a trim lands cleanly BETWEEN words — the in-handle to word
      // STARTS, the out-handle to word ENDS — instead of slicing a word in half and
      // mistiming the first/last caption. Nearest candidate within tolerance wins;
      // a silent gap has no boundaries, so trims there stay free.
      const tol = (SNAP_PX / r.width) * span
      const wordCands = which === 'in' ? (trimSnaps?.starts || []) : (trimSnaps?.ends || [])
      s = nearestWithin(s, [startSec + displayClipT, 0, span, ...wordCands], tol)
      // Clamp to a ≤MAX_CLIP_SECONDS window so the clip can't exceed what the
      // server will render (else the export silently truncates the tail).
      if (which === 'in') setStartSec(clamp(s, Math.max(0, endSec - MAX_CLIP_SECONDS), endSec - 1))
      else setEndSec(clamp(s, startSec + 1, Math.min(span, startSec + MAX_CLIP_SECONDS)))
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  const ovDown = (o, edge) => (e) => {
    e.preventDefault(); e.stopPropagation(); selectKey(`overlay:${o.id}`)
    const r = trackRef.current?.getBoundingClientRect(); const startX = e.clientX; const inAt = o.in; const len = o.out - o.in
    const move = (ev) => {
      if (!r || span <= 0) return
      if (edge === 'move') {
        const d = (ev.clientX - startX) / r.width * span
        const ni = clamp(inAt + d, 0, Math.max(0, durationSec - len))
        setOverlayWindow(o.id, ni, ni + len)
      } else {
        const clipSec = clamp((ev.clientX - r.left) / r.width * span - startSec, 0, durationSec)
        if (edge === 'l') setOverlayWindow(o.id, Math.min(clipSec, o.out - 0.5), o.out)
        else setOverlayWindow(o.id, o.in, Math.max(clipSec, o.in + 0.5))
      }
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  const scrub = (e) => {
    e.preventDefault()
    const r = trackRef.current?.getBoundingClientRect(); if (!r || span <= 0) return
    const seekAt = (ev) => {
      const clipT = clamp(clamp((ev.clientX - r.left) / r.width, 0, 1) * span - startSec, 0, durationSec)
      setScrubT(clipT)
      seekClip(clipT)
    }
    seekAt(e)
    const move = (ev) => seekAt(ev)
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  // Wheel-to-zoom (native non-passive listener so preventDefault is allowed).
  useEffect(() => {
    const sc = scrollRef.current; if (!sc) return
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      setZoom((z) => clamp(+(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)).toFixed(3), MIN_ZOOM, MAX_ZOOM))
    }
    sc.addEventListener('wheel', onWheel, { passive: false })
    return () => sc.removeEventListener('wheel', onWheel)
  }, [])
  // On first open, zoom so the trimmed clip comfortably fills the timeline
  // viewport instead of being crammed into a fraction of the whole-source view —
  // this makes the caption boxes readable on arrival rather than truncated to a
  // character each. The 0.72 factor keeps it from opening TOO zoomed-in (a
  // reported "feels crowded" complaint); Fit still shows the whole source and
  // the slider zooms out further. Fires once, only after the real duration is
  // known; the floor is 1 (fit) so it never opens pre-shrunk. The playhead-in-
  // view effect below scrolls the clip start into view right after.
  const didAutoZoom = useRef(false)
  useEffect(() => {
    if (didAutoZoom.current) return
    const clipLen = endSec - startSec
    if (videoDuration <= 0 || span <= 0 || clipLen <= 0) return
    didAutoZoom.current = true
    setZoom(clamp(+(span / clipLen * 0.72).toFixed(2), 1, MAX_ZOOM))
  }, [videoDuration, span, endSec, startSec])
  // Keep the playhead in view as it moves or the zoom changes.
  useEffect(() => {
    const sc = scrollRef.current, tr = trackRef.current; if (!sc || !tr) return
    const phX = clamp((startSec + displayClipT) / span, 0, 1) * tr.offsetWidth
    const m = sc.clientWidth * 0.12
    if (phX < sc.scrollLeft + m) sc.scrollLeft = Math.max(0, phX - m)
    else if (phX > sc.scrollLeft + sc.clientWidth - m) sc.scrollLeft = phX - sc.clientWidth + m
  }, [displayClipT, zoom, startSec, span])
  const zoomBtn = 'flex h-6 items-center justify-center rounded border px-1.5 text-3xs hover:border-primary'
  const atFit = Math.abs(zoom - 1) < 0.02
  return (
    <div className="flex h-[172px] shrink-0 flex-col border-t bg-card" style={{ borderColor: 'hsl(var(--border))' }}>
      <div className="flex items-center justify-between px-3 pt-2 text-3xs font-semibold uppercase" style={{ color: 'hsl(var(--muted-foreground))' }}>
        <span>Timeline</span>
        <div className="flex items-center gap-2 normal-case">
          <input
            type="range"
            aria-label="Timeline zoom"
            min={0}
            max={1000}
            value={zoomToSlider(zoom)}
            onChange={(e) => setZoom(clamp(sliderToZoom(+e.target.value), MIN_ZOOM, MAX_ZOOM))}
            className="w-28 cursor-pointer"
            style={{ accentColor: 'hsl(var(--primary))' }}
          />
          <button
            onClick={() => setZoom(1)}
            aria-label="Fit timeline"
            className={zoomBtn}
            style={{ borderColor: atFit ? 'hsl(var(--primary))' : 'hsl(var(--border))', color: atFit ? 'hsl(var(--primary))' : undefined }}
          >Fit</button>
          <span className="w-9 text-right tabular-nums" style={{ color: 'hsl(var(--muted-foreground))' }}>{Math.round(zoom * 100)}%</span>
          {/* Reuses zoomBtn (the row's own button class) rather than restating
              its border/hover, so this can't drift away from its neighbours
              later. It was the only control in this row with no hover response,
              which read as a label despite being the one action that edits the
              clip. Keeps text-primary to mark it as the additive action. */}
          <button onClick={addOverlay} className={`${zoomBtn} ml-1 gap-0.5 text-primary`}><Plus className="h-3 w-3" />Text</button>
        </div>
      </div>
      <div ref={scrollRef} className="mx-3 mb-3 mt-2 flex-1 overflow-x-auto overflow-y-hidden">
      <div ref={trackRef} onMouseDown={scrub} className="relative flex h-full cursor-pointer flex-col gap-1.5" style={{ width: `${zoom * 100}%`, minWidth: 0 }}>
        <div className="relative flex-1 rounded-md" style={{ background: 'hsl(var(--muted))' }}>
          <div onClick={() => selectKey('clip')} className="absolute inset-y-0 cursor-pointer rounded-md" style={{ left: `${f(startSec)}%`, width: `${Math.max(0, f(endSec) - f(startSec))}%`, background: 'linear-gradient(90deg,hsl(var(--primary)/.85),hsl(var(--primary)/.6))', boxShadow: sel === 'clip' ? '0 0 0 2px hsl(var(--primary))' : undefined }} />
          <div
            role="slider"
            tabIndex={0}
            aria-label="Trim start"
            aria-valuemin={0}
            aria-valuemax={Math.round(endSec - 1)}
            aria-valuenow={Math.round(startSec)}
            onMouseDown={trim('in')}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft') setStartSec((s) => clamp(s - 0.5, Math.max(0, endSec - MAX_CLIP_SECONDS), endSec - 1)); else if (e.key === 'ArrowRight') setStartSec((s) => clamp(s + 0.5, Math.max(0, endSec - MAX_CLIP_SECONDS), endSec - 1)) }}
            className="absolute inset-y-0 z-10 cursor-ew-resize rounded-sm focus:outline-none focus:ring-1 focus:ring-primary"
            style={{ left: `calc(${f(startSec)}% - 5px)`, width: 11, background: 'hsl(var(--primary))' }}
          />
          <div
            role="slider"
            tabIndex={0}
            aria-label="Trim end"
            aria-valuemin={Math.round(startSec + 1)}
            aria-valuemax={Math.round(span)}
            aria-valuenow={Math.round(endSec)}
            onMouseDown={trim('out')}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft') setEndSec((s) => clamp(s - 0.5, startSec + 1, Math.min(span, startSec + MAX_CLIP_SECONDS))); else if (e.key === 'ArrowRight') setEndSec((s) => clamp(s + 0.5, startSec + 1, Math.min(span, startSec + MAX_CLIP_SECONDS))) }}
            className="absolute inset-y-0 z-10 cursor-ew-resize rounded-sm focus:outline-none focus:ring-1 focus:ring-primary"
            style={{ left: `calc(${f(endSec)}% - 6px)`, width: 11, background: 'hsl(var(--primary))' }}
          />
        </div>
        {/* caption lane — every spoken line is a box; tap to jump the playhead
            there and edit its words (reuses the on-video inline caption editor). */}
        <div className="relative flex-1 rounded-md" style={{ background: 'hsl(var(--muted))' }}>
          {lines.length ? lines.map((l, i) => {
            const isActive = sel === 'caption' && displayClipT >= l.start && displayClipT < l.end
            const left = f(startSec + l.start)
            const width = Math.max(2, f(startSec + l.end) - left)
            return (
              <div
                key={i}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); editCaptionLine(i) }}
                title={l.text}
                className="absolute inset-y-0 flex cursor-pointer items-center overflow-hidden rounded-md px-1.5"
                style={{ left: `${left}%`, width: `${width}%`, background: 'hsl(var(--info)/.9)', boxShadow: isActive ? '0 0 0 2px hsl(var(--info))' : undefined }}
              >
                <span className="truncate text-3xs font-medium" style={{ color: 'hsl(var(--info-foreground))' }}>{l.text}</span>
              </div>
            )
          }) : <span className="absolute inset-y-0 left-2 flex items-center text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Captions appear here</span>}
        </div>
        <div className="relative flex-1 rounded-md" style={{ background: 'hsl(var(--muted))' }}>
          {overlays.length ? overlays.map((o) => {
            const isSel = isOverlaySel(sel) && sel.id === o.id
            return (
              <div key={o.id} onMouseDown={ovDown(o, 'move')} className="absolute inset-y-0 cursor-grab overflow-hidden rounded-md" style={{ left: `${f(startSec + o.in)}%`, width: `${Math.max(3, f(startSec + o.out) - f(startSec + o.in))}%`, background: 'linear-gradient(90deg,hsl(var(--action)/.9),hsl(var(--action)/.7))', boxShadow: isSel ? '0 0 0 2px hsl(var(--action))' : undefined }}>
                <div onMouseDown={ovDown(o, 'l')} className="absolute inset-y-0 left-0 z-10 cursor-ew-resize" style={{ width: 9 }} />
                <div className="flex h-full items-center justify-center"><Type className="h-3 w-3" style={{ color: 'hsl(var(--action-foreground))' }} /></div>
                <div onMouseDown={ovDown(o, 'r')} className="absolute inset-y-0 right-0 z-10 cursor-ew-resize" style={{ width: 9 }} />
              </div>
            )
          }) : <span className="absolute inset-y-0 left-2 flex items-center text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>+ Text</span>}
        </div>
        <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: `${f(startSec + displayClipT)}%`, width: 2, background: 'hsl(0 80% 55%)' }}>
          <div onMouseDown={scrub} className="pointer-events-auto absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 cursor-ew-resize rounded-full" style={{ background: 'hsl(0 80% 55%)' }} />
        </div>
      </div>
      </div>
    </div>
  )
}
