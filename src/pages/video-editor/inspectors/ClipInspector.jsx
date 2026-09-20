import { MAX_CLIP_SECONDS, fmt } from '../constants'
import { InspectorShell, segBtn } from '../shared'
import { Captions, Film, Loader2, Sparkles } from 'lucide-react'

// Source-relative trim: drag the in/out handles across the WHOLE source span to
// recut the clip window (clamped to a ≤60s window). Distinct from the bottom
// timeline, which is clip-relative (0..durationSec).
export function ClipInspector({ ctx }) {
  const { startSec, endSec, durationSec, reframe, setReframe, autoReframe, autoReframing, kenBurns, setKenBurns, speed, setSpeed, selectKey, caption, formatDim } = ctx
  const kbMotion = kenBurns?.motion || 'none'
  return (
    <InspectorShell icon={Film} title="Clip & reframe" right={formatDim}>
      <div className="mb-3 flex items-center gap-2 text-2xs">
        <span className="flex-1 rounded-md border border-border px-2 py-1.5 text-center font-mono">{fmt(startSec)}</span>
        <span className="text-muted-foreground">→</span>
        <span className="flex-1 rounded-md border border-border px-2 py-1.5 text-center font-mono">{fmt(endSec)}</span>
        <span className="text-3xs text-muted-foreground">({fmt(durationSec)})</span>
      </div>
      <p className="mb-3 rounded-md px-2 py-1 text-3xs bg-muted text-muted-foreground">Trim with the <b>Clip bar</b> on the timeline below · max {MAX_CLIP_SECONDS}s.</p>
      <p className="mb-1.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Reframe · position in {formatDim}</p>
      <button onClick={autoReframe} disabled={autoReframing} className="mb-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border py-1.5 text-2xs font-semibold disabled:opacity-60" style={{ borderColor: 'hsl(var(--action))', background: 'hsl(var(--action)/0.08)', color: 'hsl(var(--action))' }}>
        {autoReframing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Finding the speaker…</> : <><Sparkles className="h-3.5 w-3.5" />Auto-reframe to speaker</>}
      </button>
      {[['zoom', 'Zoom', 100, 220], ['x', 'Horizontal', 0, 100], ['y', 'Vertical', 0, 100]].map(([k, lbl, lo, hi]) => (
        <div key={k} className="mb-2">
          <div className="mb-1 flex justify-between text-2xs text-muted-foreground"><span>{lbl}</span><span>{reframe[k]}{k === 'zoom' ? '%' : ''}</span></div>
          <input aria-label={lbl} type="range" min={lo} max={hi} value={reframe[k]} onChange={(e) => setReframe(k, +e.target.value)} className="w-full" />
        </div>
      ))}
      <p className="mb-1.5 mt-3 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Motion</p>
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        {[['none', 'None'], ['push_in', 'Push in'], ['pull_out', 'Pull out'], ['pan_left', 'Pan ←'], ['pan_right', 'Pan →']].map(([m, l]) => (
          <button key={m} onClick={() => setKenBurns('motion', m)} className="rounded-md border py-1.5 text-3xs" style={segBtn(kbMotion === m)}>{l}</button>
        ))}
      </div>
      {kbMotion !== 'none' && (
        <div className="mb-1">
          <div className="mb-1 flex justify-between text-2xs text-muted-foreground"><span>Intensity</span><span>{kenBurns.intensity}</span></div>
          <input aria-label="Motion intensity" type="range" min={0} max={100} value={kenBurns.intensity} onChange={(e) => setKenBurns('intensity', +e.target.value)} className="w-full" />
        </div>
      )}
      <p className="mb-1.5 mt-3 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Speed</p>
      <div className="mb-3 flex gap-1.5">
        {[0.5, 1, 1.5, 2].map((s) => (
          <button key={s} onClick={() => setSpeed(s)} className="flex-1 rounded-md border py-1.5 text-2xs" style={segBtn(speed === s)}>{s}×</button>
        ))}
      </div>
      <p className="mb-1.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Captions</p>
      <button onClick={() => selectKey('caption')} className="flex w-full items-center justify-between rounded-md border border-border px-2 py-2 text-2xs">
        <span><Captions className="mr-1 inline h-3.5 w-3.5" />{caption.preset === 'off' ? 'Captions off' : `Karaoke · ${caption.position} · ${caption.size}`}</span>
        <span className="text-muted-foreground">›</span>
      </button>
    </InspectorShell>
  )
}
