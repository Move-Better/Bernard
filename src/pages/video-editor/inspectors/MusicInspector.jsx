import { fmt } from '../constants'
import { MusicToggle } from '../shared'
import { apiFetch } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { Check, Loader2, Pause, Play, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// Music bed (WS3.3) — curated licensed tracks, one-tap add, auto-duck under the
// voice. Preview plays the raw track; the duck/mix happens server-side at export.
export function MusicInspector({ ctx }) {
  const { music, setMusic } = ctx
  const [mood, setMood] = useState('all')
  const [previewId, setPreviewId] = useState(null)
  const audioRef = useRef(null)
  const { data, isLoading } = useQuery({
    queryKey: ['music-tracks'],
    queryFn: () => apiFetch('/api/editorial/music-tracks'),
    staleTime: 5 * 60_000,
  })
  const tracks = data?.tracks || []
  const moods = ['all', ...(data?.moods || [])]
  const shown = tracks.filter((t) => mood === 'all' || t.mood === mood)
  useEffect(() => () => { audioRef.current?.pause() }, [])
  function preview(t) {
    const a = audioRef.current
    if (!a) return
    if (previewId === t.id) { a.pause(); setPreviewId(null); return }
    a.src = t.url; a.currentTime = 0; a.volume = 0.85
    a.play().then(() => setPreviewId(t.id)).catch(() => setPreviewId(null))
  }
  const pick = (t) => setMusic((m) => ({ ...m, trackId: m.trackId === t.id ? null : t.id }))
  return (
    <div className="space-y-3">
      <p className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Music library <span className="text-muted-foreground/70">· licensed</span></p>
      <audio ref={audioRef} onEnded={() => setPreviewId(null)} className="hidden" />
      <div className="flex flex-wrap gap-1.5">
        {moods.map((mo) => (
          <button key={mo} type="button" onClick={() => setMood(mo)} className={`rounded-full px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide transition-colors ${mood === mo ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}>{mo}</button>
        ))}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" /></div>
      ) : tracks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-2xs text-muted-foreground" style={{ borderColor: 'hsl(var(--border))' }}>
          No music tracks yet — a curated licensed set is being added. Check back soon.
        </div>
      ) : (
        <div className="space-y-1.5">
          {shown.map((t) => {
            const on = music.trackId === t.id
            const isPlaying = previewId === t.id
            return (
              <div key={t.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${on ? 'border-primary bg-primary/5' : 'border-border'}`} style={on ? undefined : { borderColor: 'hsl(var(--border))' }}>
                <button type="button" onClick={() => preview(t)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: 'hsl(var(--primary)/.1)' }} title={isPlaying ? 'Stop preview' : 'Preview'}>
                  {isPlaying ? <Pause className="h-3.5 w-3.5 text-primary" /> : <Play className="h-3.5 w-3.5 text-primary" />}
                </button>
                <button type="button" onClick={() => pick(t)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-2xs font-semibold text-foreground">{t.title}</p>
                  <p className="text-3xs text-muted-foreground">{t.mood}{t.durationSec ? ` · ${fmt(t.durationSec)}` : ''}</p>
                </button>
                {on
                  ? <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Added" />
                  : <button type="button" onClick={() => pick(t)} className="shrink-0 text-3xs font-semibold text-primary">Add</button>}
              </div>
            )
          })}
        </div>
      )}
      {music.trackId && (
        <div className="space-y-2.5 border-t pt-3" style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xs font-semibold">Auto-duck under voice</p>
              <p className="text-3xs text-muted-foreground">Music drops while anyone speaks.</p>
            </div>
            <MusicToggle on={music.duck} onClick={() => setMusic((m) => ({ ...m, duck: !m.duck }))} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-3xs text-muted-foreground">
              <span className="flex items-center gap-1"><Volume2 className="h-3 w-3" />Music volume</span>
              <span>{Math.round(music.volume * 100)}%</span>
            </div>
            <input type="range" min="0" max="60" value={Math.round(music.volume * 100)} onChange={(e) => setMusic((m) => ({ ...m, volume: parseInt(e.target.value, 10) / 100 }))} className="h-4 w-full accent-primary" aria-label="Music volume" />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-2xs font-semibold">Fade in / out</p>
            <MusicToggle on={music.fade} onClick={() => setMusic((m) => ({ ...m, fade: !m.fade }))} />
          </div>
          <p className="text-3xs text-muted-foreground">Music is mixed in when you export or publish this clip. The preview here plays the raw track.</p>
        </div>
      )}
    </div>
  )
}
