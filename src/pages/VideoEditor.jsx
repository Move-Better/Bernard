import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, Play, Pause, Film, Sparkles, Captions, Type, Layers,
  Plus, Trash2, CalendarClock, Loader2, AlertCircle, Move,
  FolderOpen, Megaphone, ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppMutation } from '@/lib/useAppMutation'
import { apiFetch } from '@/lib/api'
import { getMediaAsset } from '@/lib/mediaLib'
import { getSegments, renderWholeVideo } from '@/lib/clipsLib'
import AdVideoExportModal from '@/components/AdVideoExportModal'
import { GRADE_SLIDERS, GRADE_VIBES, NEUTRAL_GRADE, gradeToCanvasFilter } from '@/lib/gradeParams'
import { toast } from '@/lib/toast'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

// ── helpers ──────────────────────────────────────────────────────────────────
const DEFAULT_CHANNEL = 'instagram_reel'
const fmt = (s) => {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60); const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const OVERLAY_ROLES = [['title', 'Title'], ['lower_third', 'Lower-third'], ['callout', 'Callout']]
const ROLE_FS = { title: 0.044, lower_third: 0.030, callout: 0.034 }

// Slice whole-source words to a clip window, rebased to 0 (mirrors the server's
// sliceWordsToWindow — the editor preview must match the bake).
function sliceWords(words, startSec, durationSec) {
  if (!Array.isArray(words)) return []
  const s = Math.max(0, startSec || 0); const end = s + Math.max(0, durationSec || 0)
  const out = []
  for (const w of words) {
    if (!w) continue
    const ws = Number(w.start); const we = Number(w.end)
    if (!Number.isFinite(ws) || !Number.isFinite(we) || we <= s || ws >= end) continue
    const word = String(w.word || '').trim(); if (!word) continue
    const start = Math.max(0, ws - s); const wEnd = Math.min(end - s, we - s)
    if (wEnd > start) out.push({ word, start, end: wEnd })
  }
  return out
}
// Greedy phrase grouping (≤5 words / ≤26 chars), mirrors groupWordsIntoLines.
function groupLines(words) {
  const lines = []; let cur = []; let chars = 0
  for (const w of words) {
    const wl = (w.word.length || 0) + 1
    if (cur.length && (cur.length >= 5 || chars + wl > 26)) { lines.push(cur); cur = []; chars = 0 }
    cur.push(w); chars += wl
  }
  if (cur.length) lines.push(cur)
  return lines.map((ws) => ({ start: ws[0].start, end: ws[ws.length - 1].end, words: ws, text: ws.map((w) => w.word).join(' ') }))
}

// ── LEFT RAIL ──────────────────────────────────────────────────────────────
function LayerRow({ active, icon: Icon, label, sub, onClick }) {
  return (
    <button
      onClick={onClick}
      className="mb-1 flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors"
      style={active
        ? { borderColor: 'hsl(var(--primary))', background: 'hsl(var(--primary)/0.08)' }
        : { borderColor: 'transparent' }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }} />
      <span className="min-w-0">
        <span className={`block truncate text-2xs ${active ? 'font-semibold' : ''}`} style={{ color: active ? 'hsl(var(--primary))' : 'hsl(var(--foreground))' }}>{label}</span>
        {sub ? <span className="block truncate text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{sub}</span> : null}
      </span>
    </button>
  )
}

function LeftRail({ ctx }) {
  const { sel, selectKey, railMode, setRailMode, caption, overlays, addOverlay, lines, playClipT, seekClip } = ctx
  const selKey = typeof sel === 'object' ? `overlay:${sel.id}` : sel
  const tabStyle = (on) => on
    ? { color: 'hsl(var(--primary))', borderBottom: '2px solid hsl(var(--primary))', background: 'hsl(var(--primary)/0.06)' }
    : { color: 'hsl(var(--muted-foreground))', borderBottom: '2px solid transparent' }
  return (
    <aside className="flex w-[150px] shrink-0 flex-col border-r bg-card" style={{ borderColor: 'hsl(var(--border))' }}>
      <div className="flex border-b text-3xs font-semibold" style={{ borderColor: 'hsl(var(--border))' }}>
        <button onClick={() => setRailMode('layers')} className="flex flex-1 items-center justify-center gap-1 py-2" style={tabStyle(railMode === 'layers')}><Layers className="h-3.5 w-3.5" />Layers</button>
        <button onClick={() => setRailMode('transcript')} className="flex flex-1 items-center justify-center gap-1 py-2" style={tabStyle(railMode === 'transcript')}><Captions className="h-3.5 w-3.5" />Words</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {railMode === 'layers' ? (
          <>
            <p className="mb-1.5 px-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Layers · this clip</p>
            <LayerRow active={selKey === 'clip'} icon={Film} label="Video clip" sub="trim · reframe · speed" onClick={() => selectKey('clip')} />
            <LayerRow active={selKey === 'grade'} icon={Sparkles} label="Frame grade" sub="AI colorist look" onClick={() => selectKey('grade')} />
            <LayerRow active={selKey === 'caption'} icon={Captions} label="Captions" sub={caption.preset === 'off' ? 'off' : `auto · ${lines.length} lines`} onClick={() => selectKey('caption')} />
            {overlays.map((o) => (
              <LayerRow key={o.id} active={selKey === `overlay:${o.id}`} icon={Type}
                label={o.role === 'lower_third' ? 'Lower-third' : o.role[0].toUpperCase() + o.role.slice(1)}
                sub={`“${o.text.slice(0, 16)}${o.text.length > 16 ? '…' : ''}”`} onClick={() => selectKey(`overlay:${o.id}`)} />
            ))}
            <button onClick={addOverlay} className="mt-1 flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-2 text-3xs" style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}><Plus className="h-3.5 w-3.5" />Add overlay</button>
          </>
        ) : (
          <TranscriptRail lines={lines} playClipT={playClipT} seekClip={seekClip} ctx={ctx} />
        )}
      </div>
    </aside>
  )
}

