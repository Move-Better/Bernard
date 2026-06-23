import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Play, Pause, Film, Sparkles, Captions, Type,
  Plus, Trash2, CalendarClock, Loader2, AlertCircle, Move,
  FolderOpen, Megaphone, ChevronDown, Scissors,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppMutation } from '@/lib/useAppMutation'
import { apiFetch } from '@/lib/api'
import { getMediaAsset, updateMediaAsset } from '@/lib/mediaLib'
import { getSegments, renderWholeVideo, findClips, updateSegment } from '@/lib/clipsLib'
import { updateBrandStyle } from '@/lib/brandKitLib'
import AdVideoExportModal from '@/components/AdVideoExportModal'
import { GRADE_SLIDERS, GRADE_VIBES, NEUTRAL_GRADE, gradeToCanvasFilter } from '@/lib/gradeParams'
import { toast } from '@/lib/toast'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

// ── helpers ──────────────────────────────────────────────────────────────────
// Output format → render channel (the renderer's VIDEO_CHANNEL_SPECS already
// defines each aspect) + the canvas aspect-ratio. One clip, any shape.
const FORMATS = {
  reel:     { channel: 'instagram_reel', css: '9 / 16', label: 'Reel', dim: '9:16' },
  square:   { channel: 'linkedin_video', css: '1 / 1',  label: 'Square', dim: '1:1' },
  portrait: { channel: 'facebook_video', css: '4 / 5',  label: 'Portrait', dim: '4:5' },
}
const FORMAT_KEYS = ['reel', 'square', 'portrait']
const fmt = (s) => {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60); const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const OVERLAY_ROLES = [['title', 'Title'], ['lower_third', 'Caption bar'], ['callout', 'Callout']]
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

