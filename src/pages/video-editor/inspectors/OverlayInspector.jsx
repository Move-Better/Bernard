import { OVERLAY_ROLES } from '../constants'
import { InspectorShell, segBtn } from '../shared'
import { WORKSPACE_DEFAULT_ACCENT } from '@/lib/brandSwatches'
import { Move, Trash2, Type } from 'lucide-react'

export function OverlayInspector({ ctx }) {
  const { curOverlay, setOverlay, setOverlayTime, delOverlay, durationSec, flashAlignGuides, caption } = ctx
  const o = curOverlay
  if (!o) return null
  function alignOverlay(h, v) {
    if (h) setOverlay('x', 0.5)
    if (v) setOverlay('y', 0.5)
    flashAlignGuides?.()
  }
  const alignBtnCls = 'flex h-[26px] items-center justify-center rounded border transition-colors'
  return (
    <InspectorShell icon={Type} title="Text overlay" right={
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => alignOverlay(true, false)} title="Center horizontally" aria-label="Center horizontally"
          className={`${alignBtnCls} w-[26px]`} style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5"/><rect x="2" y="5" width="10" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
        </button>
        <button type="button" onClick={() => alignOverlay(false, true)} title="Center vertically" aria-label="Center vertically"
          className={`${alignBtnCls} w-[26px]`} style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5"/><rect x="5" y="2" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
        </button>
        <button type="button" onClick={() => alignOverlay(true, true)} title="Center on frame" aria-label="Center on frame"
          className={`${alignBtnCls} gap-1 px-2 text-2xs font-semibold border-primary/35 bg-primary/[0.06] text-primary`}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><line x1="6" y1="0" x2="6" y2="12" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5"/><line x1="0" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5"/><circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>
          Center
        </button>
      </div>
    }>
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Text</p>
      <textarea rows={2} aria-label="Overlay text content" value={o.text} onChange={(e) => setOverlay('text', e.target.value)} className="mb-3 w-full resize-none rounded-md border px-2 py-2 text-sm leading-snug outline-none focus:ring-1 focus:ring-primary/50" style={{ borderColor: 'hsl(var(--border))' }} />
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Role</p>
      <div className="mb-3 flex gap-1.5">
        {OVERLAY_ROLES.map(([k, n]) => <button key={k} onClick={() => setOverlay('role', k)} className="flex-1 rounded-md border py-1.5 text-3xs" style={segBtn(o.role === k)}>{n}</button>)}
      </div>
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>In / out (seconds)</p>
      <div className="mb-3 flex items-center gap-2 text-2xs">
        <input aria-label="Overlay start time (seconds)" type="number" step="0.5" min="0" max={durationSec} value={o.in} onChange={(e) => setOverlayTime('in', e.target.value)} className="flex-1 rounded-md border px-2 py-1.5 text-right font-mono outline-none focus:ring-1 focus:ring-primary/50" style={{ borderColor: 'hsl(var(--border))' }} />
        <span style={{ color: 'hsl(var(--muted-foreground))' }}>→</span>
        <input aria-label="Overlay end time (seconds)" type="number" step="0.5" min="0" max={durationSec} value={o.out} onChange={(e) => setOverlayTime('out', e.target.value)} className="flex-1 rounded-md border px-2 py-1.5 text-right font-mono outline-none focus:ring-1 focus:ring-primary/50" style={{ borderColor: 'hsl(var(--border))' }} />
      </div>
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Size</p>
      <input aria-label="Text overlay size" type="range" min={50} max={160} value={Math.round((o.size || 1) * 100)} onChange={(e) => setOverlay('size', +e.target.value / 100)} className="mb-3 w-full" />
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Text color</p>
      <div className="mb-3 flex items-center gap-1.5">
        {['#ffffff', '#111111', caption?.accent || WORKSPACE_DEFAULT_ACCENT].map((c) => {
          const on = (o.color || '#ffffff').toLowerCase() === c.toLowerCase()
          return (
            <button key={c} type="button" onClick={() => setOverlay('color', c)} aria-label={`Text color ${c}`}
              className="h-6 w-6 rounded-full border"
              style={{ background: c, borderColor: on ? 'hsl(var(--primary))' : 'hsl(var(--border))', boxShadow: on ? '0 0 0 1.5px hsl(var(--primary))' : undefined }} />
          )
        })}
        <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border" style={{ borderColor: 'hsl(var(--border))' }} title="Custom color">
          <span className="absolute inset-0" style={{ background: 'conic-gradient(from 90deg, #f44, #fd4, #4d4, #4dd, #44f, #f4f, #f44)' }} aria-hidden="true" />
          <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(o.color || '') ? o.color : '#ffffff'} onChange={(e) => setOverlay('color', e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Custom overlay text color" />
        </label>
      </div>
      <div className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-2xs" style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
        <Move className="h-4 w-4 shrink-0" /><span><b>Drag the overlay</b> anywhere on the canvas.</span>
      </div>
      <button onClick={delOverlay} className="mt-3 w-full rounded-md border px-2 py-1.5 text-2xs" style={{ borderColor: 'hsl(var(--border))', color: 'hsl(0 70% 50%)' }}><Trash2 className="mr-1 inline h-3 w-3" />Delete overlay</button>
    </InspectorShell>
  )
}