function TranscriptRail({ lines, playClipT, seekClip, ctx }) {
  if (!lines.length) {
    return <p className="px-1 text-3xs italic" style={{ color: 'hsl(var(--muted-foreground))' }}>No transcript words on this clip yet — they appear here after “Find moments” transcribes the source.</p>
  }
  return (
    <>
      <p className="mb-1.5 px-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Spoken words · click ▸ to seek</p>
      {lines.map((l, i) => {
        const live = playClipT >= l.start && playClipT < l.end
        return (
          <div key={i} className="mb-1.5 rounded-md border p-1.5" style={{ borderColor: live ? 'hsl(var(--primary))' : 'hsl(var(--border))', background: live ? 'hsl(var(--primary)/0.05)' : undefined }}>
            <div className="mb-1 flex items-center gap-1">
              <button onClick={() => seekClip(l.start)} className="rounded p-0.5" style={{ color: 'hsl(var(--primary))' }} title="Seek here"><Play className="h-3 w-3" /></button>
              <span className="font-mono text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{l.start.toFixed(1)}–{l.end.toFixed(1)}s</span>
              <button onClick={() => ctx.trimToLine(l)} className="ml-auto rounded px-1 py-0.5 text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }} title="Set clip in/out to this line">⊢ trim</button>
            </div>
            <input
              value={l.text}
              onChange={(e) => ctx.editLine(i, e.target.value)}
              className="w-full rounded border-0 bg-transparent px-1 py-0.5 text-2xs outline-none focus:bg-card"
              style={{ color: 'hsl(var(--foreground))' }}
              aria-label="Edit caption line"
            />
          </div>
        )
      })}
    </>
  )
}

