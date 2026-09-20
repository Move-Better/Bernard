import { fmt } from '../constants'
import { InspectorShell } from '../shared'
import { Loader2, Scissors } from 'lucide-react'

// Moments — the AI proposals picker (replaces the old clip-review lane).
export function MomentsInspector({ ctx }) {
  const { proposals, selectedSegmentId, applySegment, discardSegment, findMoments, findingMoments, segDetecting } = ctx
  const loading = findingMoments || segDetecting
  return (
    <InspectorShell icon={Scissors} title="Moments" right={proposals.length ? `${proposals.length}` : ''}>
      {loading ? (
        <div role="status" className="flex items-center gap-2 text-2xs" style={{ color: 'hsl(var(--muted-foreground))' }}><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /><span className="sr-only">Finding moments…</span><span aria-hidden="true">Finding moments…</span></div>
      ) : proposals.length === 0 ? (
        <>
          <p className="mb-2 text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>No AI moments yet — find the standalone clips in this source.</p>
          <button onClick={findMoments} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-primary py-2 text-2xs text-primary"><Scissors className="h-3.5 w-3.5" />Find clips</button>
        </>
      ) : (
        <>
          {proposals.map((s) => {
            const on = s.id === selectedSegmentId
            const dur = Math.max(0, (Number(s.end_sec) || 0) - (Number(s.start_sec) || 0))
            return (
              <div key={s.id} className={`mb-1.5 rounded-md border p-2 ${on ? 'border-primary bg-primary/[0.06]' : ''}`}>
                <button onClick={() => applySegment(s)} className="block w-full text-left">
                  <span className={`block text-2xs font-medium ${on ? 'text-primary' : ''}`}>{s.hook || 'Moment'}</span>
                  <span className="block text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{fmt(Number(s.start_sec) || 0)} · {Math.round(dur)}s</span>
                </button>
                <button onClick={() => discardSegment(s.id)} className="mt-1 text-3xs" style={{ color: 'hsl(0 60% 50%)' }}>Discard</button>
              </div>
            )
          })}
          <button onClick={findMoments} className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border py-1.5 text-3xs" style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}><Scissors className="h-3 w-3" />Re-find</button>
        </>
      )}
    </InspectorShell>
  )
}