// ── CANVAS ───────────────────────────────────────────────────────────────────
function Canvas({ ctx }) {
  const { videoRef, asset, grade, reframe, kenBurns, caption, overlays, lines, playClipT, playing, togglePlay, sel, selectKey, safeZones, setSafeZones, startSec, durationSec, dragOverlay, editLine, editingCap, setEditingCap } = ctx
  const activeIdx = lines.findIndex((l) => playClipT >= l.start && playClipT < l.end)
  const activeLine = activeIdx >= 0 ? lines[activeIdx] : null
  const clipSelRing = sel === 'clip' || sel === 'grade'
  const z = (Number(reframe.zoom) || 100) / 100
  // Ken Burns takes over the transform when active (matches the bake's precedence
  // over static reframe), animated by playback progress. Best-effort visual match
  // to the server zoompan; the baked MP4 is the source of truth.
  const kbMotion = kenBurns?.motion || 'none'
  let kbTransform = null
  if (kbMotion !== 'none') {
    const p = durationSec > 0 ? clamp(playClipT / durationSec, 0, 1) : 0
    const f = (Number(kenBurns?.intensity) || 50) / 100
    if (kbMotion === 'push_in' || kbMotion === 'pull_out') {
      const zMax = 1.05 + 0.15 * f
      const zz = kbMotion === 'push_in' ? 1 + (zMax - 1) * p : zMax - (zMax - 1) * p
      kbTransform = `scale(${zz.toFixed(4)})`
    } else {
      const zPan = 1.08 + 0.12 * f
      const A = (zPan - 1) * 50 // % element travel each side of centre
      // pan_right reveals the right side → image slides left: from +A to −A.
      const from = kbMotion === 'pan_right' ? A : -A
      const tx = (from * (1 - 2 * p)).toFixed(2)
      kbTransform = `scale(${zPan.toFixed(4)}) translateX(${tx}%)`
    }
  }
  return (
    <section className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-muted p-4">
      <div className="absolute right-4 top-3 z-10 flex items-center gap-2 rounded-md bg-card/80 px-2 py-1 text-3xs text-muted-foreground backdrop-blur">
        <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={safeZones} onChange={(e) => setSafeZones(e.target.checked)} /> safe zones</label>
      </div>
      <div className="relative h-full max-h-full" style={{ aspectRatio: ctx.formatCss }}>
        <div
          className={`group relative h-full w-full cursor-pointer overflow-hidden rounded-2xl bg-black ${clipSelRing ? 'ring-2 ring-offset-2' : ''}`}
          style={clipSelRing ? { boxShadow: '0 0 0 2px hsl(var(--primary))' } : undefined}
          onClick={togglePlay}
        >
          {asset?.blob_url ? (
            <video
              ref={videoRef} src={asset.blob_url} poster={asset.thumbnail_url || undefined} preload="metadata" playsInline
              className="absolute inset-0 h-full w-full object-cover"
              style={{ filter: gradeToCanvasFilter(grade), transform: kbTransform || `scale(${z})`, transformOrigin: kbTransform ? 'center' : `${reframe.x}% ${reframe.y}%` }}
              onLoadedMetadata={(e) => ctx.setVideoDuration(e.target.duration)}
              onPlay={() => ctx.setPlaying(true)}
              onPause={() => ctx.setPlaying(false)}
              onTimeUpdate={(e) => ctx.handleTimeUpdate(e.target.currentTime)}
            />
          ) : <div className="flex h-full items-center justify-center text-sm text-white/60">No video</div>}

          {/* caption — karaoke; click to edit the active line inline (pauses playback) */}
          {activeLine && caption.preset !== 'off' && (
            <div
              onClick={(e) => { e.stopPropagation(); videoRef.current?.pause(); selectKey('caption'); setEditingCap(true) }}
              className="pointer-events-auto absolute left-1/2 -translate-x-1/2 cursor-text text-center font-extrabold leading-tight"
              style={{
                maxWidth: '86%',
                top: caption.position === 'top' ? '11%' : caption.position === 'center' ? '46%' : 'auto',
                bottom: caption.position === 'bottom' ? '15%' : 'auto',
                fontSize: `clamp(14px, ${caption.size === 'large' ? 4.6 : caption.size === 'small' ? 3.0 : 3.8}vh, 40px)`,
                color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,.6)',
                outline: sel === 'caption' ? '1.5px dashed #fff' : 'none', outlineOffset: '4px',
              }}
            >
              {editingCap && sel === 'caption' && activeIdx >= 0 ? (
                <input
                  autoFocus
                  defaultValue={activeLine.words.map((w) => w.word).join(' ')}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => editLine(activeIdx, e.target.value)}
                  onBlur={() => setEditingCap(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setEditingCap(false) } }}
                  className="w-full bg-transparent text-center outline-none"
                  style={{ color: '#fff', font: 'inherit', textShadow: 'inherit' }}
                  aria-label="Edit caption line"
                />
              ) : (
                activeLine.words.map((w, i) => {
                  const spoken = playClipT >= w.start
                  return <span key={i} style={{ color: spoken ? caption.accent : '#fff' }}>{w.word}{' '}</span>
                })
              )}
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
            // Mirror the bake's alpha fade (OVL_FADE=0.25s in/out) so preview≈publish.
            // Selected overlays stay fully opaque so dragging near an edge isn't fighting a fade.
            const fd = Math.min(0.25, Math.max(0.01, o.out - o.in) / 3)
            let op = 1
            if (playClipT < o.in + fd) op = (playClipT - o.in) / fd
            else if (playClipT > o.out - fd) op = (o.out - playClipT) / fd
            op = isSel ? 1 : Math.max(0, Math.min(1, op))
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
                  outline: isSel ? '1.5px solid hsl(var(--primary))' : 'none', outlineOffset: 3, opacity: op, ...box,
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
          <span className="absolute left-3 top-3 rounded bg-black/30 px-1.5 py-0.5 text-3xs text-white/70">{ctx.formatDim} · {fmt(ctx.durationSec)}{startSec > 0 ? ` · from ${fmt(startSec)}` : ''}</span>
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
function ClipInspector({ ctx }) {
  const { startSec, endSec, durationSec, reframe, setReframe, kenBurns, setKenBurns, speed, setSpeed, selectKey, caption, formatDim } = ctx
  const kbMotion = kenBurns?.motion || 'none'
  return (
    <InspectorShell icon={Film} title="Clip & reframe" right={formatDim}>
      <div className="mb-3 flex items-center gap-2 text-2xs">
        <span className="flex-1 rounded-md border px-2 py-1.5 text-center font-mono" style={{ borderColor: 'hsl(var(--border))' }}>{fmt(startSec)}</span>
        <span style={{ color: 'hsl(var(--muted-foreground))' }}>→</span>
        <span className="flex-1 rounded-md border px-2 py-1.5 text-center font-mono" style={{ borderColor: 'hsl(var(--border))' }}>{fmt(endSec)}</span>
        <span className="text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>({fmt(durationSec)})</span>
      </div>
      <p className="mb-3 rounded-md px-2 py-1 text-3xs" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>Trim with the <b>Clip bar</b> on the right timeline.</p>
      <p className="mb-1.5 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Reframe · position in {formatDim}</p>
      {[['zoom', 'Zoom', 100, 220], ['x', 'Horizontal', 0, 100], ['y', 'Vertical', 0, 100]].map(([k, lbl, lo, hi]) => (
        <div key={k} className="mb-2">
          <div className="mb-1 flex justify-between text-2xs" style={{ color: 'hsl(var(--muted-foreground))' }}><span>{lbl}</span><span>{reframe[k]}{k === 'zoom' ? '%' : ''}</span></div>
          <input type="range" min={lo} max={hi} value={reframe[k]} onChange={(e) => setReframe(k, +e.target.value)} className="w-full" />
        </div>
      ))}
      <p className="mb-1.5 mt-3 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Motion</p>
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        {[['none', 'None'], ['push_in', 'Push in'], ['pull_out', 'Pull out'], ['pan_left', 'Pan ←'], ['pan_right', 'Pan →']].map(([m, l]) => (
          <button key={m} onClick={() => setKenBurns('motion', m)} className="rounded-md border py-1.5 text-3xs" style={segBtn(kbMotion === m)}>{l}</button>
        ))}
      </div>
      {kbMotion !== 'none' && (
        <div className="mb-1">
          <div className="mb-1 flex justify-between text-2xs" style={{ color: 'hsl(var(--muted-foreground))' }}><span>Intensity</span><span>{kenBurns.intensity}</span></div>
          <input type="range" min={0} max={100} value={kenBurns.intensity} onChange={(e) => setKenBurns('intensity', +e.target.value)} className="w-full" />
        </div>
      )}
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
  const { grade, setGradeKey, applyVibe, resetGrade, brandGrade, saveBrandGrade, savingBrand } = ctx
  return (
    <InspectorShell icon={Sparkles} title="AI Colorist — Frame grade" right="whole clip">
      <p className="mb-1.5 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Vibe presets</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          onClick={() => brandGrade && applyVibe(brandGrade)}
          disabled={!brandGrade}
          title={brandGrade ? 'Your saved brand look' : 'Dial in a grade, then “Save as Brand look” below'}
          className="rounded-full border px-2.5 py-1 text-2xs font-medium disabled:opacity-50"
          style={{ borderColor: 'hsl(var(--action))', color: 'hsl(var(--action))', background: 'hsl(var(--action)/0.08)' }}
        >★ Brand</button>
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
      <button onClick={saveBrandGrade} disabled={savingBrand} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border py-2 text-2xs disabled:opacity-60" style={{ borderColor: 'hsl(var(--action))', background: 'hsl(var(--action)/0.06)', color: 'hsl(var(--action))' }}>
        {savingBrand ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span>★</span>}Save as Brand look
      </button>
      <button onClick={resetGrade} className="mt-1 w-full rounded-md py-1.5 text-2xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Reset adjustments</button>
    </InspectorShell>
  )
}

function CaptionInspector({ ctx }) {
  const { caption, setCaption, lines, genCaptions, genCaptionsPending } = ctx
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
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Captions</p>
      <div className="mb-3 flex gap-1.5">
        {['karaoke', 'off'].map((p) => <button key={p} onClick={() => setCaption('preset', p)} className="flex-1 rounded-md border py-1.5 text-3xs" style={segBtn(caption.preset === p)}>{p === 'karaoke' ? 'On' : 'Off'}</button>)}
      </div>
      {caption.preset !== 'off' && (
        <div className="mb-3">
          <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Animation</p>
          <div className="flex gap-1.5">
            {[['none', 'None'], ['pop', 'Pop'], ['fade', 'Fade']].map(([v, l]) => <button key={v} onClick={() => setCaption('anim', v)} className="flex-1 rounded-md border py-1.5 text-3xs" style={segBtn((caption.anim || 'none') === v)}>{l}</button>)}
          </div>
          <p className="mt-1 text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Entrance effect — shown in the exported video.</p>
        </div>
      )}
      {seg('Position', ['top', 'center', 'bottom'], 'position')}
      {seg('Size', ['small', 'medium', 'large'], 'size')}
      {lines.length === 0 ? (
        <button onClick={genCaptions} disabled={genCaptionsPending} className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border py-2 text-2xs disabled:opacity-60" style={{ borderColor: 'hsl(var(--action))', background: 'hsl(var(--action)/0.06)', color: 'hsl(var(--action))' }}>
          {genCaptionsPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Transcribing…</> : <><Sparkles className="h-3.5 w-3.5" />Generate captions</>}
        </button>
      ) : (
        <p className="mt-1 rounded-md px-2 py-1.5 text-3xs" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>Tap the caption on the video to fix a word.</p>
      )}
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

// Moments — the AI proposals picker (replaces SlateClipEditor's review lane).
function MomentsInspector({ ctx }) {
  const { proposals, selectedSegmentId, applySegment, discardSegment, findMoments, findingMoments, segDetecting } = ctx
  const loading = findingMoments || segDetecting
  return (
    <InspectorShell icon={Scissors} title="Moments" right={proposals.length ? `${proposals.length}` : ''}>
      {loading ? (
        <div className="flex items-center gap-2 text-2xs" style={{ color: 'hsl(var(--muted-foreground))' }}><Loader2 className="h-3.5 w-3.5 animate-spin" />Finding moments…</div>
      ) : proposals.length === 0 ? (
        <>
          <p className="mb-2 text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>No AI moments yet — find the standalone clips in this source.</p>
          <button onClick={findMoments} className="flex w-full items-center justify-center gap-1.5 rounded-md border py-2 text-2xs" style={{ borderColor: 'hsl(var(--primary))', color: 'hsl(var(--primary))' }}><Scissors className="h-3.5 w-3.5" />Find clips</button>
        </>
      ) : (
        <>
          {proposals.map((s) => {
            const on = s.id === selectedSegmentId
            const dur = Math.max(0, (Number(s.end_sec) || 0) - (Number(s.start_sec) || 0))
            return (
              <div key={s.id} className="mb-1.5 rounded-md border p-2" style={{ borderColor: on ? 'hsl(var(--primary))' : 'hsl(var(--border))', background: on ? 'hsl(var(--primary)/0.06)' : undefined }}>
                <button onClick={() => applySegment(s)} className="block w-full text-left">
                  <span className="block text-2xs font-medium" style={{ color: on ? 'hsl(var(--primary))' : 'hsl(var(--foreground))' }}>{s.hook || 'Moment'}</span>
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

// ── RAIL + VERTICAL TIMELINE (v3) ────────────────────────────────────────────
// Thin icon rail (v3) — picks the inspector tool. "Text" selects the latest
// overlay (or adds one). Replaces the old Layers/Transcript rail.
function IconRail({ ctx }) {
  const { sel, selectKey, overlays, addOverlay } = ctx
  const selKey = typeof sel === 'object' ? 'overlay' : sel
  const tools = [['moments', Scissors, 'Clips'], ['clip', Film, 'Clip'], ['grade', Sparkles, 'Grade'], ['caption', Captions, 'Caps'], ['text', Type, 'Text']]
  const pick = (k) => {
    if (k === 'text') { if (overlays.length) selectKey(`overlay:${overlays[overlays.length - 1].id}`); else addOverlay() }
    else selectKey(k)
  }
  return (
    <aside className="flex w-[58px] shrink-0 flex-col border-r bg-card py-1" style={{ borderColor: 'hsl(var(--border))' }}>
      {tools.map(([k, Icon, label]) => {
        const on = selKey === k || (k === 'text' && selKey === 'overlay')
        return (
          <button key={k} onClick={() => pick(k)} className="flex w-full flex-col items-center gap-1 py-2.5" style={{ borderLeft: `2px solid ${on ? 'hsl(var(--primary))' : 'transparent'}`, background: on ? 'hsl(var(--primary)/0.07)' : undefined }}>
            <Icon className="h-4 w-4" style={{ color: on ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }} />
            <span className="text-3xs" style={{ color: on ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}>{label}</span>
          </button>
        )
      })}
    </aside>
  )
}

// Right vertical timeline (v3) — source-relative (0..videoDuration). The Clip
// column shows the trim window [startSec,endSec] with top/bottom drag handles;
// the Text column shows overlay bars (clip-relative in/out, drawn at startSec+in)
// that drag freely (anchored to the grab point) and resize via their ends.
function VerticalTimeline({ ctx }) {
  const { startSec, endSec, durationSec, videoDuration, setStartSec, setEndSec, overlays, selectKey, sel, setOverlayWindow, playClipT, addOverlay } = ctx
  const span = videoDuration > 0 ? videoDuration : Math.max(endSec, 1)
  const clipColRef = useRef(null)
  const ovColRef = useRef(null)
  const f = (s) => clamp(s / span, 0, 1) * 100
  const trim = (which) => (e) => {
    e.preventDefault(); e.stopPropagation()
    const move = (ev) => {
      const r = clipColRef.current?.getBoundingClientRect(); if (!r || span <= 0) return
      const s = clamp((ev.clientY - r.top) / r.height, 0, 1) * span
      if (which === 'in') setStartSec(clamp(s, 0, endSec - 1)); else setEndSec(clamp(s, startSec + 1, span))
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  const ovDown = (o, edge) => (e) => {
    e.preventDefault(); e.stopPropagation(); selectKey(`overlay:${o.id}`)
    const r = ovColRef.current?.getBoundingClientRect(); const startY = e.clientY; const inAt = o.in; const len = o.out - o.in
    const move = (ev) => {
      if (!r || span <= 0) return
      if (edge === 'move') {
        const d = (ev.clientY - startY) / r.height * span
        const ni = clamp(inAt + d, 0, Math.max(0, durationSec - len))
        setOverlayWindow(o.id, ni, ni + len)
      } else {
        const clipSec = clamp((ev.clientY - r.top) / r.height * span - startSec, 0, durationSec)
        if (edge === 't') setOverlayWindow(o.id, Math.min(clipSec, o.out - 0.5), o.out)
        else setOverlayWindow(o.id, o.in, Math.max(clipSec, o.in + 0.5))
      }
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  return (
    <aside className="flex w-[120px] shrink-0 flex-col border-l bg-card" style={{ borderColor: 'hsl(var(--border))' }}>
      <div className="flex items-center justify-between px-2.5 pt-2 text-3xs font-semibold uppercase" style={{ color: 'hsl(var(--muted-foreground))' }}>
        <span>Clip</span><button onClick={addOverlay} className="flex items-center gap-0.5" style={{ color: 'hsl(var(--primary))' }}><Plus className="h-3 w-3" />Text</button>
      </div>
      <div className="relative flex flex-1 gap-2 p-2.5">
        <div ref={clipColRef} className="relative flex-1 rounded-md" style={{ background: 'hsl(220 14% 93%)' }}>
          <div onClick={() => selectKey('clip')} className="absolute inset-x-0 cursor-pointer rounded-md" style={{ top: `${f(startSec)}%`, height: `${Math.max(0, f(endSec) - f(startSec))}%`, background: 'linear-gradient(180deg,hsl(var(--primary)/.85),hsl(var(--primary)/.6))', boxShadow: sel === 'clip' ? '0 0 0 2px hsl(var(--primary))' : undefined }} />
          <div onMouseDown={trim('in')} className="absolute inset-x-0 z-10 cursor-ns-resize rounded-sm" style={{ top: `calc(${f(startSec)}% - 5px)`, height: 11, background: 'hsl(var(--primary))' }} title="Start" />
          <div onMouseDown={trim('out')} className="absolute inset-x-0 z-10 cursor-ns-resize rounded-sm" style={{ top: `calc(${f(endSec)}% - 6px)`, height: 11, background: 'hsl(var(--primary))' }} title="End" />
        </div>
        <div ref={ovColRef} className="relative flex-1 rounded-md" style={{ background: 'hsl(220 14% 93%)' }}>
          {overlays.length ? overlays.map((o) => {
            const isSel = typeof sel === 'object' && sel.id === o.id
            return (
              <div key={o.id} onMouseDown={ovDown(o, 'move')} className="absolute inset-x-0 cursor-grab overflow-hidden rounded-md" style={{ top: `${f(startSec + o.in)}%`, height: `${Math.max(3, f(startSec + o.out) - f(startSec + o.in))}%`, background: 'linear-gradient(180deg,hsl(var(--action)/.9),hsl(var(--action)/.7))', boxShadow: isSel ? '0 0 0 2px hsl(var(--action))' : undefined }}>
                <div onMouseDown={ovDown(o, 't')} className="absolute inset-x-0 top-0 z-10 cursor-ns-resize" style={{ height: 9 }} />
                <div className="flex h-full items-center justify-center"><Type className="h-3 w-3" style={{ color: '#3a2a00' }} /></div>
                <div onMouseDown={ovDown(o, 'b')} className="absolute inset-x-0 bottom-0 z-10 cursor-ns-resize" style={{ height: 9 }} />
              </div>
            )
          }) : <span className="absolute inset-x-0 top-2 text-center text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>+ Text</span>}
        </div>
        <div className="pointer-events-none absolute inset-x-2.5 z-20" style={{ top: `calc(10px + ${f(startSec + playClipT)}% * (100% - 20px) / 100)`, height: 2, background: 'hsl(0 80% 55%)' }} />
      </div>
    </aside>
  )
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
export default function VideoEditor() {
  useDocumentTitle('Reel Editor · Moment Miner')
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
  const [format, setFormat] = useState('reel')
  const [reframe, setReframe] = useState({ zoom: 100, x: 50, y: 50 })
  const [kenBurns, setKenBurnsState] = useState({ motion: 'none', intensity: 50 })
  const [speed, setSpeedState] = useState(1)
  const [caption, setCaptionState] = useState({ preset: 'karaoke', position: 'bottom', size: 'medium', accent: '#0C7580', anim: 'none' })
  const [overlays, setOverlays] = useState([])
  const [safeZones, setSafeZones] = useState(true)
  const [selectedSegmentId, setSelectedSegmentId] = useState(null)
  const seededRef = useRef(false)

  const durationSec = Math.max(1, endSec - startSec)
  const playClipT = clamp(currentTime - startSec, 0, durationSec)

  // Save & resume. On open, restore this asset's editor doc — preferring the
  // SERVER draft (media_assets.video_edit_draft, cross-device) and falling back
  // to localStorage if the asset hasn't loaded a server draft yet. Autosave
  // (debounced) writes BOTH: localStorage immediately (offline mirror) + a
  // server PATCH. Fully defensive: a missing/corrupt draft just opens fresh.
  const restoredRef = useRef(false)
  const hydratedRef = useRef(false)
  const lastSavedRef = useRef(null)
  useEffect(() => {
    if (!asset || restoredRef.current) return
    restoredRef.current = true
    try {
      const server = asset.video_edit_draft
      let local = null
      try {
        const raw = localStorage.getItem(`videoEdit:${assetId}`)
        if (raw) local = JSON.parse(raw)
      } catch { /* corrupt local — ignore */ }
      const d = (server && typeof server === 'object') ? server : local
      if (d && typeof d === 'object') {
        if (d.grade) setGrade(d.grade)
        if (FORMAT_KEYS.includes(d.format)) setFormat(d.format)
        if (d.reframe) setReframe(d.reframe)
        if (d.kenBurns) setKenBurnsState((s) => ({ ...s, ...d.kenBurns }))
        if (Array.isArray(d.overlays)) setOverlays(d.overlays)
        if (d.speed) setSpeedState(d.speed)
        if (d.caption) setCaptionState((c) => ({ ...c, ...d.caption }))
        if (Number.isFinite(d.startSec)) setStartSec(d.startSec)
        if (Number.isFinite(d.endSec)) setEndSec(d.endSec)
        seededRef.current = true // a restored trim wins over the proposal seed
      }
    } catch { /* corrupt draft — open fresh */ }
    hydratedRef.current = true
  }, [asset, assetId])
  useEffect(() => {
    if (!assetId || !hydratedRef.current) return
    const doc = { format, grade, reframe, kenBurns, overlays, speed, caption, startSec, endSec }
    const json = JSON.stringify(doc)
    try { localStorage.setItem(`videoEdit:${assetId}`, json) } catch { /* quota — ignore */ }
    if (json === lastSavedRef.current) return
    const t = setTimeout(() => {
      lastSavedRef.current = json
      // Offline / failure is non-fatal — localStorage above still holds the draft.
      updateMediaAsset(assetId, { videoEditDraft: doc }).catch(() => {})
    }, 1500)
    return () => clearTimeout(t)
  }, [assetId, format, grade, reframe, kenBurns, overlays, speed, caption, startSec, endSec])

  // Seed trim + caption from the first proposed segment, once.
  const proposals = useMemo(() => (segData?.segments || []).filter((s) => s.status === 'proposed' || s.status === 'kept'), [segData])
  useEffect(() => {
    if (seededRef.current) return
    if (proposals.length) {
      const s = proposals[0]
      const st = Math.max(0, Number(s.start_sec) || 0)
      let en = Math.min(Number(s.end_sec) || st + 30, st + 60)
      if (videoDuration > 0) en = Math.min(en, videoDuration)
      setStartSec(st); setEndSec(en > st ? en : st + 1); setSelectedSegmentId(s.id); seededRef.current = true
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
  // Set a specific overlay's in/out by id (used by the vertical timeline bar drag/resize).
  const setOverlayWindow = useCallback((id, inT, outT) => setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, in: clamp(inT, 0, durationSec), out: clamp(outT, 0, durationSec) } : o))), [durationSec])
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
  const setKenBurns = useCallback((k, v) => setKenBurnsState((s) => ({ ...s, [k]: v })), [])
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
  const [exportOpen, setExportOpen] = useState(false)
  const [adExportOpen, setAdExportOpen] = useState(false)
  const [dest, setDest] = useState({ post: true, broll: false, ad: false })
  const toggleDest = (k) => setDest((d) => ({ ...d, [k]: !d[k] }))
  const captionSummary = () => lines.map((l) => l.text).join(' ').slice(0, 500)
  const renderBody = () => ({
    assetId, channels: [(FORMATS[format] || FORMATS.reel).channel], startSec, durationSec, subtitles: caption.preset !== 'off',
    overlayPosition: caption.position, overlaySize: caption.size, captionAccent: caption.accent,
    captionAnim: caption.anim,
    grade, reframe, speed,
    ...(kenBurns.motion && kenBurns.motion !== 'none' ? { kenBurns } : {}),
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

  // ONE render → every selected destination. Post + b-roll share the single reel
  // render; ad export is its own (interactive) modal flow opened afterward.
  const exportMutation = useAppMutation({
    mutationFn: async () => {
      let contentItemId = null
      if (dest.post || dest.broll) {
        const render = await doRenderClip()
        if (dest.broll) {
          await apiFetch('/api/editorial/clip-to-broll', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId, renderedBlobUrl: render.blobUrl, width: render.width, height: render.height, sizeBytes: render.sizeBytes, captionText: captionSummary() }),
          })
        }
        if (dest.post) {
          const d = await apiFetch('/api/editorial/clip-to-post', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId, renderedBlobUrl: render.blobUrl, captionText: captionSummary(), platform: 'instagram' }),
          })
          contentItemId = d?.contentItemId || null
        }
      }
      return { contentItemId }
    },
    onSuccess: ({ contentItemId }) => {
      const done = []
      if (dest.broll) done.push('saved to Library')
      if (dest.post) done.push('post draft created')
      if (done.length) toast(done.join(' · '))
      setExportOpen(false)
      // Ad export is an interactive download modal — open it and STAY here.
      if (dest.ad) { setAdExportOpen(true); return }
      // Otherwise, if a post was created, go schedule it.
      if (dest.post && contentItemId) navigate(`/publish/${contentItemId}`)
    },
  })
  const wholeMutation = useAppMutation({
    mutationFn: () => renderWholeVideo(assetId),
    onSuccess: () => { toast('Rendering the full-length video — track it on Moment Miner.'); navigate('/moments') },
  })
  // Karaoke fix for LEGACY clips (detected before words were persisted): re-run
  // detection (which now persists transcript_words), poll the asset until the
  // words land, then update the query cache so the preview + Words populate.
  const queryClient = useQueryClient()
  const genCaptionsMutation = useAppMutation({
    mutationFn: async () => {
      await findClips(assetId)
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const a = await getMediaAsset(assetId)
        if (Array.isArray(a?.transcript_words) && a.transcript_words.length) {
          queryClient.setQueryData(['media-asset', assetId], a)
          return
        }
      }
      throw new Error('Transcription timed out — try again.')
    },
    onSuccess: () => toast('Captions generated.'),
  })

  // Proposals (AI moments) — pick which moment to edit, discard, or find more.
  const applySegment = useCallback((seg) => {
    if (!seg) return
    const st = Math.max(0, Number(seg.start_sec) || 0)
    let en = Math.min(Number(seg.end_sec) || st + 30, st + 60)
    if (videoDuration > 0) en = Math.min(en, videoDuration)
    setStartSec(st); setEndSec(en > st ? en : st + 1); setSelectedSegmentId(seg.id)
    seededRef.current = true; toast('Switched to that moment')
  }, [videoDuration])
  const discardSegment = useCallback((id) => {
    updateSegment(id, 'discarded').then(() => queryClient.invalidateQueries({ queryKey: ['video-segments', assetId] })).catch(() => {})
    if (selectedSegmentId === id) setSelectedSegmentId(null)
  }, [assetId, selectedSegmentId, queryClient])
  const findMomentsMutation = useAppMutation({
    mutationFn: async () => {
      await findClips(assetId)
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const d = await getSegments(assetId)
        if (d?.status === 'ready') { queryClient.setQueryData(['video-segments', assetId], d); return }
        if (d?.status === 'failed') throw new Error('Find clips failed')
      }
      throw new Error('Find clips timed out')
    },
    onSuccess: () => toast('Found moments.'),
  })

  // Brand look — save the current grade as the workspace's brand vibe; the Brand
  // chip applies it. Merged into brand_style so colours/fonts are preserved.
  const brandGrade = asset?.workspace?.brand_style?.grade
  const saveBrandMutation = useAppMutation({
    mutationFn: async () => {
      await updateBrandStyle({ grade })  // merges grade into brand_style (brand kit)
      queryClient.invalidateQueries({ queryKey: ['media-asset', assetId] })
    },
    onSuccess: () => toast('Saved as your Brand look — it’s now a vibe preset.'),
  })

  const [editingCap, setEditingCap] = useState(false)
  const busy = exportMutation.isPending || wholeMutation.isPending
  const anyDest = dest.post || dest.broll || dest.ad

  const ctx = {
    videoRef, asset, sel, selectKey, railMode, setRailMode, grade, setGradeKey, applyVibe, resetGrade,
    format, setFormat, formatCss: (FORMATS[format] || FORMATS.reel).css, formatDim: (FORMATS[format] || FORMATS.reel).dim,
    reframe, setReframe: setReframeKey, kenBurns, setKenBurns, speed, setSpeed, caption, setCaption, overlays, addOverlay, setOverlay,
    setOverlayTime, setOverlayWindow, delOverlay, curOverlay, dragOverlay, lines, words, editLine, playClipT, playing, togglePlay, seekClip,
    startSec, endSec, durationSec, videoDuration, setStartSec, setEndSec, safeZones, setSafeZones, trimToLine,
    setVideoDuration, setPlaying, handleTimeUpdate,
    genCaptions: () => genCaptionsMutation.mutate(), genCaptionsPending: genCaptionsMutation.isPending,
    brandGrade, saveBrandGrade: () => saveBrandMutation.mutate(), savingBrand: saveBrandMutation.isPending,
    editingCap, setEditingCap,
    proposals, selectedSegmentId, applySegment, discardSegment,
    findMoments: () => findMomentsMutation.mutate(), findingMoments: findMomentsMutation.isPending, segDetecting: segData?.status === 'detecting',
  }

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  if (error || !asset) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm font-medium text-destructive">Could not load this clip</p>
        <Button size="sm" variant="outline" onClick={() => navigate('/moments')}>Back to Moment Miner</Button>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <IconRail ctx={ctx} />
      {/* LEFT CONTROL PANEL — title + transport + Save&publish/outputs (was the top
          bar), then the contextual inspector. Everything on the sides → max video. */}
      <aside className="flex w-[272px] shrink-0 flex-col border-r bg-card" style={{ borderColor: 'hsl(var(--border))' }}>
        <div className="border-b p-2.5" style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="mb-2 flex items-center gap-2">
            <button onClick={() => navigate('/moments')} style={{ color: 'hsl(var(--muted-foreground))' }} title="Back to Moment Miner"><ArrowLeft className="h-4 w-4" /></button>
            <span className="truncate text-xs font-semibold">{asset.display_title || asset.filename || 'Reel'}</span>
          </div>
          <div className="mb-2 flex items-center gap-2 rounded-lg border px-2 py-1 text-2xs" style={{ borderColor: 'hsl(var(--border))' }}>
            <button onClick={togglePlay} className="rounded p-0.5 hover:opacity-70" style={{ color: 'hsl(var(--primary))' }} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <span className="font-mono tabular-nums" style={{ color: 'hsl(var(--muted-foreground))' }}>{fmt(playClipT)} / {fmt(durationSec)}</span>
          </div>
          {/* Format — one clip, any shape. Drives the canvas aspect + render channel. */}
          <div className="mb-2 flex gap-1" role="group" aria-label="Output format">
            {FORMAT_KEYS.map((k) => (
              <button
                key={k} onClick={() => setFormat(k)}
                className="flex flex-1 flex-col items-center gap-0.5 rounded-md border py-1 text-3xs leading-tight"
                style={segBtn(format === k)}
                title={`${FORMATS[k].label} · ${FORMATS[k].dim}`}
              >
                <span className="font-medium">{FORMATS[k].label}</span>
                <span style={{ opacity: 0.7 }}>{FORMATS[k].dim}</span>
              </button>
            ))}
          </div>
          {/* Export — one render, multiple destinations (pick any). */}
          <div className="relative">
            <Button size="sm" disabled={busy} onClick={() => setExportOpen((v) => !v)} className="w-full justify-center" style={{ background: 'hsl(var(--action))', color: '#3a2a00' }}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Export this clip<ChevronDown className="ml-1 h-3.5 w-3.5" />
            </Button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setExportOpen(false)} />
                <div className="absolute inset-x-0 top-full z-40 mt-1 rounded-lg border bg-card p-2 shadow-lg" style={{ borderColor: 'hsl(var(--border))' }}>
                  <p className="px-1 pb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Send this clip to — pick any</p>
                  {[
                    { k: 'post', icon: CalendarClock, label: 'Schedule a post', sub: 'Pick channels & schedule on Publish' },
                    { k: 'broll', icon: FolderOpen, label: 'Save to Library', sub: 'Reusable b-roll clip' },
                    { k: 'ad', icon: Megaphone, label: 'Export for ads', sub: 'Download ad-sized versions' },
                  ].map((o) => (
                    <label key={o.k} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                      <input type="checkbox" checked={dest[o.k]} onChange={() => toggleDest(o.k)} />
                      <o.icon className="h-4 w-4 shrink-0" style={{ color: 'hsl(var(--muted-foreground))' }} />
                      <span className="min-w-0"><span className="block text-xs font-medium">{o.label}</span><span className="block text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{o.sub}</span></span>
                    </label>
                  ))}
                  <Button size="sm" disabled={busy || !anyDest} onClick={() => exportMutation.mutate()} className="mt-1.5 w-full justify-center" style={{ background: 'hsl(var(--action))', color: '#3a2a00' }}>
                    {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Render &amp; send →
                  </Button>
                  <div className="my-1.5 border-t" style={{ borderColor: 'hsl(var(--border))' }} />
                  <button disabled={busy} onClick={() => { setExportOpen(false); wholeMutation.mutate() }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-3xs hover:bg-muted disabled:opacity-50" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    <Film className="h-3.5 w-3.5 shrink-0" />Render the whole untrimmed video instead
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {sel === 'moments' && <MomentsInspector ctx={ctx} />}
          {sel === 'clip' && <ClipInspector ctx={ctx} />}
          {sel === 'grade' && <GradeInspector ctx={ctx} />}
          {sel === 'caption' && <CaptionInspector ctx={ctx} />}
          {typeof sel === 'object' && <OverlayInspector ctx={ctx} />}
        </div>
      </aside>
      <Canvas ctx={ctx} />
      <VerticalTimeline ctx={ctx} />
      {adExportOpen && (
        <AdVideoExportModal
          clip={{ assetId, startSec, durationSec, captionText: captionSummary(), overlayPosition: caption.position, overlaySize: caption.size, title: asset?.display_title || asset?.filename }}
          onClose={() => setAdExportOpen(false)}
        />
      )}
    </div>
  )
}