// ── CANVAS ───────────────────────────────────────────────────────────────────
function Canvas({ ctx }) {
  const { videoRef, asset, grade, reframe, caption, overlays, lines, playClipT, playing, togglePlay, sel, selectKey, safeZones, setSafeZones, startSec, dragOverlay } = ctx
  const activeLine = lines.find((l) => playClipT >= l.start && playClipT < l.end) || null
  const clipSelRing = sel === 'clip' || sel === 'grade'
  const z = (Number(reframe.zoom) || 100) / 100
  return (
    <section className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-4" style={{ background: 'hsl(220 16% 91%)' }}>
      <div className="absolute right-4 top-3 z-10 flex items-center gap-2 rounded-md bg-card/80 px-2 py-1 text-3xs backdrop-blur" style={{ color: 'hsl(var(--muted-foreground))' }}>
        <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={safeZones} onChange={(e) => setSafeZones(e.target.checked)} /> safe zones</label>
      </div>
      <div className="relative h-full max-h-full" style={{ aspectRatio: '9 / 16' }}>
        <div
          className={`group relative h-full w-full cursor-pointer overflow-hidden rounded-2xl bg-black ${clipSelRing ? 'ring-2 ring-offset-2' : ''}`}
          style={clipSelRing ? { boxShadow: '0 0 0 2px hsl(var(--primary))' } : undefined}
          onClick={togglePlay}
        >
          {asset?.blob_url ? (
            <video
              ref={videoRef} src={asset.blob_url} poster={asset.thumbnail_url || undefined} preload="metadata" playsInline
              className="absolute inset-0 h-full w-full object-cover"
              style={{ filter: gradeToCanvasFilter(grade), transform: `scale(${z})`, transformOrigin: `${reframe.x}% ${reframe.y}%` }}
              onLoadedMetadata={(e) => ctx.setVideoDuration(e.target.duration)}
              onPlay={() => ctx.setPlaying(true)}
              onPause={() => ctx.setPlaying(false)}
              onTimeUpdate={(e) => ctx.handleTimeUpdate(e.target.currentTime)}
            />
          ) : <div className="flex h-full items-center justify-center text-sm text-white/60">No video</div>}

          {/* caption karaoke */}
          {activeLine && caption.preset !== 'off' && (
            <div
              onClick={(e) => { e.stopPropagation(); selectKey('caption') }}
              className="pointer-events-auto absolute left-1/2 -translate-x-1/2 cursor-pointer text-center font-extrabold leading-tight"
              style={{
                maxWidth: '86%',
                top: caption.position === 'top' ? '11%' : caption.position === 'center' ? '46%' : 'auto',
                bottom: caption.position === 'bottom' ? '15%' : 'auto',
                fontSize: `clamp(14px, ${caption.size === 'large' ? 4.6 : caption.size === 'small' ? 3.0 : 3.8}vh, 40px)`,
                color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,.6)',
                outline: sel === 'caption' ? '1.5px dashed #fff' : 'none', outlineOffset: '4px',
              }}
            >
              {activeLine.words.map((w, i) => {
                const spoken = playClipT >= w.start
                return <span key={i} style={{ color: spoken ? caption.accent : '#fff' }}>{w.word}{' '}</span>
              })}
            </div>
          )}

          {/* manual overlays */}
          {overlays.map((o) => {
            if (playClipT < o.in || playClipT > o.out) return null
            const isSel = typeof sel === 'object' && sel.id === o.id
            const box = o.role === 'lower_third'
              ? { background: 'rgba(12,26,46,.62)', backdropFilter: 'blur(2px)', borderRadius: 8, padding: '6px 12px' }
              : o.role === 'callout'
                ? { background: caption.accent, color: '#fff', borderRadius: 8, padding: '5px 11px' } : {}
            return (
              <div
                key={o.id}
                onMouseDown={(e) => dragOverlay(e, o.id)}
                onClick={(e) => { e.stopPropagation(); selectKey(`overlay:${o.id}`) }}
                className="absolute cursor-move text-center font-bold leading-tight"
                style={{
                  left: `${o.x * 100}%`, top: `${o.y * 100}%`, transform: 'translate(-50%,-50%)', maxWidth: '84%',
                  fontSize: `clamp(13px, ${(ROLE_FS[o.role] || 0.034) * (o.size || 1) * 100}vh, 44px)`,
                  color: o.color || '#fff', textShadow: o.role === 'title' ? '0 2px 12px rgba(0,0,0,.55)' : 'none',
                  outline: isSel ? '1.5px solid hsl(var(--primary))' : 'none', outlineOffset: 3, ...box,
                }}
              >{o.text}</div>
            )
          })}

          {/* safe zones */}
          {safeZones && (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute rounded-[10px] border border-dashed" style={{ inset: '5% 4%', borderColor: 'rgba(255,255,255,.4)' }} />
              <div className="absolute inset-x-0 top-0" style={{ height: '13%', background: 'rgba(255,80,80,.10)' }} />
              <div className="absolute inset-x-0 bottom-0" style={{ height: '18%', background: 'rgba(255,80,80,.10)' }} />
            </div>
          )}

          {/* center play/pause indicator — click anywhere on the video to toggle.
              Visible when paused; fades out while playing unless you hover. */}
          <div
            className={`pointer-events-none absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition-opacity ${playing ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}
            style={{ background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(2px)' }}
          >
            {playing ? <Pause className="h-7 w-7 text-white" fill="#fff" /> : <Play className="h-7 w-7 text-white" fill="#fff" />}
          </div>
          <span className="absolute left-3 top-3 rounded bg-black/30 px-1.5 py-0.5 text-3xs text-white/70">9:16 · {fmt(ctx.durationSec)}{startSec > 0 ? ` · from ${fmt(startSec)}` : ''}</span>
        </div>
      </div>
    </section>
  )
}

// ── INSPECTOR ────────────────────────────────────────────────────────────────
function InspectorShell({ icon: Icon, title, right, children }) {
  return (
    <>
      <div className="mb-3 flex items-center gap-2 rounded-md px-2 py-1.5" style={{ background: 'hsl(var(--primary)/0.08)' }}>
        <Icon className="h-4 w-4" style={{ color: 'hsl(var(--primary))' }} />
        <span className="text-xs font-semibold" style={{ color: 'hsl(var(--primary))' }}>{title}</span>
        {right ? <span className="ml-auto text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{right}</span> : null}
      </div>
      {children}
    </>
  )
}

const segBtn = (on) => on
  ? { borderColor: 'hsl(var(--primary))', background: 'hsl(var(--primary)/0.08)', color: 'hsl(var(--primary))' }
  : { borderColor: 'hsl(var(--border))' }

// Source-relative trim: drag the in/out handles across the WHOLE source span to
// recut the clip window (clamped to a ≤60s window). Distinct from the bottom
// timeline, which is clip-relative (0..durationSec).
function TrimBar({ videoDuration, startSec, endSec, setStartSec, setEndSec }) {
  const trackRef = useRef(null)
  const dur = videoDuration || 0
  const frac = (s) => (dur > 0 ? clamp(s / dur, 0, 1) : 0)
  const onDown = (which) => (e) => {
    e.preventDefault(); e.stopPropagation()
    const move = (ev) => {
      const r = trackRef.current?.getBoundingClientRect()
      if (!r || dur <= 0) return
      const sec = clamp((ev.clientX - r.left) / r.width, 0, 1) * dur
      if (which === 'start') setStartSec(clamp(sec, 0, endSec - 1))
      else setEndSec(clamp(sec, startSec + 1, Math.min(startSec + 60, dur)))
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  return (
    <div ref={trackRef} className="relative my-1.5 h-6 select-none" style={{ touchAction: 'none' }}>
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" style={{ background: 'hsl(var(--muted))' }} />
      <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full" style={{ left: `${frac(startSec) * 100}%`, width: `${(frac(endSec) - frac(startSec)) * 100}%`, background: 'hsl(var(--primary)/0.5)' }} />
      {[['start', startSec], ['end', endSec]].map(([w, s]) => (
        <div key={w} onMouseDown={onDown(w)} title={fmt(s)} className="absolute top-1/2 h-5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm border shadow" style={{ left: `${frac(s) * 100}%`, background: 'hsl(var(--primary))', borderColor: 'hsl(var(--primary))' }} />
      ))}
    </div>
  )
}

function ClipInspector({ ctx }) {
  const { startSec, endSec, durationSec, videoDuration, setStartSec, setEndSec, reframe, setReframe, speed, setSpeed, selectKey, caption } = ctx
  return (
    <InspectorShell icon={Film} title="Clip & reframe" right="Reel 9:16">
      <p className="mb-1.5 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Trim · drag the handles</p>
      <TrimBar videoDuration={videoDuration} startSec={startSec} endSec={endSec} setStartSec={setStartSec} setEndSec={setEndSec} />
      <div className="mb-3 flex items-center gap-2 text-2xs">
        <span className="flex-1 rounded-md border px-2 py-1.5 text-center font-mono" style={{ borderColor: 'hsl(var(--border))' }}>{fmt(startSec)}</span>
        <span style={{ color: 'hsl(var(--muted-foreground))' }}>→</span>
        <span className="flex-1 rounded-md border px-2 py-1.5 text-center font-mono" style={{ borderColor: 'hsl(var(--border))' }}>{fmt(endSec)}</span>
        <span className="text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>({fmt(durationSec)})</span>
      </div>
      <p className="mb-1.5 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Reframe · position in 9:16</p>
      {[['zoom', 'Zoom', 100, 220], ['x', 'Horizontal', 0, 100], ['y', 'Vertical', 0, 100]].map(([k, lbl, lo, hi]) => (
        <div key={k} className="mb-2">
          <div className="mb-1 flex justify-between text-2xs" style={{ color: 'hsl(var(--muted-foreground))' }}><span>{lbl}</span><span>{reframe[k]}{k === 'zoom' ? '%' : ''}</span></div>
          <input type="range" min={lo} max={hi} value={reframe[k]} onChange={(e) => setReframe(k, +e.target.value)} className="w-full" />
        </div>
      ))}
      <p className="mb-1.5 mt-3 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Speed</p>
      <div className="mb-3 flex gap-1.5">
        {[0.5, 1, 1.5, 2].map((s) => (
          <button key={s} onClick={() => setSpeed(s)} className="flex-1 rounded-md border py-1.5 text-2xs" style={segBtn(speed === s)}>{s}×</button>
        ))}
      </div>
      <p className="mb-1.5 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Captions</p>
      <button onClick={() => selectKey('caption')} className="flex w-full items-center justify-between rounded-md border px-2 py-2 text-2xs" style={{ borderColor: 'hsl(var(--border))' }}>
        <span><Captions className="mr-1 inline h-3.5 w-3.5" />{caption.preset === 'off' ? 'Captions off' : `Karaoke · ${caption.position} · ${caption.size}`}</span>
        <span style={{ color: 'hsl(var(--muted-foreground))' }}>›</span>
      </button>
    </InspectorShell>
  )
}

function GradeInspector({ ctx }) {
  const { grade, setGradeKey, applyVibe, resetGrade } = ctx
  return (
    <InspectorShell icon={Sparkles} title="AI Colorist — Frame grade" right="whole clip">
      <p className="mb-1.5 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Vibe presets</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {GRADE_VIBES.map((v) => (
          <button key={v.id} onClick={() => applyVibe(v.params)} className="rounded-full border px-2.5 py-1 text-2xs" style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>{v.label}</button>
        ))}
      </div>
      <p className="mb-2 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Fine-tune</p>
      {GRADE_SLIDERS.map((s) => (
        <div key={s.key} className="mb-2">
          <div className="mb-1 flex justify-between text-2xs" style={{ color: 'hsl(var(--muted-foreground))' }}><span>{s.label}</span><span>{grade[s.key] > 0 ? '+' : ''}{grade[s.key]}</span></div>
          <input type="range" min={-50} max={50} value={grade[s.key] || 0} onChange={(e) => setGradeKey(s.key, +e.target.value)} className="w-full" />
        </div>
      ))}
      <button onClick={resetGrade} className="mt-2 w-full rounded-md py-1.5 text-2xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Reset adjustments</button>
    </InspectorShell>
  )
}

function CaptionInspector({ ctx }) {
  const { caption, setCaption, lines, setRailMode } = ctx
  const seg = (label, opts, key) => (
    <div className="mb-3">
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>{label}</p>
      <div className="flex gap-1.5">
        {opts.map((o) => <button key={o} onClick={() => setCaption(key, o)} className="flex-1 rounded-md border py-1.5 text-2xs" style={segBtn(caption[key] === o)}>{o[0].toUpperCase() + o.slice(1)}</button>)}
      </div>
    </div>
  )
  return (
    <InspectorShell icon={Captions} title="Captions" right="auto · from transcript">
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Animation</p>
      <div className="mb-3 flex gap-1.5">
        {['karaoke', 'off'].map((p) => <button key={p} onClick={() => setCaption('preset', p)} className="flex-1 rounded-md border py-1.5 text-3xs" style={segBtn(caption.preset === p)}>{p[0].toUpperCase() + p.slice(1)}</button>)}
      </div>
      {seg('Position', ['top', 'center', 'bottom'], 'position')}
      {seg('Size', ['small', 'medium', 'large'], 'size')}
      <button onClick={() => setRailMode('transcript')} className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border py-2 text-2xs" style={{ borderColor: 'hsl(var(--border))' }}>Edit the words ({lines.length})</button>
    </InspectorShell>
  )
}

function OverlayInspector({ ctx }) {
  const { curOverlay, setOverlay, setOverlayTime, delOverlay, durationSec } = ctx
  const o = curOverlay
  if (!o) return null
  return (
    <InspectorShell icon={Type} title="Text overlay" right="manual">
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Text</p>
      <textarea rows={2} value={o.text} onChange={(e) => setOverlay('text', e.target.value)} className="mb-3 w-full resize-none rounded-md border px-2 py-2 text-sm leading-snug outline-none" style={{ borderColor: 'hsl(var(--border))' }} />
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Role</p>
      <div className="mb-3 flex gap-1.5">
        {OVERLAY_ROLES.map(([k, n]) => <button key={k} onClick={() => setOverlay('role', k)} className="flex-1 rounded-md border py-1.5 text-3xs" style={segBtn(o.role === k)}>{n}</button>)}
      </div>
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>In / out (seconds)</p>
      <div className="mb-3 flex items-center gap-2 text-2xs">
        <input type="number" step="0.5" min="0" max={durationSec} value={o.in} onChange={(e) => setOverlayTime('in', e.target.value)} className="flex-1 rounded-md border px-2 py-1.5 text-right font-mono outline-none" style={{ borderColor: 'hsl(var(--border))' }} />
        <span style={{ color: 'hsl(var(--muted-foreground))' }}>→</span>
        <input type="number" step="0.5" min="0" max={durationSec} value={o.out} onChange={(e) => setOverlayTime('out', e.target.value)} className="flex-1 rounded-md border px-2 py-1.5 text-right font-mono outline-none" style={{ borderColor: 'hsl(var(--border))' }} />
      </div>
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Size</p>
      <input type="range" min={50} max={160} value={Math.round((o.size || 1) * 100)} onChange={(e) => setOverlay('size', +e.target.value / 100)} className="mb-3 w-full" />
      <div className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-2xs" style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
        <Move className="h-4 w-4 shrink-0" /><span><b>Drag the overlay</b> anywhere on the canvas.</span>
      </div>
      <button onClick={delOverlay} className="mt-3 w-full rounded-md border px-2 py-1.5 text-2xs" style={{ borderColor: 'hsl(var(--border))', color: 'hsl(0 70% 50%)' }}><Trash2 className="mr-1 inline h-3 w-3" />Delete overlay</button>
    </InspectorShell>
  )
}

function Inspector({ ctx }) {
  return (
    <aside className="flex w-[306px] shrink-0 flex-col border-l bg-card" style={{ borderColor: 'hsl(var(--border))' }}>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {ctx.sel === 'clip' && <ClipInspector ctx={ctx} />}
        {ctx.sel === 'grade' && <GradeInspector ctx={ctx} />}
        {ctx.sel === 'caption' && <CaptionInspector ctx={ctx} />}
        {typeof ctx.sel === 'object' && <OverlayInspector ctx={ctx} />}
      </div>
    </aside>
  )
}

// ── TIMELINE ─────────────────────────────────────────────────────────────────
function Timeline({ ctx }) {
  const { durationSec, playClipT, seekClip, sel, selectKey, overlays, caption, togglePlay, playing, addOverlay } = ctx
  const pct = (s) => durationSec > 0 ? (s / durationSec) * 100 : 0
  const onScrub = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    seekClip(clamp((e.clientX - r.left) / r.width * durationSec, 0, durationSec))
  }
  const ticks = []
  for (let s = 0; s <= durationSec; s += Math.max(2, Math.round(durationSec / 8))) ticks.push(s)
  return (
    <div className="shrink-0 border-t bg-card px-3 pb-3 pt-2" style={{ borderColor: 'hsl(var(--border))', height: 178 }}>
      <div className="mb-1.5 flex items-center gap-3">
        <button onClick={togglePlay} className="flex h-7 w-7 items-center justify-center rounded-full text-white" style={{ background: 'hsl(var(--primary))' }}>{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</button>
        <span className="font-mono text-2xs tabular-nums" style={{ color: 'hsl(var(--muted-foreground))' }}>{fmt(playClipT)} / {fmt(durationSec)}</span>
        <button onClick={addOverlay} className="ml-auto flex items-center gap-1 rounded-md border px-2 py-1 text-2xs font-medium" style={{ borderColor: 'hsl(var(--border))' }}><Type className="h-3 w-3" />Add text overlay</button>
      </div>
      <div className="relative ml-[78px] mb-1 h-3 select-none">
        {ticks.map((s) => <span key={s} className="absolute -translate-x-1/2 font-mono text-3xs" style={{ left: `${pct(s)}%`, color: 'hsl(var(--muted-foreground))' }}>{fmt(s)}</span>)}
      </div>
      <div className="relative">
        {['Clip', 'Captions', 'Overlays'].map((label) => (
          <div key={label} className="mb-1.5 flex items-center gap-2">
            <span className="w-[70px] shrink-0 text-right text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>{label}</span>
            <div className="relative h-8 flex-1 rounded-md" style={{ background: 'hsl(220 14% 93%)' }} onMouseDown={(e) => { if (!e.target.closest('[data-bar]')) onScrub(e) }}>
              {label === 'Clip' && (
                <div data-bar onClick={() => selectKey('clip')} className="absolute inset-0 flex items-center gap-1.5 rounded-md px-3" style={{ background: 'linear-gradient(90deg,hsl(var(--primary)/.85),hsl(var(--primary)/.6))', boxShadow: sel === 'clip' ? '0 0 0 2px hsl(var(--primary))' : undefined }}>
                  <Film className="h-3.5 w-3.5 text-white" /><span className="text-3xs font-semibold text-white">clip · {fmt(durationSec)}</span>
                </div>
              )}
              {label === 'Captions' && (caption.preset === 'off'
                ? <span className="flex h-full items-center px-2 text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>captions off</span>
                : <div data-bar onClick={() => selectKey('caption')} className="absolute inset-y-0 left-px right-px flex items-center gap-1.5 rounded-md px-2" style={{ background: 'hsl(var(--info)/.5)', boxShadow: sel === 'caption' ? '0 0 0 2px hsl(var(--info))' : undefined }}><Captions className="h-3 w-3 text-white" /><span className="text-3xs font-semibold text-white">karaoke captions</span></div>)}
              {label === 'Overlays' && (overlays.length
                ? overlays.map((o) => <div key={o.id} data-bar onClick={() => selectKey(`overlay:${o.id}`)} className="absolute inset-y-0 flex items-center gap-1 overflow-hidden rounded-md px-1.5" style={{ left: `${pct(o.in)}%`, width: `${pct(o.out - o.in)}%`, background: 'linear-gradient(90deg,hsl(var(--action)/.9),hsl(var(--action)/.7))', boxShadow: (typeof sel === 'object' && sel.id === o.id) ? '0 0 0 2px hsl(var(--action))' : undefined }}><Type className="h-3 w-3" style={{ color: '#3a2a00' }} /><span className="truncate text-3xs font-semibold" style={{ color: '#3a2a00' }}>{o.text.slice(0, 14)}</span></div>)
                : <span className="flex h-full items-center px-2 text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>no overlays — “Add text overlay”</span>)}
            </div>
          </div>
        ))}
        <div className="pointer-events-none absolute top-0 z-20" style={{ left: `calc(78px + ${pct(playClipT)}% * (100% - 78px) / 100)`, width: 2, height: '100%', background: 'hsl(0 80% 55%)' }} />
      </div>
    </div>
  )
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
export default function VideoEditor() {
  useDocumentTitle('Reel Editor · Slate')
  const { assetId } = useParams()
  const navigate = useNavigate()
  const videoRef = useRef(null)

  const { data: asset, isLoading, error } = useQuery({ queryKey: ['media-asset', assetId], queryFn: () => getMediaAsset(assetId), enabled: !!assetId, retry: 1 })
  const { data: segData } = useQuery({ queryKey: ['video-segments', assetId], queryFn: () => getSegments(assetId), enabled: !!assetId, staleTime: 30_000 })

  const [sel, setSel] = useState('clip')
  const [railMode, setRailMode] = useState('layers')
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [startSec, setStartSec] = useState(0)
  const [endSec, setEndSec] = useState(30)
  const [grade, setGrade] = useState({ ...NEUTRAL_GRADE })
  const [reframe, setReframe] = useState({ zoom: 100, x: 50, y: 50 })
  const [speed, setSpeedState] = useState(1)
  const [caption, setCaptionState] = useState({ preset: 'karaoke', position: 'bottom', size: 'medium', accent: '#0C7580' })
  const [overlays, setOverlays] = useState([])
  const [safeZones, setSafeZones] = useState(true)
  const seededRef = useRef(false)

  const durationSec = Math.max(1, endSec - startSec)
  const playClipT = clamp(currentTime - startSec, 0, durationSec)

  // Save & resume (local draft). On open, restore this asset's editor doc;
  // autosave it (debounced) on change. Per-browser (localStorage) — server sync
  // is a follow-up. Fully defensive: a missing/corrupt draft just opens fresh.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!assetId || restoredRef.current) return
    restoredRef.current = true
    try {
      const raw = localStorage.getItem(`videoEdit:${assetId}`)
      if (!raw) return
      const d = JSON.parse(raw)
      if (!d || typeof d !== 'object') return
      if (d.grade) setGrade(d.grade)
      if (d.reframe) setReframe(d.reframe)
      if (Array.isArray(d.overlays)) setOverlays(d.overlays)
      if (d.speed) setSpeedState(d.speed)
      if (d.caption) setCaptionState((c) => ({ ...c, ...d.caption }))
      if (Number.isFinite(d.startSec)) setStartSec(d.startSec)
      if (Number.isFinite(d.endSec)) setEndSec(d.endSec)
      seededRef.current = true // a restored trim wins over the proposal seed
    } catch { /* corrupt draft — open fresh */ }
  }, [assetId])
  useEffect(() => {
    if (!assetId) return
    const doc = { grade, reframe, overlays, speed, caption, startSec, endSec }
    const t = setTimeout(() => {
      try { localStorage.setItem(`videoEdit:${assetId}`, JSON.stringify(doc)) } catch { /* quota — ignore */ }
    }, 600)
    return () => clearTimeout(t)
  }, [assetId, grade, reframe, overlays, speed, caption, startSec, endSec])

  // Seed trim + caption from the first proposed segment, once.
  const proposals = useMemo(() => (segData?.segments || []).filter((s) => s.status === 'proposed' || s.status === 'kept'), [segData])
  useEffect(() => {
    if (seededRef.current) return
    if (proposals.length) {
      const s = proposals[0]
      const st = Math.max(0, Number(s.start_sec) || 0)
      let en = Math.min(Number(s.end_sec) || st + 30, st + 60)
      if (videoDuration > 0) en = Math.min(en, videoDuration)
      setStartSec(st); setEndSec(en > st ? en : st + 1); seededRef.current = true
    } else if (videoDuration > 0 && !seededRef.current) {
      setEndSec(Math.min(videoDuration, 60)); seededRef.current = true
    }
  }, [proposals, videoDuration])

  // When videoDuration first becomes known (loadedmetadata fires after proposals load
  // from cache), clamp endSec to the real video length regardless of seededRef state.
  useEffect(() => {
    if (videoDuration > 0) setEndSec((e) => Math.min(e, videoDuration))
  }, [videoDuration])

  // brand accent for captions/callouts
  useEffect(() => {
    const a = asset?.workspace?.brand_style?.accent_color || asset?.brand_style?.accent_color
    if (a && /^#[0-9a-fA-F]{6}$/.test(a)) setCaptionState((c) => ({ ...c, accent: a }))
  }, [asset])

  const words = useMemo(() => sliceWords(asset?.transcript_words, startSec, durationSec), [asset, startSec, durationSec])
  const derivedLines = useMemo(() => groupLines(words), [words])
  // Editable caption lines — seeded from the derived transcript lines; re-seeds on
  // load or when the trim window changes. Editing a line re-splits its words across
  // the line's time so karaoke still animates, and the bake receives these EXACT
  // words (captionWords override → preview==publish for edited captions).
  const [captionLines, setCaptionLines] = useState([])
  // Re-seed only when the trim window or line count actually changes — NOT on a
  // bare asset-object refetch (which would wipe the user's caption edits).
  const seedSigRef = useRef('')
  useEffect(() => {
    const sig = `${startSec}|${durationSec}|${derivedLines.length}`
    if (sig === seedSigRef.current) return
    seedSigRef.current = sig
    setCaptionLines(derivedLines)
  }, [derivedLines, startSec, durationSec])
  const editLine = useCallback((i, text) => {
    setCaptionLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l
      const parts = text.trim().split(/\s+/).filter(Boolean)
      const span = Math.max(0.01, l.end - l.start)
      const w = parts.map((word, k) => ({
        word,
        start: +(l.start + span * k / parts.length).toFixed(2),
        end: +(l.start + span * (k + 1) / parts.length).toFixed(2),
      }))
      return { ...l, text, words: w }
    }))
  }, [])
  const lines = captionLines

  // playback: keep <video> within the trim window
  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return
    if (playing) v.pause()
    else { if (v.currentTime < startSec || v.currentTime >= endSec) v.currentTime = startSec; v.playbackRate = speed; v.play() }
  }, [playing, startSec, endSec, speed])
  useEffect(() => { const v = videoRef.current; if (v) v.playbackRate = speed }, [speed])
  const seekClip = useCallback((clipT) => { const v = videoRef.current; if (!v) return; v.currentTime = startSec + clamp(clipT, 0, durationSec) }, [startSec, durationSec])

  const selectKey = useCallback((k) => {
    if (typeof k === 'string' && k.startsWith('overlay:')) setSel({ type: 'overlay', id: k.split(':')[1] })
    else setSel(k)
  }, [])
  const curOverlay = typeof sel === 'object' ? overlays.find((o) => o.id === sel.id) : null

  // overlay actions
  const addOverlay = useCallback(() => {
    const id = `o${Date.now()}`
    setOverlays((prev) => [...prev, { id, role: 'callout', text: 'New text', x: 0.5, y: 0.5, size: 1, in: clamp(playClipT, 0, durationSec - 1), out: clamp(playClipT + 3, 1, durationSec), color: '#ffffff' }])
    setSel({ type: 'overlay', id })
  }, [playClipT, durationSec])
  const setOverlay = useCallback((k, v) => setOverlays((prev) => prev.map((o) => (typeof sel === 'object' && o.id === sel.id ? { ...o, [k]: v } : o))), [sel])
  const setOverlayTime = useCallback((k, v) => setOverlays((prev) => prev.map((o) => (typeof sel === 'object' && o.id === sel.id ? { ...o, [k]: clamp(Number(v) || 0, 0, durationSec) } : o))), [sel, durationSec])
  const delOverlay = useCallback(() => { setOverlays((prev) => prev.filter((o) => !(typeof sel === 'object' && o.id === sel.id))); setSel('clip') }, [sel])
  const dragOverlay = useCallback((e, id) => {
    e.preventDefault(); e.stopPropagation()
    const frame = e.currentTarget.parentElement
    const move = (ev) => {
      const r = frame.getBoundingClientRect()
      const x = clamp((ev.clientX - r.left) / r.width, 0.06, 0.94); const y = clamp((ev.clientY - r.top) / r.height, 0.05, 0.95)
      setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, x, y } : o)))
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }, [])

  const handleTimeUpdate = useCallback((t) => {
    setCurrentTime(t)
    const v = videoRef.current
    if (v && t >= endSec) { v.pause(); v.currentTime = startSec }
  }, [endSec, startSec])

  const setGradeKey = useCallback((k, v) => setGrade((g) => ({ ...g, [k]: v })), [])
  const applyVibe = useCallback((p) => setGrade({ ...NEUTRAL_GRADE, ...p }), [])
  const resetGrade = useCallback(() => setGrade({ ...NEUTRAL_GRADE }), [])
  const setReframeKey = useCallback((k, v) => setReframe((r) => ({ ...r, [k]: v })), [])
  const setCaption = useCallback((k, v) => setCaptionState((c) => ({ ...c, [k]: v })), [])
  const setSpeed = useCallback((s) => setSpeedState(s), [])
  const trimToLine = useCallback((l) => {
    const ns = startSec + l.start
    const ne = Math.min(startSec + l.end, startSec + 60)
    setStartSec(ns); setEndSec(ne > ns ? ne : ns + 1)
    seededRef.current = true; toast('Trimmed to that line')
  }, [startSec])

  // Outputs — render ONCE with the full editor doc, then route to the chosen
  // destination (post / b-roll / ad sizes), or render the whole untouched source.
  const [outputsOpen, setOutputsOpen] = useState(false)
  const [adExportOpen, setAdExportOpen] = useState(false)
  const captionSummary = () => lines.map((l) => l.text).join(' ').slice(0, 500)
  const renderBody = () => ({
    assetId, channels: [DEFAULT_CHANNEL], startSec, durationSec, subtitles: caption.preset !== 'off',
    overlayPosition: caption.position, overlaySize: caption.size, captionAccent: caption.accent,
    grade, reframe, speed,
    // EXACT (possibly edited) caption words so the bake matches the preview.
    captionWords: lines.flatMap((l) => l.words),
    overlays: overlays.map((o) => ({ role: o.role, text: o.text, x: o.x, y: o.y, size: o.size, color: o.color, in: o.in, out: o.out })),
  })
  async function doRenderClip() {
    const result = await apiFetch('/api/editorial/render-clip', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(renderBody()),
    })
    const render = result?.renders?.[0]
    if (!render?.blobUrl) throw new Error('Render returned no output.')
    return render
  }

  const asPostMutation = useAppMutation({
    mutationFn: async () => {
      const render = await doRenderClip()
      return apiFetch('/api/editorial/clip-to-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, renderedBlobUrl: render.blobUrl, captionText: captionSummary(), platform: 'instagram' }),
      })
    },
    onSuccess: (data) => {
      const id = data?.contentItemId
      if (id) { toast('Reel rendered — opening in Publish.'); navigate(`/publish/${id}`) } else toast.error('Created but no ID returned.')
    },
  })
  const brollMutation = useAppMutation({
    mutationFn: async () => {
      const render = await doRenderClip()
      return apiFetch('/api/editorial/clip-to-broll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, renderedBlobUrl: render.blobUrl, width: render.width, height: render.height, sizeBytes: render.sizeBytes, captionText: captionSummary() }),
      })
    },
    onSuccess: () => { toast('Saved to Library — appears in Suggested media shortly.'); navigate('/slate') },
  })
  const wholeMutation = useAppMutation({
    mutationFn: () => renderWholeVideo(assetId),
    onSuccess: () => { toast('Rendering the full-length video — track it on Slate.'); navigate('/slate') },
  })
  const busy = asPostMutation.isPending || brollMutation.isPending || wholeMutation.isPending

  const ctx = {
    videoRef, asset, sel, selectKey, railMode, setRailMode, grade, setGradeKey, applyVibe, resetGrade,
    reframe, setReframe: setReframeKey, speed, setSpeed, caption, setCaption, overlays, addOverlay, setOverlay,
    setOverlayTime, delOverlay, curOverlay, dragOverlay, lines, words, editLine, playClipT, playing, togglePlay, seekClip,
    startSec, endSec, durationSec, videoDuration, setStartSec, setEndSec, safeZones, setSafeZones, trimToLine,
    setVideoDuration, setPlaying, handleTimeUpdate,
  }

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  if (error || !asset) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm font-medium text-destructive">Could not load this clip</p>
        <Button size="sm" variant="outline" onClick={() => navigate('/slate')}>Back to Slate</Button>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header className="flex items-center gap-3 border-b bg-card px-4" style={{ height: 52, borderColor: 'hsl(var(--border))' }}>
        <button onClick={() => navigate(`/slate/clip/${assetId}`)} style={{ color: 'hsl(var(--muted-foreground))' }} title="Back"><ArrowLeft className="h-4 w-4" /></button>
        <span className="text-sm font-semibold">{asset.display_title || asset.filename || 'Reel'}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-semibold" style={{ background: 'hsl(var(--info)/.12)', color: 'hsl(var(--info))' }}><Film className="h-3.5 w-3.5" />Instagram Reel · {fmt(durationSec)} · 9:16</span>
        <span className="rounded-md px-2 py-0.5 text-3xs font-semibold" style={{ background: 'hsl(var(--action)/.15)', color: 'hsl(38 60% 30%)' }}>Beta editor</span>
        <div className="ml-auto flex items-center gap-2">
          {/* Transport — always-visible play/pause + clip time. */}
          <div className="flex items-center gap-2 rounded-lg border px-2 py-1 text-2xs" style={{ borderColor: 'hsl(var(--border))' }}>
            <button onClick={togglePlay} className="rounded p-0.5 hover:opacity-70" style={{ color: 'hsl(var(--primary))' }} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <span className="font-mono tabular-nums" style={{ color: 'hsl(var(--muted-foreground))' }}>{fmt(playClipT)} / {fmt(durationSec)}</span>
          </div>
          <div className="relative flex items-center">
            <Button size="sm" disabled={busy} onClick={() => asPostMutation.mutate()} className="rounded-r-none" style={{ background: 'hsl(var(--action))', color: '#3a2a00' }}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="mr-1 h-3.5 w-3.5" />}Save &amp; publish
            </Button>
            <button onClick={() => setOutputsOpen((v) => !v)} disabled={busy} className="flex h-8 items-center rounded-r-md border-l px-1.5 disabled:opacity-50" style={{ background: 'hsl(var(--action))', color: '#3a2a00', borderColor: 'rgba(0,0,0,.18)' }} title="More outputs" aria-label="More outputs">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {outputsOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setOutputsOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-lg border bg-card shadow-lg" style={{ borderColor: 'hsl(var(--border))' }}>
                  {[
                    { icon: FolderOpen, label: 'Save as b-roll', sub: 'Reusable clip in Library', on: () => brollMutation.mutate() },
                    { icon: Megaphone, label: 'Export for ads', sub: 'Download ad sizes', on: () => setAdExportOpen(true) },
                    { icon: Film, label: 'Render whole video', sub: 'Full source, no edits', on: () => wholeMutation.mutate() },
                  ].map((o) => (
                    <button key={o.label} disabled={busy} onClick={() => { setOutputsOpen(false); o.on() }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted disabled:opacity-50">
                      <o.icon className="h-4 w-4 shrink-0" style={{ color: 'hsl(var(--muted-foreground))' }} />
                      <span className="min-w-0"><span className="block text-xs font-medium">{o.label}</span><span className="block text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{o.sub}</span></span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <LeftRail ctx={ctx} />
        <Canvas ctx={ctx} />
        <Inspector ctx={ctx} />
      </div>
      <Timeline ctx={ctx} />
      {adExportOpen && (
        <AdVideoExportModal
          clip={{ assetId, startSec, durationSec, captionText: captionSummary(), overlayPosition: caption.position, overlaySize: caption.size, title: asset?.display_title || asset?.filename }}
          onClose={() => setAdExportOpen(false)}
        />
      )}
    </div>
  )
}
