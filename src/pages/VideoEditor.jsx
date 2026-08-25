import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useSmartBack } from '@/lib/useSmartBack'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Play, Pause, Film, Sparkles, Captions, Type,
  Plus, Trash2, Check, Loader2, AlertCircle, Move,
  FolderOpen, Megaphone, ChevronDown, Scissors, ChevronLeft, ChevronRight, FileText, History,
  Music, Volume2, LayoutTemplate, ThumbsDown, MessageSquareText, Repeat,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppMutation } from '@/lib/useAppMutation'
import { BERNARD_PRIMARY, BERNARD_ACTION } from '@/lib/brand'
import { workspaceCaptionAccent, WORKSPACE_DEFAULT_ACCENT } from '@/lib/brandSwatches'
import { apiFetch } from '@/lib/api'
import { buildTemplateFromEditor, suggestTemplateName } from '@/lib/videoTemplateCapture'
import { posthogCapture } from '@/lib/posthog'
import { getMediaAsset, updateMediaAsset } from '@/lib/mediaLib'
import { resolveVideoEditSource, shouldUseSourceWindow } from '@/lib/videoEditSource'
import { videoEditFingerprint, isVideoEditUnbaked, VIDEO_EDIT_HASH_KEY } from '@/lib/videoEditFingerprint'
import { applyCaptionWindow, nearestWithin } from '@/lib/captionTimeline'
import { getSegments, renderWholeVideo, findClips, updateSegment, exportClipToBroll, startClipRenderJob, getClipRenderJob } from '@/lib/clipsLib'
import { updateBrandStyle } from '@/lib/brandKitLib'
import AdVideoExportModal from '@/components/AdVideoExportModal'
import EditorChrome from '@/components/editor/EditorChrome'
import EditorWorkflowBar from '@/components/editor/EditorWorkflowBar'
import EditorIconRail from '@/components/editor/IconRail'
import PostCaptionField from '@/components/editor/PostCaptionField'
import SwapAddVideo from '@/components/editor/SwapAddVideo'
import RegenerateCaptionButton, { canRegenerateCaption } from '@/components/editor/RegenerateCaptionButton'
import { useContentItem, useUpdateContentItem, useUpdateContentItemStatus } from '@/lib/queries'
import { GRADE_SLIDERS, GRADE_VIBES, NEUTRAL_GRADE, gradeToCanvasFilter } from '@/lib/gradeParams'
import { toast } from '@/lib/toast'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import ClipDiscardReasons from '@/components/moments/ClipDiscardReasons'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import SaveStatus from '@/components/editor/SaveStatus'
import UndoRedoButtons from '@/components/editor/UndoRedoButtons'
import { useUndoHistory } from '@/lib/useUndoHistory'
import { useUndoRedoShortcut } from '@/lib/useUndoRedoShortcut'
import { useVideoShortcuts } from '@/lib/useVideoShortcuts'
import { useAutosave } from '@/lib/useAutosave'
import { detectFaceCenterX } from '@/lib/faceReframe'
import { FORMATS, FORMAT_KEYS, channelFor, defaultFormatFor, normalizeFormat } from '@/lib/videoFormats'
import { PLATFORM_META } from '@/lib/contentMeta'
import { listRevisions, saveRevision } from '@/lib/editorRevisions'

// ── helpers ──────────────────────────────────────────────────────────────────
// Output shape (Reel / Feed / Wide), the channel each bakes through, and the
// per-platform default — all in src/lib/videoFormats.js so the preview==bake
// invariant is testable without this file's module graph.
const fmt = (s) => {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60); const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
// An overlay selection is the object { type:'overlay', id }; everything else
// (inspector-key strings, or null when nothing is selected) is not. Guarding on
// `sel != null` matters because typeof null === 'object' — a bare
// `typeof sel === 'object'` would treat the deselected state as an overlay and
// crash reading sel.id.
const isOverlaySel = (s) => s != null && typeof s === 'object'
// Clip window is capped to the server's MAX_RENDER_SECONDS (brandRenderVideo.js).
// The timeline trim handles clamp to this so a clip can't silently truncate at render.
const MAX_CLIP_SECONDS = 60
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX6_RE = /^#[0-9a-fA-F]{6}$/
// hook_card and title are the two roles a TEMPLATE can express (see
// videoTemplateCapture.js); lower_third and callout are per-clip annotations.
const OVERLAY_ROLES = [['hook_card', 'Hook card'], ['title', 'Title'], ['lower_third', 'Caption bar'], ['callout', 'Callout']]
const ROLE_FS = { title: 0.044, lower_third: 0.030, callout: 0.034, hook_card: 0.040 }
// Caption preview sizing — client mirror of CAPTION_BASE_FS (0.068) and
// OVERLAY_SIZE_SCALE in api/_lib/brandRenderVideo.js, expressed in cqw (percent
// of the video frame's width) so the preview and the bake agree.
// KEEP IN SYNC — a Size control that previews one size and exports another is
// worse than no control, because it teaches the user the wrong thing.
const CAPTION_BASE_FS_PCT = 6.8
const CAPTION_SIZE_SCALE = { small: 0.75, medium: 1.0, large: 1.35 }
const CAPTION_STYLE_OPTS = [
  { id: 'bold', label: 'Bold' },
  { id: 'word_box', label: 'Word box' },
  { id: 'accent_fill', label: 'Accent fill' },
  { id: 'glow', label: 'Glow' },
  { id: 'underline', label: 'Underline' },
  { id: 'pop', label: 'Pop' },
]
// Preview styling per caption preset (approximates the ASS bake). Returns the
// spoken-word style, the upcoming-word style, and any container wrap.
function captionCss(style, accent) {
  // Fallback must equal the bake-side default accent (brandRender.js
  // DEFAULT_ACCENT) — caption.accent is seeded on hydrate, so this only
  // guards a pathological draft.
  const a = accent || WORKSPACE_DEFAULT_ACCENT
  switch (style) {
    case 'word_box':    return { active: { color: '#fff', background: 'rgba(0,0,0,.72)', padding: '0 5px', borderRadius: 4 }, base: { color: '#fff', background: 'rgba(0,0,0,.72)', padding: '0 5px', borderRadius: 4 }, wrap: {} }
    // base is DARK, not white: the spoken word is white here, so a white base
    // erases the highlight entirely. Words light up as they're said.
    case 'accent_fill': return { active: { color: '#fff' }, base: { color: '#1A1A1A' }, wrap: { background: a, padding: '3px 10px', borderRadius: 8 } }
    // The halo is dark, matching the bake. An accent halo around an accent-
    // filled spoken word is the same hue on itself — no contrast at any alpha.
    case 'glow':        return { active: { color: a, textShadow: '0 0 14px rgba(0,0,0,.8), 0 2px 6px rgba(0,0,0,.65)' }, base: { color: '#fff', textShadow: '0 0 14px rgba(0,0,0,.8), 0 2px 6px rgba(0,0,0,.65)' }, wrap: {} }
    case 'underline':   return { active: { color: '#fff', borderBottom: `3px solid ${a}` }, base: { color: '#fff' }, wrap: {} }
    case 'pop':         return { active: { color: a, display: 'inline-block', transform: 'scale(1.14)' }, base: { color: '#fff' }, wrap: {} }
    default:            return { active: { color: a }, base: { color: '#fff' }, wrap: {} } // bold
  }
}

// Slice whole-source words to a clip window, rebased to 0 (mirrors the server's
// sliceWordsToWindow — the editor preview must match the bake).
function sliceWords(words, startSec, durationSec) {
  if (!Array.isArray(words)) return []
  const s = Math.max(0, startSec || 0); const end = s + Math.max(0, durationSec || 0)
  const out = []
  for (const w of words) {
    if (!w) continue
    const ws = Number(w.start); const we = Number(w.end)
    if (!Number.isFinite(ws) || !Number.isFinite(we)) continue
    // Zero-duration words are real (Whisper's 20ms frame hop) and are a POINT,
    // not a span — kept when s <= t < end. Mirrors the server's sliceWordsToWindow.
    const isPoint = we === ws
    if (isPoint ? (ws < s || ws >= end) : (we <= s || ws >= end)) continue
    const word = String(w.word || '').trim(); if (!word) continue
    const start = Math.max(0, ws - s); const wEnd = Math.min(end - s, we - s)
    if (wEnd >= start) out.push({ word, start, end: wEnd })
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

// Trim, lowercase, collapse whitespace — mirror of normCaptionText in
// api/_lib/captionOverlayDedup.js (the src/ ↔ api/ boundary forbids sharing it,
// so keep the two identical). Used to skip a manual overlay that merely
// duplicates a spoken caption line, so the preview matches the deduped bake.
function normCaptionText(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// ── CANVAS ───────────────────────────────────────────────────────────────────
function Canvas({ ctx }) {
  const { videoRef, editVideoUrl, editPoster, captionsBaked, captionSizeFactor, grade, reframe, kenBurns, caption, overlays, lines, playClipT, playing, togglePlay, sel, selectKey, dragging, snap, startSec, durationSec, dragOverlay, alignGuidesOn } = ctx
  // Set when the <video> can't decode its source (a .mov / 4K camera-original).
  // Keyed on editVideoUrl so swapping to a playable source clears it for free.
  const [errorUrl, setErrorUrl] = useState(null)
  const videoError = errorUrl === editVideoUrl
  const activeIdx = lines.findIndex((l) => playClipT >= l.start && playClipT < l.end)
  const activeLine = activeIdx >= 0 ? lines[activeIdx] : null
  const capCss = captionCss(caption.style, caption.accent)
  // Caption lines currently on the karaoke track. A manual overlay whose text
  // equals one of these would double-draw a spoken line (a persisted draft can
  // hold such an overlay), so it's skipped in the overlay map below to match the
  // deduped bake (dropCaptionDupeOverlays in api/_lib/captionOverlayDedup.js).
  // Captions off → no track → keep every overlay (it's then the only place that
  // text shows).
  const captionLineTexts = useMemo(() => {
    if (caption.preset === 'off') return null
    const set = new Set()
    for (const l of lines) { const t = normCaptionText(l?.text || ''); if (t) set.add(t) }
    return set.size ? set : null
  }, [caption.preset, lines])
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
    <section
      className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-muted p-4"
      // Click the empty stage backdrop (the letterbox gutter) to deselect. Guard on
      // e.target === currentTarget so a click bubbling up from the video (togglePlay)
      // or an overlay handle doesn't also clear the selection.
      onClick={(e) => { if (e.target === e.currentTarget) selectKey(null) }}
    >
      <div className="relative h-full max-h-full" style={{ aspectRatio: ctx.formatCss }}>
        <div
          className={`group relative h-full w-full cursor-pointer overflow-hidden rounded-2xl bg-black ${clipSelRing ? 'ring-2 ring-offset-2' : ''}`}
          // containerType makes cqw units resolve against THIS box — the video
          // frame — so the caption preview can be sized the same way the bake
          // sizes it (a fraction of frame width) instead of against the viewport.
          style={{ containerType: 'inline-size', ...(clipSelRing ? { boxShadow: '0 0 0 2px hsl(var(--primary))' } : null) }}
          onClick={togglePlay}
        >
          {editVideoUrl ? (
            <video
              ref={videoRef} src={editVideoUrl} poster={editPoster} preload="metadata" playsInline
              className="absolute inset-0 h-full w-full object-cover"
              style={{ filter: gradeToCanvasFilter(grade), transform: kbTransform || `scale(${z})`, transformOrigin: kbTransform ? 'center' : `${reframe.x}% ${reframe.y}%` }}
              onLoadedMetadata={(e) => ctx.setVideoDuration(e.target.duration)}
              onError={() => setErrorUrl(editVideoUrl)}
              onPlay={() => ctx.setPlaying(true)}
              onPause={() => ctx.setPlaying(false)}
              onTimeUpdate={(e) => ctx.handleTimeUpdate(e.target.currentTime)}
            />
          ) : <div className="flex h-full items-center justify-center text-sm text-white/60">No video</div>}
          {/* Undecodable source → a scrim over the poster with an explanation,
              so the dead play button has a reason instead of failing silently.
              Only appears on the error path; playable videos never see it. */}
          {videoError && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60 px-4 text-center text-xs text-white/85">
              <AlertCircle className="h-5 w-5" />
              <span>Preview unavailable — this video format can&rsquo;t play in the editor.</span>
            </div>
          )}

          {/* caption — karaoke; READ-ONLY preview of the active line. Editing the
              words moved to the Caption-lines list in the Karaoke inspector, so
              the on-frame text is no longer a click target (it used to open an
              oversized, frame-sized input that clipped a full line at the edges —
              Philip's report). pointer-events-none so the click falls through to
              togglePlay. Suppressed when captionsBaked: the video already carries
              a burned-in track, so a live overlay on top would be the double
              we're preventing. */}
          {activeLine && caption.preset !== 'off' && !captionsBaked && (
            <div
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-center font-extrabold leading-tight"
              style={{
                maxWidth: '86%',
                top: caption.position === 'top' ? '11%' : caption.position === 'center' ? '46%' : 'auto',
                bottom: caption.position === 'bottom' ? '15%' : 'auto',
                // Sized off the FRAME (cqw), matching the bake's
                // CAPTION_BASE_FS × OVERLAY_SIZE_SCALE in brandRenderVideo.js.
                // It used to be `clamp(14px, N vh, 40px)` — viewport-relative
                // with a hard ceiling — so on a tall display Medium and Large
                // previewed IDENTICALLY while baking 1.0× vs 1.35×. The control
                // appeared to do nothing and then changed the export.
                // captionSizeFactor mirrors the bake's per-workspace
                // (subtitle_font_size ?? 10)/10 multiplier so a tenant that
                // customized subtitle size previews the size it exports.
                fontSize: `${(CAPTION_BASE_FS_PCT * (CAPTION_SIZE_SCALE[caption.size] ?? 1) * captionSizeFactor).toFixed(2)}cqw`,
                color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,.6)',
                outline: sel === 'caption' ? '1.5px dashed rgba(255,255,255,.7)' : 'none', outlineOffset: '4px',
              }}
            >
              <span style={{ display: 'inline-block', ...capCss.wrap }}>
                {activeLine.words.map((w, i) => {
                  const spoken = playClipT >= w.start
                  return <span key={i} style={spoken ? capCss.active : capCss.base}>{w.word}{' '}</span>
                })}
              </span>
            </div>
          )}

          {/* manual overlays */}
          {overlays.map((o) => {
            if (playClipT < o.in || playClipT > o.out) return null
            // Skip an overlay that just duplicates a spoken caption line (mirror
            // of the bake's dropCaptionDupeOverlays) — keeps a distinct hook card.
            if (captionLineTexts && captionLineTexts.has(normCaptionText(o.text))) return null
            const isSel = isOverlaySel(sel) && sel.id === o.id
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

          {/* safe-zone margins — drag-reveal (appear while moving a text overlay) */}
          {dragging && (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute rounded-[10px] border border-dashed" style={{ inset: '5% 4%', borderColor: 'rgba(255,255,255,.4)' }} />
              <div className="absolute inset-x-0 top-0" style={{ height: '13%', background: 'rgba(255,80,80,.10)' }} />
              <div className="absolute inset-x-0 bottom-0" style={{ height: '18%', background: 'rgba(255,80,80,.10)' }} />
            </div>
          )}

          {/* Centre snap lines — light up when a dragged overlay snaps to centre;
              the Center button also flashes them briefly (alignGuidesOn). */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-px transition-opacity duration-150" style={{ background: 'hsl(var(--primary)/0.7)', opacity: (snap?.h || alignGuidesOn) ? 1 : 0 }} />
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-px transition-opacity duration-150" style={{ background: 'hsl(var(--primary)/0.7)', opacity: (snap?.v || alignGuidesOn) ? 1 : 0 }} />
            <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-150" style={{ background: 'hsl(var(--primary))', boxShadow: '0 0 0 2px white', opacity: alignGuidesOn ? 1 : 0 }} />
          </div>

          {/* center play/pause indicator — click anywhere on the video to toggle.
              Visible when paused; fades out while playing unless you hover. */}
          <div
            className={`pointer-events-none absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition-opacity ${playing ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}
            style={{ background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(2px)' }}
          >
            {playing ? <Pause className="h-7 w-7 text-white" fill="#fff" /> : <Play className="h-7 w-7 text-white" fill="#fff" />}
          </div>
          <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/30 px-1.5 py-0.5 text-3xs text-white/70">{ctx.formatDim} · {fmt(ctx.durationSec)}{startSec > 0 ? ` · from ${fmt(startSec)}` : ''}</span>
        </div>
      </div>
    </section>
  )
}

// ── INSPECTOR ────────────────────────────────────────────────────────────────
function InspectorShell({ icon: Icon, title, right, children }) {
  return (
    <>
      <div className="mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 bg-primary/[0.08]">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold text-primary">{title}</span>
        {right ? <span className="ml-auto text-3xs text-muted-foreground">{right}</span> : null}
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

function GradeInspector({ ctx }) {
  const { grade, setGradeKey, applyVibe, resetGrade, brandGrade, saveBrandGrade, savingBrand } = ctx
  const [vibePrompt, setVibePrompt] = useState('')
  const [proposing, setProposing] = useState(false)
  async function proposeFromText() {
    const prompt = vibePrompt.trim()
    if (!prompt || proposing) return
    setProposing(true)
    try {
      const res = await apiFetch('/api/editorial/propose-grade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }),
      })
      if (res?.params) { applyVibe(res.params); toast('Look applied — fine-tune below') }
      else toast('Could not read a look from that')
    } catch { toast('Describe-a-look failed') }
    finally { setProposing(false) }
  }
  return (
    <InspectorShell icon={Sparkles} title="AI Colorist — Frame grade" right="whole clip">
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Describe a look</p>
      <div className="mb-3 flex gap-1.5">
        <input
          type="text" aria-label="Describe the grade or look" value={vibePrompt}
          onChange={(e) => setVibePrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') proposeFromText() }}
          placeholder="e.g. bright, warm, clinical" disabled={proposing}
          className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-2xs outline-none focus:ring-1 focus:ring-primary/50"
          style={{ borderColor: 'hsl(var(--border))' }}
        />
        <button onClick={proposeFromText} disabled={proposing || !vibePrompt.trim()} className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-2xs font-semibold text-primary-foreground disabled:opacity-50">{proposing ? '…' : 'Apply'}</button>
      </div>
      <p className="mb-1.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Vibe presets</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          onClick={() => brandGrade && applyVibe(brandGrade)}
          disabled={!brandGrade}
          title={brandGrade ? 'Your saved brand look' : 'Dial in a grade, then "Save as Brand look" below'}
          className="rounded-full border border-action px-2.5 py-1 text-2xs font-medium text-action bg-action/[0.08] disabled:opacity-50"
        >★ Brand</button>
        {GRADE_VIBES.map((v) => (
          <button key={v.id} onClick={() => applyVibe(v.params)} className="rounded-full border border-border px-2.5 py-1 text-2xs text-muted-foreground">{v.label}</button>
        ))}
      </div>
      <p className="mb-2 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Fine-tune</p>
      {GRADE_SLIDERS.map((s) => (
        <div key={s.key} className="mb-2">
          <div className="mb-1 flex justify-between text-2xs text-muted-foreground"><span>{s.label}</span><span>{grade[s.key] > 0 ? '+' : ''}{grade[s.key]}</span></div>
          <input aria-label={s.label} type="range" min={-50} max={50} value={grade[s.key] || 0} onChange={(e) => setGradeKey(s.key, +e.target.value)} className="w-full" />
        </div>
      ))}
      <button onClick={saveBrandGrade} disabled={savingBrand} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-action py-2 text-2xs text-action bg-action/[0.06] disabled:opacity-60">
        {savingBrand ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span>★</span>}Save as Brand look
      </button>
      <button onClick={resetGrade} className="mt-1 w-full rounded-md py-1.5 text-2xs text-muted-foreground">Reset adjustments</button>
    </InspectorShell>
  )
}

// Post caption — the text that publishes BELOW the video (content_items.content),
// as opposed to the Karaoke inspector's on-screen words burned into the frame.
// The two were indistinguishable before: the reel editor had no post-caption
// field at all, so a reel's caption was frozen at draft time (feedback: "not
// seeing a place to edit the actual caption… it just put the script in the
// caption"). Shares PostCaptionField with UnifiedEditor's WordsPanel so the two
// caption surfaces can't drift. Only rendered when a post exists (ctx.captionPiece).
function PostCaptionInspector({ ctx }) {
  const { captionPiece, updateItem } = ctx
  if (!captionPiece) return null
  return (
    <InspectorShell icon={MessageSquareText} title="Post caption" right="below the video">
      <p className="mb-2 rounded-md px-2 py-1 text-3xs bg-muted text-muted-foreground">
        The text that publishes below your video — <span className="font-semibold text-foreground">not</span> the on-screen words. Those live under <span className="font-semibold text-foreground">Karaoke</span>.
      </p>
      <div className="flex min-h-0 flex-col gap-2">
        <PostCaptionField
          piece={captionPiece}
          updateItem={updateItem}
          ariaLabel="Post caption"
          placeholder="Caption visible to followers…"
          hint="Saves when you click away."
          minHeightClass="min-h-[200px]"
        />
        {canRegenerateCaption(captionPiece) && (
          <div className="shrink-0 border-t pt-3">
            <RegenerateCaptionButton piece={captionPiece} />
          </div>
        )}
      </div>
    </InspectorShell>
  )
}

function CaptionInspector({ ctx }) {
  const { asset, caption, setCaption, lines, genCaptions, genCaptionsPending, captionsEdited, resetCaptions, openSaveTemplate, captionsBaked, displayClipT, editLine, editCaptionLine, logCaptionCorrection } = ctx
  // A caption-baked clip with no clean source (a manually-exported broll) is
  // edited from its own already-captioned blob, so restyling here would double
  // the track. The controls are replaced with a plain explanation instead of
  // silently doing nothing. Trim/reframe/grade/music still apply (they don't
  // touch the caption pixels), and the true fix is re-exporting from the source.
  if (captionsBaked) {
    return (
      <InspectorShell icon={Captions} title="Karaoke captions" right="baked in">
        <div className="rounded-md border border-dashed p-3 text-2xs leading-relaxed" style={{ color: 'hsl(var(--muted-foreground))' }}>
          This clip&rsquo;s captions are <span className="font-semibold" style={{ color: 'hsl(var(--foreground))' }}>baked into the video</span>, so they can&rsquo;t be restyled here. Trim, reframe, grade, and music still apply. To change the words, re-export the clip from its original source.
        </div>
      </InspectorShell>
    )
  }
  // The workspace's own brand primary — the SAME value the hydration effect
  // (workspaceCaptionAccent(asset.workspace), above) already seeds caption.accent
  // with, and what the server bake falls back to when no explicit accent is
  // sent. The swatch row used to offer Bernard's own product colors (this
  // app's teal + amber) instead, so a workspace whose brand differs from
  // Bernard's UI had no swatch for its own already-selected default — only the
  // custom color wheel could get back to it. Leading with it here makes the
  // picker match what it's actually picking.
  const wsPrimary = workspaceCaptionAccent(asset?.workspace) || WORKSPACE_DEFAULT_ACCENT
  const seg = (label, opts, key) => (
    <div className="mb-3">
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex gap-1.5">
        {opts.map((o) => <button key={o} onClick={() => setCaption(key, o)} className="flex-1 rounded-md border py-1.5 text-2xs" style={segBtn(caption[key] === o)}>{o[0].toUpperCase() + o.slice(1)}</button>)}
      </div>
    </div>
  )
  return (
    <InspectorShell icon={Captions} title="Karaoke captions" right="on-screen · from transcript">
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>On-screen words</p>
      <div className="mb-3 flex gap-1.5">
        {['karaoke', 'off'].map((p) => <button key={p} onClick={() => setCaption('preset', p)} className="flex-1 rounded-md border py-1.5 text-3xs" style={segBtn(caption.preset === p)}>{p === 'karaoke' ? 'On' : 'Off'}</button>)}
      </div>
      {caption.preset !== 'off' && (
        <div className="mb-3">
          <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Style</p>
          <div className="grid grid-cols-2 gap-1.5">
            {CAPTION_STYLE_OPTS.map((o) => {
              const on = (caption.style || 'bold') === o.id
              const css = captionCss(o.id, caption.accent)
              return (
                <button key={o.id} onClick={() => setCaption('style', o.id)} className="rounded-md border p-1.5" style={segBtn(on)}>
                  <span className="flex h-6 items-center justify-center rounded" style={{ background: '#26302a' }}>
                    <span className="text-3xs font-extrabold leading-none" style={{ display: 'inline-block', ...css.wrap }}><span style={css.active}>Aa</span></span>
                  </span>
                  <span className="mt-1 block text-3xs">{o.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {caption.preset !== 'off' && (
        <div className="mb-3">
          <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Highlight colour</p>
          <div className="flex items-center gap-1.5">
            {[wsPrimary, '#ffffff', BERNARD_ACTION].map((c, i) => {
              const on = (caption.accent || '').toLowerCase() === c.toLowerCase()
              return <button key={c} type="button" onClick={() => setCaption('accent', c)} aria-label={i === 0 ? `Your brand colour ${c}` : `Caption colour ${c}`} title={i === 0 ? 'Your brand colour (default)' : undefined} className="h-6 w-6 rounded-full border" style={{ background: c, borderColor: on ? 'hsl(var(--primary))' : 'hsl(var(--border))', boxShadow: on ? '0 0 0 1.5px hsl(var(--primary))' : undefined }} />
            })}
            <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border" style={{ borderColor: 'hsl(var(--border))' }} title="Custom colour">
              <span className="absolute inset-0" style={{ background: 'conic-gradient(from 90deg, #f44, #fd4, #4d4, #4dd, #44f, #f4f, #f44)' }} aria-hidden="true" />
              <input type="color" value={HEX6_RE.test(caption.accent || '') ? caption.accent : wsPrimary} onChange={(e) => setCaption('accent', e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Custom caption colour" />
            </label>
          </div>
        </div>
      )}
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
        <div className="mt-2">
          {/* Caption-lines list — every spoken line as a readable, editable row,
              beside the preview instead of an oversized input on the video frame
              (Philip's report: on-frame text clipped a full line at the edges).
              Each row edits text only for v1; it commits through the existing
              editLine(idx, text), so the bake/publish path is unchanged. The row
              at the playhead is highlighted (displayClipT, same test the timeline
              caption lane uses); tapping a row seeks there via editCaptionLine. */}
          <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Caption lines · tap to edit</p>
          <div className="flex max-h-60 flex-col gap-1 overflow-auto rounded-md border p-1" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted)/0.4)' }}>
            {lines.map((l, i) => {
              const active = displayClipT >= l.start && displayClipT < l.end
              return (
                // key includes the text so a programmatic change (reset / regen /
                // a committed edit) remounts the uncontrolled input with the fresh
                // value, while in-progress typing (text unchanged until blur)
                // keeps a stable key and doesn't lose the caret.
                <div
                  key={`${i}:${l.text}`}
                  onClick={() => editCaptionLine(i)}
                  className="flex cursor-text items-start gap-1.5 rounded-md border px-1.5 py-1 transition-colors"
                  style={active
                    ? { borderColor: 'hsl(var(--primary))', background: 'hsl(var(--primary)/0.08)' }
                    : { borderColor: 'transparent', background: 'hsl(var(--card))' }}
                >
                  <span className="shrink-0 pt-px font-mono text-3xs tabular-nums" style={{ color: active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}>{fmt(l.start)}</span>
                  <input
                    defaultValue={l.text}
                    aria-label={`Caption line at ${fmt(l.start)}`}
                    onBlur={(e) => { const v = e.target.value; if (v.trim() && v !== l.text) { editLine(i, v); logCaptionCorrection?.(l.text, v, 'line') } }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
                    className="w-full min-w-0 bg-transparent text-2xs outline-none"
                    style={{ color: 'hsl(var(--foreground))', fontWeight: active ? 600 : 400 }}
                  />
                  {l.userEdited && <span className="shrink-0 pt-px text-3xs font-bold" title="Edited" style={{ color: 'hsl(var(--action))' }}>·</span>}
                </div>
              )
            })}
          </div>
          {captionsEdited && (
            <button onClick={resetCaptions} className="mt-1.5 w-full rounded-md py-1.5 text-3xs text-muted-foreground underline-offset-2 hover:underline">Reset captions to transcript</button>
          )}
        </div>
      )}
      {/* Mirrors "Save as Brand look" in the Grade inspector — dial the look in
          on a real clip, then promote it. */}
      <button
        onClick={openSaveTemplate}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border py-2 text-2xs"
        style={{ borderColor: 'hsl(var(--primary))', background: 'hsl(var(--primary)/0.06)', color: 'hsl(var(--primary))' }}
      >
        <LayoutTemplate className="h-3.5 w-3.5" />Save as video template
      </button>
    </InspectorShell>
  )
}

function OverlayInspector({ ctx }) {
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
        {['#ffffff', '#111111', caption?.accent || BERNARD_PRIMARY].map((c) => {
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

// Module-scope so it isn't re-created each render (react-hooks/static-components).
function MusicToggle({ on, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-muted'}`} role="switch" aria-checked={on}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

// Music bed (WS3.3) — curated licensed tracks, one-tap add, auto-duck under the
// voice. Preview plays the raw track; the duck/mix happens server-side at export.
function MusicInspector({ ctx }) {
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

// Moments — the AI proposals picker (replaces the old clip-review lane).
function MomentsInspector({ ctx }) {
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

// ── RAIL + VERTICAL TIMELINE (v3) ────────────────────────────────────────────
// Thin icon rail (v3) — picks the inspector tool. "Text" selects the latest
// overlay (or adds one). Replaces the old Layers/Transcript rail.
// ── Edit-by-transcript (WS4) ──────────────────────────────────────────────────
// Client mirror of api/_lib/transcriptCuts (keep in lockstep). Cuts are clip-
// relative {start,end} ranges removed from the clip; the render trims+concats the
// kept ranges and re-times the captions onto the compacted timeline.
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'hmm', 'mm', 'mhm'])
const SILENCE_GAP = 0.6
const fillerKey = (w) => w.toLowerCase().replace(/[^a-z]/g, '')
function normCutsCli(cuts, dur) {
  const cs = (cuts || []).map((c) => ({ start: Math.max(0, Math.min(dur, +c.start || 0)), end: Math.max(0, Math.min(dur, +c.end || 0)) }))
    .filter((c) => c.end - c.start > 0.02).sort((a, b) => a.start - b.start)
  const out = []
  for (const c of cs) { const last = out[out.length - 1]; if (last && c.start <= last.end + 0.01) last.end = Math.max(last.end, c.end); else out.push({ ...c }) }
  return out
}
const totalCutCli = (cuts, dur) => normCutsCli(cuts, dur).reduce((s, c) => s + (c.end - c.start), 0)
const addRange = (cuts, r, dur) => normCutsCli([...cuts, r], dur)
function subRange(cuts, r, dur) {
  const out = []
  for (const c of normCutsCli(cuts, dur)) {
    if (r.end <= c.start || r.start >= c.end) { out.push(c); continue }
    if (c.start < r.start) out.push({ start: c.start, end: r.start })
    if (r.end < c.end) out.push({ start: r.end, end: c.end })
  }
  return out
}
const inCut = (t, cuts) => cuts.some((c) => t >= c.start && t < c.end)
function silenceRanges(words, dur) {
  const out = []
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].start - words[i].end
    if (gap > SILENCE_GAP) out.push({ start: +(words[i].end + 0.05).toFixed(2), end: +(words[i + 1].start - 0.05).toFixed(2) })
  }
  return out.filter((r) => r.end - r.start > 0.1 && r.end <= dur)
}

function TranscriptInspector({ ctx }) {
  const { words, cuts, toggleWordCut, editWord, logCaptionCorrection, addCuts, clearCuts, durationSec, genCaptions, genCaptionsPending } = ctx
  const kept = Math.max(0, durationSec - totalCutCli(cuts, durationSec))
  const fillers = words.filter((w) => FILLERS.has(fillerKey(w.word)) && !inCut((w.start + w.end) / 2, cuts))
  const sils = silenceRanges(words, durationSec).filter((r) => !inCut((r.start + r.end) / 2, cuts))
  // Which word is being corrected inline (index into `words`), and a click timer
  // so a single click cuts while a double-click opens the editor (without the
  // single-click cut firing first).
  const [editingIdx, setEditingIdx] = useState(null)
  const clickTimerRef = useRef(null)
  useEffect(() => () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current) }, [])
  const onWordClick = (w) => {
    if (clickTimerRef.current) return
    clickTimerRef.current = setTimeout(() => { clickTimerRef.current = null; toggleWordCut(w) }, 210)
  }
  const onWordDbl = (i) => {
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null }
    setEditingIdx(i)
  }
  const commitEdit = (w, value, save) => {
    setEditingIdx(null)
    if (save) { editWord(w, value); logCaptionCorrection(w.word, value, 'word') }
  }
  return (
    <InspectorShell icon={FileText} title="Transcript" right={`${fmt(kept)} kept`}>
      {words.length === 0 ? (
        <>
          <p className="mb-2 text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>No transcript yet — generate captions first, then cut words here.</p>
          <button onClick={genCaptions} disabled={genCaptionsPending} className="flex w-full items-center justify-center gap-1.5 rounded-md border py-2 text-2xs disabled:opacity-60" style={{ borderColor: 'hsl(var(--action))', background: 'hsl(var(--action)/0.06)', color: 'hsl(var(--action))' }}>
            {genCaptionsPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Transcribing…</> : <><Sparkles className="h-3.5 w-3.5" />Generate captions</>}
          </button>
        </>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <button onClick={() => addCuts(fillers.map((w) => ({ start: w.start, end: w.end })))} disabled={!fillers.length} className="flex items-center gap-1 rounded-md border px-2 py-1 text-3xs disabled:opacity-40" style={{ borderColor: 'hsl(var(--border))' }}><span className="h-2 w-2 rounded-full" style={{ background: 'hsl(var(--action))' }} />Remove {fillers.length} fillers</button>
            <button onClick={() => addCuts(sils)} disabled={!sils.length} className="flex items-center gap-1 rounded-md border px-2 py-1 text-3xs disabled:opacity-40" style={{ borderColor: 'hsl(var(--border))' }}><span className="h-2 w-2 rounded-full" style={{ background: 'hsl(0 60% 55%)' }} />Remove {sils.length} silences</button>
            {cuts.length > 0 && <button onClick={clearCuts} className="ml-auto text-3xs underline-offset-2 hover:underline" style={{ color: 'hsl(var(--muted-foreground))' }}>Undo all</button>}
          </div>
          <p className="mb-2 rounded-md px-2 py-1 text-3xs bg-muted text-muted-foreground">Click a word to cut it. Double-click to fix a mis-heard word — the correction flows to the caption and export.</p>
          <div className="text-sm leading-loose">
            {words.map((w, i) => {
              if (editingIdx === i) {
                return (
                  <input
                    key={i}
                    autoFocus
                    defaultValue={w.word}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitEdit(w, e.target.value, true) }
                      else if (e.key === 'Escape') { e.preventDefault(); commitEdit(w, '', false) }
                    }}
                    onBlur={(e) => commitEdit(w, e.target.value, true)}
                    className="mx-0.5 rounded border px-1 py-0 text-sm"
                    style={{ width: `${Math.max(3, (w.word.length || 3) + 2)}ch`, borderColor: 'hsl(var(--ring))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))', outline: 'none', boxShadow: '0 0 0 3px hsl(var(--ring)/0.18)' }}
                  />
                )
              }
              const cut = inCut((w.start + w.end) / 2, cuts)
              const filler = FILLERS.has(fillerKey(w.word))
              return (
                <span key={i} onClick={() => onWordClick(w)} onDoubleClick={() => onWordDbl(i)}
                  title="Click to cut · double-click to fix the word"
                  className="cursor-pointer rounded px-0.5"
                  style={{
                    textDecoration: cut ? 'line-through' : w.edited ? 'underline' : 'none',
                    textDecorationColor: w.edited ? 'hsl(var(--primary))' : undefined,
                    textUnderlineOffset: w.edited ? '3px' : undefined,
                    color: cut ? 'hsl(var(--muted-foreground))' : filler ? 'hsl(var(--action))' : 'inherit',
                    opacity: cut ? 0.5 : 1,
                    background: !cut && w.edited ? 'hsl(var(--primary)/0.12)' : !cut && filler ? 'hsl(var(--action)/0.12)' : 'transparent',
                  }}>
                  {w.word}{' '}
                </span>
              )
            })}
          </div>
        </>
      )}
    </InspectorShell>
  )
}

// ── MEDIA inspector — swap the reel's source video ──────────────────────────
// Embedded (a video content piece) only: a reel has one video, so this REPLACES
// it. The pick is written back through the normal content PATCH (ctx.swapVideo →
// updateItem), which the server reads as a human overriding Bernard's clip
// choice — feeding the media-confidence loop. The piece's new video assetId then
// changes, which remounts the editor (StoryboardPublish keys it on that id) so
// the timeline, transcript and grade re-hydrate cleanly on the new clip.
function MediaInspector({ ctx }) {
  const { piece, pieceVideoEntry, swapVideo, swapping } = ctx
  const cur = pieceVideoEntry || null
  const durS = cur?.duration_s
  const dur = Number.isFinite(durS) && durS > 0
    ? `${Math.floor(durS / 60)}:${String(Math.round(durS % 60)).padStart(2, '0')}`
    : null
  return (
    <InspectorShell icon={Repeat} title="This reel's video">
      {cur && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-2.5">
          <div className="relative aspect-[9/16] w-11 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-slate-700 to-slate-900">
            {cur.thumbnailUrl && <img src={cur.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
            <span className="absolute inset-0 flex items-center justify-center"><Play className="h-4 w-4 text-white/80" fill="currentColor" /></span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{cur.name || 'Current clip'}</p>
            <p className="text-xs text-muted-foreground">{dur ? `${dur} · on this reel` : 'On this reel'}</p>
          </div>
        </div>
      )}

      {piece?.id
        ? <SwapAddVideo pieceId={piece.id} currentAssetId={cur?.mediaAssetId || null} onSwap={swapVideo} swapping={swapping} />
        : <p className="text-sm text-muted-foreground">Open this reel from its post to swap the video.</p>}

      <p className="mt-3 flex items-start gap-2 rounded-xl border border-dashed border-muted-foreground/30 px-3 py-2.5 text-xs leading-snug text-muted-foreground">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Swapping loads the new clip fresh — trim, captions and grade start over. Your edits stay saved on the old clip if you swap back.
      </p>
    </InspectorShell>
  )
}

function IconRail({ ctx }) {
  const { sel, selectKey, overlays, addOverlay, captionPiece, piece } = ctx
  const selKey = isOverlaySel(sel) ? 'overlay' : sel
  // 'overlay' selection lights the 'text' tool (overlays ARE the text layer).
  const active = selKey === 'overlay' ? 'text' : selKey
  const items = [
    // Post caption first when this clip belongs to a post — it's the text that
    // publishes below the video, and the thing users came here to review. Absent
    // in standalone clip editing (Moment Miner) where no post exists yet.
    ...(captionPiece ? [{ key: 'postcaption', icon: MessageSquareText, label: 'Caption' }] : []),
    { key: 'moments', icon: Scissors, label: 'Clips' },
    { key: 'clip', icon: Film, label: 'Clip' },
    // Swap the source video — only when embedded on a post (a piece to repoint).
    // Standalone clip editing (Moment Miner / Slate) edits an asset directly and
    // has no media_urls to swap.
    ...(piece ? [{ key: 'media', icon: Repeat, label: 'Media' }] : []),
    { key: 'grade', icon: Sparkles, label: 'Grade' },
    // On-screen karaoke words burned into the frame — distinct from the post
    // caption above (labeled to avoid the collision that lost users the caption).
    { key: 'caption', icon: Captions, label: 'Karaoke' },
    { key: 'music', icon: Music, label: 'Music' },
    { key: 'transcript', icon: FileText, label: 'Script' },
    { key: 'text', icon: Type, label: 'Text' },
  ]
  const pick = (k) => {
    if (k === 'text') { if (overlays.length) selectKey(`overlay:${overlays[overlays.length - 1].id}`); else addOverlay() }
    else selectKey(k)
  }
  return <EditorIconRail items={items} active={active} onPick={pick} />
}

// Bottom horizontal timeline (v4, CapCut-style) — source-relative
// (0..videoDuration). The Clip track shows the trim window [startSec,endSec]
// with left/right drag handles; the Text track shows overlay bars
// (clip-relative in/out, drawn at startSec+in) that drag freely (anchored to
// the grab point) and resize via their edges. Dragging (or clicking) anywhere
// on the track scrubs the red playhead, same as CapCut's timeline.
function HorizontalTimeline({ ctx }) {
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

// ── MAIN ─────────────────────────────────────────────────────────────────────
export default function VideoEditor({ piece = null, embedded = false, onBack = null } = {}) {
  useDocumentTitle('Video editor')
  const { assetId: routeAssetId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // Embedded from a video content piece: StoryboardPublish routes Reels /
  // long-video posts (vvideo/lvideo) HERE instead of the caption-only
  // UnifiedEditor, so "one pathway per media type" — video pieces get the full
  // editor (trim/captions/design) with the publish shell around it, mirroring
  // how photo pieces open SlideEditor. The clip to edit is then the piece's
  // attached video asset; standalone (Moment Miner / Slate) it's the route param.
  const pieceVideoEntry = useMemo(() => (
    piece && Array.isArray(piece.media_urls)
      ? piece.media_urls.find((m) => m && (m.type === 'video' || m.kind === 'video')) || null
      : null
  ), [piece])
  const assetId = piece ? (pieceVideoEntry?.mediaAssetId || null) : routeAssetId
  // Routed at both /moments/clip/:assetId and /slate/clip/:assetId — the
  // fallback (used only when there's no real history to go back to) must
  // match whichever section the URL says we're actually in, not always
  // Moment Miner. When embedded, the host (StoryboardPublish) owns "back".
  const fallbackBack = useSmartBack(() => (location.pathname.startsWith('/slate') ? '/slate' : '/moments'))
  const goBack = onBack || fallbackBack
  const videoRef = useRef(null)
  // When opened from a Media Hub edit brief ("Edit clip in Bernard"), the brief
  // id rides along as ?briefId=. Saving this clip to the Library then closes
  // that brief server-side (final_asset_id + status 'returned') — the in-app
  // replacement for the contractor "Upload final" round-trip. Query param (not
  // router state) so it survives the reloads the draft-resume flow invites.
  const briefId = useMemo(() => {
    const v = new URLSearchParams(location.search).get('briefId')
    return v && UUID_RE.test(v) ? v : null
  }, [location.search])

  // Distinct query key ('src') so the source_clip-enriched asset the editor needs
  // can't be clobbered by MediaDetail's plain ['media-asset', id] cache entry.
  const { data: asset, isLoading, error } = useQuery({ queryKey: ['media-asset', assetId, 'src'], queryFn: () => getMediaAsset(assetId, { withSourceClip: true }), enabled: !!assetId, retry: 1 })
  const { data: segData } = useQuery({ queryKey: ['video-segments', assetId], queryFn: () => getSegments(assetId), enabled: !!assetId, staleTime: 30_000 })

  // A caption-baked auto-reel's editable source is the RAW un-captioned interview
  // + this segment's source window (server resolves it as asset.source_clip via
  // video_segments.rendered_asset_id). Editing the baked blob directly would
  // re-caption an already-captioned clip — double karaoke in the preview and a
  // double-baked track on save. resolveVideoEditSource points the <video>, the
  // caption transcript, and the render at the raw source; the source window is
  // applied to startSec/endSec on hydrate below, and the existing trim/playback/
  // timeline machinery (already source-relative for manual clips cut from a long
  // interview) handles the rest unchanged. A manual clip / raw upload has no
  // source_clip and edits from its own blob exactly as before. Pure logic lives in
  // videoEditSource.js (tested) so this invariant can't silently regress.
  const editSource = useMemo(() => resolveVideoEditSource(asset, assetId), [asset, assetId])
  const editVideoUrl = editSource.videoUrl
  const editAssetId = editSource.assetId
  // A caption-baked clip with no resolvable clean source (a manually-exported
  // broll re-attached to a post) is edited from its own baked blob — so LOCK
  // captions: no live overlay, no re-bake on save, so the already-baked track
  // shows once and can't double. See videoEditSource.js.
  const captionsBaked = editSource.captionsBaked
  // <video> poster. asset.thumbnail_url is the BAKED clip's thumbnail — it carries
  // the burned-in karaoke. When editing a baked auto-reel from its RAW source
  // (window resolved), the <video> src is clean but that poster is NOT: on the
  // paused/undecoded frame it shows the baked captions UNDER the live overlay —
  // the exact double #2609 removed from the src but left on the poster. Drop it so
  // the paused frame decodes clean from the raw source. Keep it for a normal clip/
  // upload and for the captionsBaked fallback (there the video IS the baked blob,
  // so the thumbnail matches and no live overlay is drawn).
  const editPoster = editSource.window ? undefined : (asset?.thumbnail_url || undefined)

  // Embedded from a post (the publish flow) opens on the post caption — the
  // text that publishes below the video, and what users came here to review.
  // Standalone clip editing (Moment Miner) opens on Clip as before.
  const [sel, setSel] = useState(() => (embedded && piece?.id ? 'postcaption' : 'clip'))
  const [railMode, setRailMode] = useState('layers')
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [startSec, setStartSec] = useState(0)
  const [endSec, setEndSec] = useState(30)
  const [grade, setGrade] = useState({ ...NEUTRAL_GRADE })
  const [format, setFormat] = useState(() => defaultFormatFor(piece?.platform))
  const [reframe, setReframe] = useState({ zoom: 100, x: 50, y: 50 })
  const [kenBurns, setKenBurnsState] = useState({ motion: 'none', intensity: 50 })
  const [speed, setSpeedState] = useState(1)
  const [caption, setCaptionState] = useState({ preset: 'karaoke', position: 'bottom', size: 'medium', accent: BERNARD_PRIMARY, anim: 'none', style: 'bold' })
  const [overlays, setOverlays] = useState([])
  // Music bed (WS3.3): trackId null = no music. volume 0..1; duck/fade default on.
  const [music, setMusic] = useState({ trackId: null, volume: 0.22, duck: true, fade: true })
  const [cuts, setCuts] = useState([])   // edit-by-transcript: clip-relative removed ranges
  const [historyOpen, setHistoryOpen] = useState(false)
  const [revisions, setRevisions] = useState([])
  const lastRevRef = useRef(0)
  // Drag-reveal guides: safe-zone margins + centre snap lines appear while a text
  // overlay is being dragged (no persistent "safe zones" toggle). Mirrors the
  // photo editor's snapping guides.
  const [dragging, setDragging] = useState(false)
  const [snap, setSnap] = useState({ v: false, h: false })
  const [selectedSegmentId, setSelectedSegmentId] = useState(null)
  const seededRef = useRef(false)
  // Deny verdict (header) — reasons are optional, same contract as moment Retire.
  const [denyOpen, setDenyOpen] = useState(false)
  const [denyReasons, setDenyReasons] = useState([])
  const [denyNote, setDenyNote] = useState('')

  const durationSec = Math.max(1, endSec - startSec)
  const playClipT = clamp(currentTime - startSec, 0, durationSec)
  // Optimistic scrub target while dragging the timeline — the video's real
  // playClipT only updates once <video> fires timeupdate/seeked for the seek
  // we issued, which can lag a beat or never fire before the next drag frame
  // on a slow/unbuffered source. Shared by the timeline playhead and the
  // transport readout so both redraw immediately and hand off together once
  // the real value converges.
  const [scrubT, setScrubT] = useState(null)
  useEffect(() => {
    if (scrubT != null && Math.abs(playClipT - scrubT) < 0.08) setScrubT(null)
  }, [playClipT, scrubT])
  const displayClipT = scrubT != null ? scrubT : playClipT

  // Editable caption lines. Declared up here (ahead of draftDoc) so the draft
  // snapshot can persist them alongside every other editable field — otherwise
  // hand-edited caption text is dropped on autosave/reload/undo/version-restore.
  // The lines are seeded and edited further below, where the transcript-derived
  // lines are available; only the state containers live up here.
  const [captionLines, setCaptionLines] = useState([])
  // Once the user hand-edits a caption line, their words win: we stop auto-
  // re-seeding from the transcript on trim changes (which used to silently wipe
  // the edits). "Reset captions to transcript" clears this to re-derive.
  const captionsEditedRef = useRef(false)
  const [captionsEdited, setCaptionsEdited] = useState(false)
  // The startSec that captionLines' word timings are currently clip-relative to
  // (their 0:00 == this source second). It EQUALS startSec at every (re)seed and
  // restore; it only LAGS startSec when a trim moves the window while captions are
  // hand-edited (the seed effect then leaves the edited lines frozen). The `lines`
  // memo translates by (captionWin - startSec) so those frozen captions re-align to
  // the trimmed audio instead of baking misaligned — the "trimming messed up caption
  // timing" report. State (not a ref) so the `lines` memo can depend on it cleanly.
  // See applyCaptionWindow in src/lib/captionTimeline.js.
  const [captionWin, setCaptionWin] = useState(0)
  // Per-word transcript corrections (Script tab): fix a mis-transcribed word
  // ("that's" → "Yes") without re-cutting it. Keyed by the word's ABSOLUTE start
  // time (clip-relative start + trim offset) so a correction survives re-trims;
  // value is the corrected text. Applied to `words` below, which flows to the
  // Script list, the karaoke caption, and the export bake (captionWords override).
  const [wordEdits, setWordEdits] = useState({})

  // Save & resume. On open, restore this asset's editor doc — preferring the
  // SERVER draft (media_assets.video_edit_draft, cross-device) and falling back
  // to localStorage if the asset hasn't loaded a server draft yet. Autosave
  // (debounced) writes BOTH: localStorage immediately (offline mirror) + a
  // server PATCH. Fully defensive: a missing/corrupt draft just opens fresh.
  const restoredRef = useRef(false)
  // Mirrors whether the restore effect below has run — a plain ref flip
  // doesn't itself trigger a re-render, and when there's no draft to restore,
  // no setState call happens in that effect to cause one incidentally. Undo
  // history and autosave both need an actual re-render to pick up enabled=true.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    if (!asset || restoredRef.current) return
    restoredRef.current = true
    let draftAccent = null
    let draftStartSec = null
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
        // Output shape is a property of the DESTINATION, not the clip. The draft
        // is asset-scoped and shared across every piece a b-roll clip appears
        // in, so its stored shape must NOT override a new piece's platform
        // default — a clip once edited as a Vertical (9:16) reel was forcing that
        // shape onto later Google Business / LinkedIn posts. Honour a saved shape
        // only when it was chosen FOR this piece (shapePieceId match), or when
        // there's no piece at all (standalone Moment Miner / Slate). Otherwise
        // the platform default seeded at line ~1153 stands. Every OTHER draft
        // field (grade, trim, captions, music) is a genuine clip edit and still
        // restores regardless of piece.
        const savedShape = normalizeFormat(d.format)
        const shapeAppliesHere = piece ? d.shapePieceId === piece.id : true
        if (shapeAppliesHere && FORMAT_KEYS.includes(savedShape)) setFormat(savedShape)
        if (d.reframe) setReframe(d.reframe)
        if (d.kenBurns) setKenBurnsState((s) => ({ ...s, ...d.kenBurns }))
        if (Array.isArray(d.overlays)) setOverlays(d.overlays)
        if (d.speed) setSpeedState(d.speed)
        if (d.caption) { setCaptionState((c) => ({ ...c, ...d.caption })); draftAccent = d.caption.accent }
        if (Number.isFinite(d.startSec)) { setStartSec(d.startSec); draftStartSec = d.startSec }
        if (Number.isFinite(d.endSec)) setEndSec(d.endSec)
        if (Array.isArray(d.cuts)) setCuts(d.cuts)
        if (d.music) setMusic(d.music)
        // Restore hand-edited caption lines. Only when the user actually edited
        // them (captionsEdited) — an unedited draft re-seeds cleanly from the
        // current transcript below. Setting the ref true stops the seed effect
        // from clobbering the restored lines on the trim/derived-lines change.
        if (d.captionsEdited && Array.isArray(d.captionLines) && d.captionLines.length) {
          setCaptionLines(d.captionLines)
          setCaptionsEdited(true)
          captionsEditedRef.current = true
          // The restored lines are clip-relative to the window they were saved in.
          // Prefer the persisted captionWin (correct even when the draft was left
          // FROZEN mid-trim); fall back to the saved startSec for older drafts.
          setCaptionWin(Number.isFinite(d.captionWin) ? d.captionWin : (Number.isFinite(draftStartSec) ? draftStartSec : 0))
        }
        // Restore per-word transcript corrections (Script tab).
        if (d.wordEdits && typeof d.wordEdits === 'object' && !Array.isArray(d.wordEdits)) {
          setWordEdits(d.wordEdits)
        }
        seededRef.current = true // a restored trim wins over the proposal seed
      }
    } catch { /* corrupt draft — open fresh */ }
    // A caption-baked auto-reel edits from its RAW source (asset.source_clip): the
    // draft's stored trim is CLIP-relative (0..N, from when the entry pointed at
    // the baked clip), so replace it with the true SOURCE window here — otherwise
    // the raw <video> would play/render the wrong region (the interview's start,
    // not the moment). seededRef stops the proposal seed from clobbering it. A
    // genuine source-relative re-trim (startSec >= the window start) is preserved.
    const srcWindow = resolveVideoEditSource(asset, assetId).window
    if (shouldUseSourceWindow(draftStartSec, srcWindow)) {
      setStartSec(srcWindow.startSec)
      setEndSec(srcWindow.endSec)
      seededRef.current = true
      // Trim just became source-relative; treat any restored captions as belonging
      // to the new window (no translation) — matches the pre-fix as-is behavior.
      setCaptionWin(srcWindow.startSec)
    }
    // Seed the caption accent from the workspace brand when the draft didn't
    // bring a valid one. The bake always receives caption.accent (renderBody),
    // and the server resolves a missing/invalid accent via resolveBrandColors —
    // seeding the same resolution up front keeps preview == bake, while an
    // existing draft's stored (possibly hand-picked) accent stays untouched so
    // already-baked clips re-render byte-identical.
    if (!HEX6_RE.test(String(draftAccent || ''))) {
      setCaptionState((c) => ({ ...c, accent: workspaceCaptionAccent(asset.workspace) }))
    }
    setHydrated(true)
    // restoredRef guards this to one run, so `piece` in the deps can't re-fire
    // it — it's here only because the shape-restore gate above reads piece.id.
  }, [asset, assetId, piece])

  // Draft snapshot shared by autosave + undo/redo.
  // shapePieceId records WHICH piece the current `format` was chosen for, so a
  // deliberate per-post shape override sticks on reopen (see the restore gate
  // above) without leaking to a different piece that reuses the same b-roll.
  // captionWin travels with the snapshot so a draft left FROZEN mid-trim (edited
  // captions, then re-trimmed) restores with its caption timings still aligned —
  // captionLines are clip-relative to captionWin, which can lag startSec.
  const draftDoc = useMemo(
    () => ({ format, shapePieceId: piece?.id ?? null, grade, reframe, kenBurns, overlays, speed, caption, startSec, endSec, cuts, music, captionLines, captionsEdited, captionWin, wordEdits }),
    [format, piece?.id, grade, reframe, kenBurns, overlays, speed, caption, startSec, endSec, cuts, music, captionLines, captionsEdited, captionWin, wordEdits],
  )

  // Publish-fidelity guard (embedded reel). Approve/Schedule/Publish must bake the
  // CURRENT edit into media_urls, or they ship the untouched auto-reel — the
  // trim/caption style the operator sees would differ from the scheduled post
  // (feedback f46a0eec). We can't prove the pre-existing auto-reel matches the
  // hydrated editor state (its baked caption style/trim may already differ from
  // the editor's), so the edit starts DIRTY: the first commit always bakes. Each
  // in-editor bake records the exact draft it rendered, so a redundant
  // Save→Approve (draft unchanged since) doesn't re-render. JSON.stringify is
  // stable because draftDoc is a fixed-key object literal. State, not a ref, so
  // clearing dirty after a bake re-renders the workflow bar.
  const [lastBakedDoc, setLastBakedDoc] = useState(null)
  // Dirty = the current edit isn't already rendered into this piece's media, so a
  // commit must re-bake. Two ways it can be clean: it matches the doc we baked
  // earlier THIS session (lastBakedDoc), or — across a reopen, where lastBakedDoc
  // is null — the current draft's fingerprint matches the stamp the last bake
  // wrote onto the media entry. That second check is isVideoEditUnbaked, the SAME
  // predicate /week's server dispatch uses (dispatchContentItem.js), so the editor
  // and the server can't disagree about whether a reel still needs baking; before
  // this, reopening an already-baked reel and hitting Approve paid a full ~1-min
  // re-render for nothing. An untouched auto-reel carries no stamp, so it stays
  // dirty and its first commit bakes — that render is genuinely unavoidable here
  // (the auto-reel was rendered from segment params, not a draft doc, so there's
  // no baseline to compare a zero-edit draft against). The failure mode of a
  // hydration round-trip that doesn't fingerprint-match is a redundant bake, never
  // a stale ship, so this only ever removes work, never fidelity.
  const videoEditDirty = useMemo(() => {
    if (!(embedded && piece?.id)) return false
    if (JSON.stringify(draftDoc) === lastBakedDoc) return false
    return isVideoEditUnbaked(pieceVideoEntry, draftDoc)
  }, [embedded, piece?.id, draftDoc, lastBakedDoc, pieceVideoEntry])

  // localStorage mirror — immediate, undebounced offline copy. The server
  // PATCH below is debounced via useAutosave, which also flushes any pending
  // save on unmount so navigating away mid-edit doesn't drop the change.
  useEffect(() => {
    if (!assetId || !hydrated) return
    try { localStorage.setItem(`videoEdit:${assetId}`, JSON.stringify(draftDoc)) } catch { /* quota — ignore */ }
  }, [assetId, hydrated, draftDoc])

  const { status: saveStatus } = useAutosave(
    draftDoc,
    (doc) => updateMediaAsset(assetId, { videoEditDraft: doc }),
    { debounceMs: 1500, enabled: !!assetId && hydrated, resetKey: assetId },
  )

  // Undo/redo over the same draft shape the autosave above persists. Disabled
  // until the server/localStorage draft has hydrated, so the initial restore
  // doesn't itself become an undoable step.
  const { undo, redo, canUndo, canRedo } = useUndoHistory(draftDoc, (snap) => {
    setFormat(normalizeFormat(snap.format))
    setGrade(snap.grade)
    setReframe(snap.reframe)
    setKenBurnsState(snap.kenBurns)
    setOverlays(snap.overlays)
    setSpeedState(snap.speed)
    setCaptionState(snap.caption)
    setStartSec(snap.startSec)
    setEndSec(snap.endSec)
    setCuts(snap.cuts || [])
    setMusic(snap.music || { trackId: null, volume: 0.22, duck: true, fade: true })
    setCaptionLines(snap.captionLines || [])
    setCaptionsEdited(!!snap.captionsEdited)
    captionsEditedRef.current = !!snap.captionsEdited
    setCaptionWin(Number.isFinite(snap.captionWin) ? snap.captionWin : (Number.isFinite(snap.startSec) ? snap.startSec : 0))
    setWordEdits(snap.wordEdits || {})
  }, { enabled: hydrated })
  useUndoRedoShortcut(undo, redo)

  // Version history (WS5) — apply a saved snapshot back into editor state.
  const applyDoc = useCallback((d) => {
    if (!d || typeof d !== 'object') return
    if (d.grade) setGrade(d.grade)
    if (FORMAT_KEYS.includes(normalizeFormat(d.format))) setFormat(normalizeFormat(d.format))
    if (d.reframe) setReframe(d.reframe)
    if (d.kenBurns) setKenBurnsState((s) => ({ ...s, ...d.kenBurns }))
    if (Array.isArray(d.overlays)) setOverlays(d.overlays)
    if (d.speed) setSpeedState(d.speed)
    if (d.caption) setCaptionState((c) => ({ ...c, ...d.caption }))
    if (Number.isFinite(d.startSec)) setStartSec(d.startSec)
    if (Number.isFinite(d.endSec)) setEndSec(d.endSec)
    if (Array.isArray(d.cuts)) setCuts(d.cuts)
    setMusic(d.music || { trackId: null, volume: 0.22, duck: true, fade: true })
    if (Array.isArray(d.captionLines)) setCaptionLines(d.captionLines)
    setCaptionsEdited(!!d.captionsEdited)
    captionsEditedRef.current = !!d.captionsEdited
    setCaptionWin(Number.isFinite(d.captionWin) ? d.captionWin : (Number.isFinite(d.startSec) ? d.startSec : 0))
  }, [])
  // Auto-snapshot the draft at most every ~3 min of editing (pruned to 30 server-side).
  useEffect(() => {
    if (!hydrated || !assetId) return
    const now = Date.now()
    if (now - lastRevRef.current < 180000) return
    lastRevRef.current = now
    saveRevision('video', assetId, draftDoc).catch(() => {})
  }, [draftDoc, hydrated, assetId])
  async function openHistory() {
    if (historyOpen) { setHistoryOpen(false); return }
    try { const r = await listRevisions('video', assetId); setRevisions(r?.revisions || []) } catch { setRevisions([]) }
    setHistoryOpen(true)
  }

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

  // For a baked auto-reel, editTranscriptWords is the RAW source's word track;
  // slicing it to the source window [startSec,endSec] rebases to 0 and yields the
  // exact words reelFactory baked — so the live caption preview matches the clip
  // (and the un-captioned raw video underneath), WYSIWYG. For a manual clip it is
  // the asset's own transcript, unchanged.
  const rawWords = useMemo(() => sliceWords(editSource.transcriptWords, startSec, durationSec), [editSource, startSec, durationSec])
  // Source-relative word boundaries the trim handles soft-snap to, so a cut lands
  // BETWEEN words instead of slicing one in half — a straddling word gets clamped to
  // 0:00 by sliceWords and mistimes the first caption line (the "shrunk / messed up
  // caption timing" report). In-handle snaps to word STARTS, out-handle to word ENDS;
  // silent gaps carry no boundaries, so trims there stay free. transcriptWords are
  // absolute source seconds — the same space as startSec / span.
  const trimSnaps = useMemo(() => {
    const ws = Array.isArray(editSource.transcriptWords) ? editSource.transcriptWords : []
    const starts = [], ends = []
    for (const wd of ws) {
      const a = Number(wd?.start), b = Number(wd?.end)
      if (Number.isFinite(a)) starts.push(a)
      if (Number.isFinite(b)) ends.push(b)
    }
    return { starts, ends }
  }, [editSource])
  // Apply per-word corrections (keyed by absolute start time). A corrected word
  // carries `edited: true` so the Script list can mark it. Text-only change —
  // timings are untouched, so cut ranges and karaoke timing stay valid.
  const words = useMemo(() => {
    if (!wordEdits || !Object.keys(wordEdits).length) return rawWords
    const s = Math.max(0, startSec || 0)
    return rawWords.map((w) => {
      const fix = wordEdits[(w.start + s).toFixed(2)]
      return fix != null && fix !== w.word ? { ...w, word: fix, edited: true } : w
    })
  }, [rawWords, wordEdits, startSec])
  const editWord = useCallback((w, text) => {
    const clean = String(text || '').trim()
    if (!clean || clean === w.word) return
    const s = Math.max(0, startSec || 0)
    const key = (w.start + s).toFixed(2)
    setWordEdits((prev) => (prev[key] === clean ? prev : { ...prev, [key]: clean }))
  }, [startSec])
  // Instrument caption corrections (heard → fixed) so we can measure whether the
  // new timeline caption track actually gets used to fix words, and which terms
  // recur — the go/no-go signal for an auto-correct pass (Option A in
  // .claude/decisions.md "Auto-correct captions"). MEASUREMENT ONLY: nothing is
  // rewritten. Emits once at commit (blur/Enter), never per keystroke. PostHog
  // already attaches the workspace group, so per-workspace rate is queryable
  // without threading workspace through here.
  const logCaptionCorrection = useCallback((heard, fixed, source) => {
    const a = String(heard || '').trim(), b = String(fixed || '').trim()
    if (!a || !b || a.toLowerCase() === b.toLowerCase()) return
    posthogCapture('caption_correction', {
      source, // 'line' | 'word'
      heard: a.slice(0, 120),
      fixed: b.slice(0, 120),
      heard_words: a.split(/\s+/).length,
      fixed_words: b.split(/\s+/).length,
      asset_id: assetId || null,
    })
  }, [assetId])
  const derivedLines = useMemo(() => groupLines(words), [words])
  // captionLines / captionsEdited / captionsEditedRef are declared above (near
  // draftDoc) so the draft snapshot can persist edited caption text. Here we
  // seed them from the derived transcript lines and re-split on edit: editing a
  // line re-distributes its words across the line's time so karaoke still
  // animates, and the bake receives these EXACT words (captionWords override →
  // preview==publish for edited captions).
  // Re-seed only when the trim window or line count actually changes — NOT on a
  // bare asset-object refetch, and NOT once the user has manually edited a line.
  const seedSigRef = useRef('')
  useEffect(() => {
    // Include the derived TEXT (not just line count) so a word correction — which
    // changes a word without changing the line count — still re-seeds the caption
    // from the corrected transcript. Manual line edits stay protected by the
    // captionsEditedRef guard below.
    const sig = `${startSec}|${durationSec}|${derivedLines.map((l) => l.text).join('')}`
    if (sig === seedSigRef.current) return
    seedSigRef.current = sig
    if (captionsEditedRef.current) return
    setCaptionLines(derivedLines)
    setCaptionWin(startSec) // derivedLines are clip-relative to this window
  }, [derivedLines, startSec, durationSec])
  const resetCaptions = useCallback(() => {
    captionsEditedRef.current = false
    setCaptionsEdited(false)
    setCaptionLines(derivedLines)
    setCaptionWin(startSec)
  }, [derivedLines, startSec])
  const editLine = useCallback((i, text) => {
    captionsEditedRef.current = true
    setCaptionsEdited(true)
    setCaptionLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l
      const parts = text.trim().split(/\s+/).filter(Boolean)
      const span = Math.max(0.01, l.end - l.start)
      const w = parts.map((word, k) => ({
        word,
        start: +(l.start + span * k / parts.length).toFixed(2),
        end: +(l.start + span * (k + 1) / parts.length).toFixed(2),
      }))
      // Mark the line as user-authored so per-word transcript corrections skip
      // it (see the `lines` memo). Timing alone cannot discriminate: a rewritten
      // line's words are redistributed across the ORIGINAL line span, so its
      // first word always starts exactly at the first transcript word's start
      // and would collide with that word's correction key.
      return { ...l, text, words: w, userEdited: true }
    }))
  }, [])
  // Apply per-word corrections to the caption lines themselves, not just to the
  // Script list. The re-seed effect above is the ONLY route a word fix used to
  // take into the captions, and it bails once captionsEditedRef is set — so as
  // soon as a user hand-edited any one line, every later word correction showed
  // underlined in the Script tab but never reached the caption or the export.
  // That is the original "script not allowing change of words" report in a
  // narrower form, and the only escape was "Reset captions to transcript", which
  // throws away all their line edits.
  //
  // Lines the user rewrote themselves are skipped outright (l.userEdited) — their
  // typed text wins. Timing alone cannot make that call: editLine() redistributes
  // a rewritten line's words across the ORIGINAL line span, so its first word
  // always starts exactly at the first transcript word's start and would collide
  // with that word's correction key.
  const lines = useMemo(
    () => applyCaptionWindow(captionLines, { wordEdits, captionWin, startSec, durationSec }),
    [captionLines, wordEdits, captionWin, startSec, durationSec],
  )

  // playback: keep <video> within the trim window
  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return
    if (playing) v.pause()
    // .catch swallows the promise rejection an undecodable source (a .mov / 4K
    // camera-original) throws — NotSupportedError — which was surfacing in prod
    // as an unhandled rejection. The <video>'s onError paints the fallback.
    else { if (v.currentTime < startSec || v.currentTime >= endSec) v.currentTime = startSec; v.playbackRate = speed; v.play().catch(() => {}) }
  }, [playing, startSec, endSec, speed])
  useEffect(() => { const v = videoRef.current; if (v) v.playbackRate = speed }, [speed])
  const seekClip = useCallback((clipT) => { const v = videoRef.current; if (!v) return; v.currentTime = startSec + clamp(clipT, 0, durationSec) }, [startSec, durationSec])
  // Nudge the playhead ~one frame (1/30s), clamped to the trim window.
  const stepFrame = useCallback((dir) => {
    const v = videoRef.current
    const nt = clamp((v ? v.currentTime : startSec) + dir / 30, startSec, endSec)
    if (v) { v.pause(); v.currentTime = nt }
    setCurrentTime(nt)
    setScrubT(clamp(nt - startSec, 0, durationSec))
  }, [startSec, endSec, durationSec])
  // Jump the playhead by ±N seconds (keyboard shuttle), clamped to the trim
  // window. Keeps playback running if it was — only stepFrame pauses.
  const seekBy = useCallback((delta) => {
    const v = videoRef.current
    const nt = clamp((v ? v.currentTime : startSec) + delta, startSec, endSec)
    if (v) v.currentTime = nt
    setCurrentTime(nt)
    setScrubT(clamp(nt - startSec, 0, durationSec))
  }, [startSec, endSec, durationSec])
  const seekToClip = useCallback((clipT) => {
    const v = videoRef.current
    const nt = clamp(startSec + clipT, startSec, endSec)
    if (v) v.currentTime = nt
    setCurrentTime(nt)
    setScrubT(clamp(nt - startSec, 0, durationSec))
  }, [startSec, endSec, durationSec])
  const toStart = useCallback(() => seekToClip(0), [seekToClip])
  const toEnd = useCallback(() => seekToClip(durationSec), [seekToClip, durationSec])
  // Standard editor keyboard transport (Space play/pause, arrows step, etc.).
  useVideoShortcuts({ togglePlay, stepFrame, seekBy, toStart, toEnd })

  const selectKey = useCallback((k) => {
    if (typeof k === 'string' && k.startsWith('overlay:')) setSel({ type: 'overlay', id: k.split(':')[1] })
    else setSel(k)
  }, [])
  const curOverlay = isOverlaySel(sel) ? overlays.find((o) => o.id === sel.id) : null

  // overlay actions
  const addOverlay = useCallback(() => {
    const id = `o${Date.now()}`
    setOverlays((prev) => [...prev, { id, role: 'callout', text: 'New text', x: 0.5, y: 0.5, size: 1, in: clamp(playClipT, 0, durationSec - 1), out: clamp(playClipT + 3, 1, durationSec), color: '#ffffff' }])
    setSel({ type: 'overlay', id })
  }, [playClipT, durationSec])
  const setOverlay = useCallback((k, v) => setOverlays((prev) => prev.map((o) => (isOverlaySel(sel) && o.id === sel.id ? { ...o, [k]: v } : o))), [sel])
  const setOverlayTime = useCallback((k, v) => setOverlays((prev) => prev.map((o) => (isOverlaySel(sel) && o.id === sel.id ? { ...o, [k]: clamp(Number(v) || 0, 0, durationSec) } : o))), [sel, durationSec])
  // Set a specific overlay's in/out by id (used by the vertical timeline bar drag/resize).
  const setOverlayWindow = useCallback((id, inT, outT) => setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, in: clamp(inT, 0, durationSec), out: clamp(outT, 0, durationSec) } : o))), [durationSec])
  const delOverlay = useCallback(() => { setOverlays((prev) => prev.filter((o) => !(isOverlaySel(sel) && o.id === sel.id))); setSel('clip') }, [sel])
  const dragOverlay = useCallback((e, id) => {
    e.preventDefault(); e.stopPropagation()
    const frame = e.currentTarget.parentElement
    let moved = false
    const move = (ev) => {
      if (!moved) { moved = true; setDragging(true) }   // reveal guides on real drag
      const r = frame.getBoundingClientRect()
      let x = clamp((ev.clientX - r.left) / r.width, 0.06, 0.94)
      let y = clamp((ev.clientY - r.top) / r.height, 0.05, 0.95)
      const sv = Math.abs(x - 0.5) < 0.02; const sh = Math.abs(y - 0.5) < 0.02
      if (sv) x = 0.5
      if (sh) y = 0.5
      setSnap({ v: sv, h: sh })
      setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, x, y } : o)))
    }
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      if (moved) { setDragging(false); setSnap({ v: false, h: false }) }
    }
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
  // WS6 auto-reframe — detect the speaker's face in the current frame and centre
  // the crop's horizontal position on them. Degrades to manual if no face / model.
  const [autoReframing, setAutoReframing] = useState(false)
  const autoReframe = useCallback(async () => {
    setAutoReframing(true)
    try {
      const cx = await detectFaceCenterX(videoRef.current)
      if (cx == null) { toast('No face detected — reframe manually'); return }
      setReframeKey('x', Math.round(cx * 100))
      toast('Centred on the speaker')
    } catch { toast('Auto-reframe unavailable') }
    finally { setAutoReframing(false) }
  }, [setReframeKey])
  const setKenBurns = useCallback((k, v) => setKenBurnsState((s) => ({ ...s, [k]: v })), [])
  const setCaption = useCallback((k, v) => setCaptionState((c) => ({ ...c, [k]: v })), [])
  const setSpeed = useCallback((s) => setSpeedState(s), [])
  // Edit-by-transcript cut handlers (all clip-relative to durationSec).
  const toggleWordCut = useCallback((w) => {
    const mid = (w.start + w.end) / 2
    setCuts((prev) => (inCut(mid, prev) ? subRange(prev, { start: w.start, end: w.end }, durationSec) : addRange(prev, { start: w.start, end: w.end }, durationSec)))
  }, [durationSec])
  const addCuts = useCallback((ranges) => setCuts((prev) => (ranges || []).reduce((acc, r) => addRange(acc, r, durationSec), prev)), [durationSec])
  const clearCuts = useCallback(() => setCuts([]), [])
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
  const [dest, setDest] = useState({ broll: true, ad: false })
  // Async b-roll export: the id of the destination row we're polling to
  // completion (null when idle). See exportMutation + the poll effect below.
  const [pollBrollId, setPollBrollId] = useState(null)
  const exportPollStartRef = useRef(0)
  const toggleDest = (k) => setDest((d) => ({ ...d, [k]: !d[k] }))

  // Inline "finalize this clip into a post" — Q's "create the post inline" so
  // approve + Sounds-like-me + publish all happen right here without exporting
  // and jumping to the Publish screen. One "Sounds like me" click renders the
  // trimmed clip, creates the content_item (clip-to-post), and approves it; the
  // header then swaps to the shared EditorWorkflowBar bound to that new post so
  // the publish controls (Schedule / queue / now) light up in place.
  // Embedded: bind the header workflow bar to the EXISTING piece from the start
  // (no clip-to-post creation) so Approve / Schedule / publish act on this reel.
  const [postId, setPostId] = useState(piece?.id ?? null)
  const updatePostStatus = useUpdateContentItemStatus()
  const { data: post } = useContentItem(postId)
  const finalizeToPost = useAppMutation({
    mutationFn: async () => {
      const render = await doRenderClip()
      const d = await apiFetch('/api/editorial/clip-to-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, renderedBlobUrl: render.blobUrl, captionText: captionSummary(), platform: 'instagram' }),
      })
      const id = d?.contentItemId
      if (!id) throw new Error('Could not create the post from this clip.')
      // "Sounds like me" is the sign-off — approve the fresh draft so the bar
      // lands on the publish step. approved_by is stamped server-side.
      await updatePostStatus.mutateAsync({ id, status: 'approved', approvedAt: new Date().toISOString() })
      return id
    },
    onSuccess: (id) => { setPostId(id); toast('Clip finalized & approved — ready to publish') },
  })
  const captionSummary = () => lines.map((l) => l.text).join(' ').slice(0, 500)
  const renderBody = () => ({
    // editAssetId is the RAW source for a baked auto-reel (else the asset itself),
    // and startSec/endSec are its source-relative window — so the bake renders the
    // un-captioned source once with these captions, never re-caption the baked clip.
    // captionsBaked (a baked broll with no clean source) forces subtitles off so a
    // re-render doesn't burn a SECOND track over the already-baked one.
    assetId: editAssetId, channels: [channelFor(format, piece?.platform)], startSec, durationSec, subtitles: !captionsBaked && caption.preset !== 'off',
    overlayPosition: caption.position, overlaySize: caption.size, captionAccent: caption.accent,
    captionAnim: caption.anim, captionStyle: caption.style,
    grade, reframe, speed, cuts,
    ...(kenBurns.motion && kenBurns.motion !== 'none' ? { kenBurns } : {}),
    // EXACT (possibly edited) caption words so the bake matches the preview.
    captionWords: lines.flatMap((l) => l.words),
    overlays: overlays.map((o) => ({ role: o.role, text: o.text, x: o.x, y: o.y, size: o.size, color: o.color, in: o.in, out: o.out })),
    // Music bed (WS3.3): the server resolves the URL from trackId (source of
    // truth), so we send only the id + mix options. Omitted when no track picked.
    ...(music.trackId ? { music: { trackId: music.trackId, volume: music.volume, duck: music.duck, fade: music.fade } } : {}),
  })
  // Render the current edit into a finished clip and resolve with its blob.
  //
  // The render runs ASYNC on a fresh worker budget (render-clip-job): kick a job
  // (202), then poll it to a terminal status. A long/hi-res EDITED reel used to
  // render inside ONE synchronous /api/editorial/render-clip request and 504 at
  // the 300s wall, which aborted the commit and made that reel un-publishable.
  // Offloading only the raw render keeps the return contract IDENTICAL
  // ({ blobUrl, width, height, sizeBytes, hadSubtitles }), so both callers
  // (saveVideoToPiece's media_urls finalization + finalizeToPost) are unchanged
  // — the stamp/draft/PATCH fidelity logic stays entirely client-side.
  //
  // Hard-capped: the worker has its own 300s budget and a stuck job is swept to
  // 'failed' by cron, so this never loops forever; on cap it throws so the
  // commit aborts (never ships a stale reel) with a legible message.
  async function doRenderClip() {
    const kicked = await startClipRenderJob(renderBody())
    const jobId = kicked?.jobId
    if (!jobId) throw new Error('Render did not start — please try again.')

    const CAP_MS = 6 * 60 * 1000
    const startedAt = Date.now()
    while (Date.now() - startedAt < CAP_MS) {
      await new Promise((r) => setTimeout(r, 2500))
      let job
      try {
        job = await getClipRenderJob(jobId)
      } catch {
        continue  // transient read blip — keep polling until the cap
      }
      if (job?.status === 'ready') {
        if (!job.blobUrl) throw new Error('Render returned no output.')
        return { blobUrl: job.blobUrl, width: job.width, height: job.height, sizeBytes: job.sizeBytes, hadSubtitles: job.hadSubtitles }
      }
      if (job?.status === 'failed') throw new Error(job.error || 'Render failed — please try again.')
    }
    throw new Error('Rendering took too long — please try again.')
  }

  // Embedded (video content piece) render-back. Editing a Reel from the publish
  // screen must bake the current edit (trim/captions/overlays/grade) and write
  // the finished clip back onto THIS piece's media_urls — so Approve/Schedule
  // publishes the EDITED video, never the untouched source. The per-asset edit
  // spec itself is already persisted by the autosave draft (media_assets.
  // video_edit_draft), so re-opening restores the timeline; here we only need to
  // persist the baked output the publisher will send. mediaAssetId stays the
  // SOURCE asset (so re-open re-edits from source), url is the baked render.
  const updateItem = useUpdateContentItem()
  const saveVideoToPiece = useAppMutation({
    errorMessage: 'Could not save the video to this post.',
    mutationFn: async () => {
      // Snapshot the draft we're about to render BEFORE the async work, so a mid-
      // render edit isn't wrongly marked as already-baked. Committed to
      // lastBakedDocRef only after the persist succeeds.
      const bakedSnapshot = draftDoc
      const bakedDoc = JSON.stringify(bakedSnapshot)
      // Stamp the SERVER-readable marker of what this render was made from, so
      // /week's inline Approve can tell an already-baked reel from one carrying
      // a pending edit and route the latter back here instead of dispatching the
      // stale render. See src/lib/videoEditFingerprint.js.
      const bakedPrint = videoEditFingerprint(bakedSnapshot)
      const render = await doRenderClip()
      const baked = {
        url: render.blobUrl,
        type: 'video',
        kind: 'video',
        mediaAssetId: pieceVideoEntry?.mediaAssetId || null,
        thumbnailUrl: pieceVideoEntry?.thumbnailUrl || null,
        ...(pieceVideoEntry?.name ? { name: pieceVideoEntry.name } : {}),
        ...(bakedPrint ? { [VIDEO_EDIT_HASH_KEY]: bakedPrint } : {}),
      }
      // Flush the exact doc the stamp describes to the asset now rather than
      // waiting on the 1500ms autosave debounce. Without this, a bake followed
      // immediately by an Approve elsewhere compares the new stamp against the
      // PREVIOUS draft and defers a reel that is in fact freshly baked.
      if (assetId) await updateMediaAsset(assetId, { videoEditDraft: bakedSnapshot }).catch(() => {})
      await updateItem.mutateAsync({ id: piece.id, patch: { mediaUrls: [baked] } })
      setLastBakedDoc(bakedDoc)
      // Return the fresh media_urls so an auto-bake-on-commit can dispatch THESE
      // (the parent's piece query can't have refetched yet in the same click).
      return [baked]
    },
    onSuccess: () => toast('Video saved to this post — approve & schedule when ready'),
  })

  // Bake the current edit into the post before a commit (Approve / Schedule /
  // Publish / Retry), but only when it differs from what was last baked — a
  // redundant Save→Approve won't re-render. Returns the freshly-baked media_urls
  // for the publish override, or null when nothing needed baking. Wired to the
  // embedded EditorWorkflowBar as onBeforeCommit; a throw (render failure)
  // propagates so the commit is aborted rather than shipping a stale reel.
  const bakeVideoIfDirty = useCallback(async () => {
    if (!embedded || !piece?.id || !videoEditDirty) return null
    return await saveVideoToPiece.mutateAsync()
  }, [embedded, piece?.id, videoEditDirty, saveVideoToPiece])

  // Swap the reel's SOURCE video. Writes the picked clip to media_urls through
  // the normal content PATCH so classifyMediaChange stamps media_source:'human'
  // — the same override signal that already trains Bernard's photo picking, now
  // for video. The new clip's assetId then differs, and StoryboardPublish keys
  // the editor on that id, so the whole editor remounts and re-hydrates cleanly
  // on the new source (the restore effect is one-shot per mount by design and
  // would otherwise strand the old clip's trim/captions on the new video).
  const swapVideoMutation = useAppMutation({
    errorMessage: 'Could not swap the video on this post.',
    mutationFn: (entry) => piece?.id
      ? updateItem.mutateAsync({ id: piece.id, patch: { mediaUrls: [entry] } })
      : Promise.resolve(),
    onSuccess: () => toast('Swapped — the new clip is loaded'),
  })

  // ONE render → every selected destination. Post + b-roll share the single reel
  // render; ad export is its own (interactive) modal flow opened afterward.
  // Export = the non-post destinations (Library b-roll + ad sizes). The post
  // path moved inline (finalizeToPost above), so this no longer navigates away.
  const exportMutation = useAppMutation({
    mutationFn: async () => {
      let renderingAssetId = null
      if (dest.broll) {
        // Async export: the clip renders on a FRESH worker budget instead of
        // inline, so a long/hi-res clip can't blow the 300s ceiling → 504
        // ("Failed Export to library"). Returns fast (202) with the new b-roll
        // row id; we poll it to completion below. briefId is passed only when
        // this clip was opened from a Media Hub brief (the worker closes it on
        // success, scoped to workspace + this exact source asset).
        const r = await exportClipToBroll({ ...renderBody(), captionText: captionSummary(), ...(briefId ? { briefId } : {}) })
        renderingAssetId = r?.assetId || null
      }
      return { renderingAssetId }
    },
    onSuccess: ({ renderingAssetId }) => {
      if (dest.broll) {
        toast('Rendering your clip — it’ll appear in your Library shortly.')
        if (renderingAssetId) { exportPollStartRef.current = 0; setPollBrollId(renderingAssetId) }
      }
      setExportOpen(false)
      // Ad export is an interactive download modal — open it and STAY here.
      if (dest.ad) { setAdExportOpen(true) }
    },
  })
  // Poll the async b-roll export to completion so we can toast success/failure
  // without blocking the editor (the button frees the instant the 202 lands,
  // matching the full-video render UX). Hard-capped — the worker has its own
  // 300s budget and a stuck row is swept to 'failed' by cron within ~10min, so
  // this never loops forever.
  const EXPORT_POLL_CAP_MS = 6 * 60 * 1000
  const { data: pollBroll } = useQuery({
    queryKey: ['media-asset', pollBrollId],
    queryFn: () => getMediaAsset(pollBrollId),
    enabled: !!pollBrollId,
    refetchInterval: (q) => {
      if (!pollBrollId) return false
      const row = q.state.data
      if (row?.render_status && row.render_status !== 'rendering') return false
      if (!exportPollStartRef.current) exportPollStartRef.current = Date.now()
      if (Date.now() - exportPollStartRef.current > EXPORT_POLL_CAP_MS) return false
      return 2500
    },
    refetchOnWindowFocus: false,
  })
  useEffect(() => {
    if (!pollBrollId || !pollBroll) return
    const s = pollBroll.render_status
    if (s === 'ready') { toast('Clip saved to your Library.'); exportPollStartRef.current = 0; setPollBrollId(null) }
    else if (s === 'failed') { toast('Clip export failed — please try again.'); exportPollStartRef.current = 0; setPollBrollId(null) }
  }, [pollBrollId, pollBroll])
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

  // Auto-transcribe raw uploads (Phase 2). A Reel / long-video piece opened in
  // the publish shell whose video is a raw upload (no transcript_words — e.g.
  // b-roll that never went through the interview segmenter, like a phone-shot
  // clip) has no word timings, so the Caps/Script tabs would start empty and the
  // karaoke captions can't render. Fire the SAME transcription genCaptions uses,
  // once on open, so word-level caption editing is ready without the manual
  // "Generate captions" click — "video subtitle control works on every reel, not
  // just interview-derived clips". Scoped to the embedded reel flow (Q's
  // "auto-transcribe raw uploads"); standalone Moment Miner / Slate clips are
  // interview-derived and already carry a transcript, so this stays off there and
  // doesn't spend a transcription on every clip open. Guarded by a ref so it
  // fires at most once per mount, and it self-skips the instant words exist
  // (including right after it lands, since genCaptions writes them to the cache).
  const autoTranscribedRef = useRef(false)
  useEffect(() => {
    if (!embedded || autoTranscribedRef.current) return
    if (!asset || genCaptionsMutation.isPending) return
    const hasWords = Array.isArray(asset.transcript_words) && asset.transcript_words.length > 0
    if (asset.kind !== 'video' || hasWords) return
    autoTranscribedRef.current = true
    toast('Transcribing your video so you can edit the captions…')
    genCaptionsMutation.mutate()
  }, [embedded, asset, genCaptionsMutation])

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

  // Deny the clip you're looking at, with an optional reason (migration 202).
  // The same status write the side-panel Discard link does — this is the header
  // affordance for it, because the link was findable enough to be used once in
  // 172 segments. Reasons ride along; skipping them still denies.
  const denyClip = useAppMutation({
    errorMessage: "Couldn't deny this clip",
    mutationFn: () => updateSegment(selectedSegmentId, 'discarded', { reasons: denyReasons, note: denyNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['video-segments', assetId] })
      posthogCapture('clip_denied', { assetId, segmentId: selectedSegmentId, reasons: denyReasons })
      setSelectedSegmentId(null)
      setDenyOpen(false); setDenyReasons([]); setDenyNote('')
      toast.success('Clip denied', { description: 'It won’t be offered again.' })
    },
  })
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
    onSuccess: () => toast("Saved as your Brand look — it's now a vibe preset."),
  })

  // Save-as-template — the look of THIS clip becomes a reusable video template.
  // Authoring happens in the editor rather than a separate template screen, so
  // what you signed off on is literally what the bake produces. The dialog shows
  // the captured/skipped split before committing: a template that silently took
  // the wrong things is only discovered on the next reel.
  const [tplOpen, setTplOpen] = useState(false)
  const [tplName, setTplName] = useState('')
  const tplDraft = useMemo(
    () => buildTemplateFromEditor({ caption, overlays, durationSec }),
    [caption, overlays, durationSec],
  )
  function openSaveTemplate() {
    setTplName(suggestTemplateName({ caption, overlays }))
    setTplOpen(true)
  }
  const saveTemplateMutation = useAppMutation({
    mutationFn: async ({ name, makeDefault }) => {
      const row = await apiFetch('/api/video-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, is_default: !!makeDefault, config: tplDraft.config }),
      })
      // The PIN is what the factory reads first (reelFactory resolves pin →
      // default row → built-in), so setting is_default alone is a silent no-op
      // for any workspace that already has one. "Use for new reels" has to move
      // the pin or it does nothing visible.
      if (makeDefault && row?.id) {
        await apiFetch('/api/workspace/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reel_preset: row.id }),
        })
      }
      return row
    },
    onSuccess: (_d, vars) => {
      setTplOpen(false)
      toast(vars?.makeDefault
        ? `Saved "${vars.name}" — new reels use it from now on.`
        : `Saved "${vars?.name}" as a template.`)
    },
  })

  const [alignGuidesOn, setAlignGuidesOn] = useState(false)
  const alignGuideTimerRef = useRef(null)
  function flashAlignGuides() {
    if (alignGuideTimerRef.current) clearTimeout(alignGuideTimerRef.current)
    setAlignGuidesOn(true)
    alignGuideTimerRef.current = setTimeout(() => setAlignGuidesOn(false), 800)
  }
  // Clear the flash timer on unmount so it can't fire setAlignGuidesOn after teardown.
  useEffect(() => () => { if (alignGuideTimerRef.current) clearTimeout(alignGuideTimerRef.current) }, [])
  // Tap a caption box on the timeline (or a row in the Caption-lines list) →
  // jump the playhead onto that spoken line and open the Karaoke inspector,
  // whose Caption-lines list is where the words are edited (list → editLine).
  // We turn captions on first so tapping a box can't be a dead click when the
  // preset is off — you can't edit words you can't see.
  const editCaptionLine = useCallback((i) => {
    const l = lines[i]
    if (!l) return
    if (caption.preset === 'off') setCaption('preset', 'karaoke')
    const mid = clamp((l.start + l.end) / 2, 0, durationSec)
    const v = videoRef.current
    if (v) { v.pause(); v.currentTime = startSec + mid }
    setCurrentTime(startSec + mid)
    setScrubT(mid)
    selectKey('caption')
  }, [lines, caption.preset, startSec, durationSec, selectKey, setCaption])
  const busy = exportMutation.isPending || wholeMutation.isPending || finalizeToPost.isPending || saveVideoToPiece.isPending
  const anyDest = dest.broll || dest.ad

  // Workspace caption-size multiplier — the bake applies it
  // (brandRenderVideo.js karaoke fontSizePx: × (subtitle_font_size ?? 10)/10),
  // so the on-canvas preview must too or a workspace that customized subtitle
  // size sees a caption that doesn't match the exported reel. Mirror of the
  // server factor; 1.0 for the default (10). See the client/server caption
  // mirror-pair note in CLAUDE.md.
  const captionSizeFactor = (asset?.workspace?.brand_style?.subtitle_font_size ?? 10) / 10

  const ctx = {
    videoRef, asset, editVideoUrl, editPoster, captionsBaked, captionSizeFactor, sel, selectKey, railMode, setRailMode, grade, setGradeKey, applyVibe, resetGrade,
    format, setFormat, formatCss: (FORMATS[format] || FORMATS.reel).css, formatDim: (FORMATS[format] || FORMATS.reel).dim,
    reframe, setReframe: setReframeKey, autoReframe, autoReframing, kenBurns, setKenBurns, speed, setSpeed, caption, setCaption, overlays, addOverlay, setOverlay,
    setOverlayTime, setOverlayWindow, delOverlay, curOverlay, dragOverlay, lines, words, editLine, editWord, logCaptionCorrection, resetCaptions, captionsEdited, cuts, toggleWordCut, addCuts, clearCuts, playClipT, displayClipT, scrubT, setScrubT, playing, togglePlay, seekClip,
    startSec, endSec, durationSec, videoDuration, setStartSec, setEndSec, dragging, snap, trimToLine, trimSnaps,
    setVideoDuration, setPlaying, handleTimeUpdate,
    genCaptions: () => genCaptionsMutation.mutate(), genCaptionsPending: genCaptionsMutation.isPending,
    brandGrade, saveBrandGrade: () => saveBrandMutation.mutate(), savingBrand: saveBrandMutation.isPending,
    openSaveTemplate,
    editCaptionLine,
    music, setMusic,
    alignGuidesOn, flashAlignGuides,
    proposals, selectedSegmentId, applySegment, discardSegment,
    findMoments: () => findMomentsMutation.mutate(), findingMoments: findMomentsMutation.isPending, segDetecting: segData?.status === 'detecting',
    // Post caption: prefer the live-refetched content item, fall back to the
    // prop so the field is editable immediately (embedded) before `post` loads.
    captionPiece: post || piece || null, updateItem,
    // Media swap (embedded reels): the piece to repoint, its current video
    // entry, and the swap handler that writes it back through the content PATCH.
    piece, pieceVideoEntry,
    swapVideo: (entry) => swapVideoMutation.mutate(entry),
    swapping: swapVideoMutation.isPending,
  }

  if (isLoading) return <div role="status" className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" /><span className="sr-only">Loading video…</span></div>
  if (error || !asset) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm font-medium text-destructive">Could not load this clip</p>
        <Button size="sm" variant="outline" onClick={goBack}>Back</Button>
      </div>
    )
  }

  // Where this clip publishes. Embedded from a content piece → the piece's
  // platform pill (so the editor and the Weekly card agree on the destination);
  // standalone (Moment Miner / Slate) there's no destination, so the shape badge
  // carries the header instead.
  const destMeta = piece?.platform ? PLATFORM_META[piece.platform] : null
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Shared top chrome (unified shell). Format switcher + transport + Export
          fold into the action slot; the side panel below is inspector-only. */}
      <EditorChrome
        onBack={goBack}
        title={asset.display_title || asset.filename || 'Clip'}
        destination={destMeta ? { icon: destMeta.icon, label: destMeta.label, colorClass: destMeta.color, bgClass: destMeta.bg, borderClass: destMeta.border } : null}
        badge={destMeta ? null : { icon: Film, label: (FORMATS[format] || FORMATS.reel).label, sub: (FORMATS[format] || FORMATS.reel).dim }}
      >
        {/* Transport */}
        <div className="flex items-center gap-2 rounded-lg border px-2 py-1 text-2xs" style={{ borderColor: 'hsl(var(--border))' }}>
          <button onClick={() => stepFrame(-1)} className="rounded p-0.5 hover:opacity-70 text-muted-foreground" aria-label="Previous frame" title="Previous frame (←)"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={togglePlay} className="rounded p-0.5 hover:opacity-70 text-primary" aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{playing ? 'Pause' : 'Play'} · Space</TooltipContent>
          </Tooltip>
          <button onClick={() => stepFrame(1)} className="rounded p-0.5 hover:opacity-70 text-muted-foreground" aria-label="Next frame" title="Next frame (→)"><ChevronRight className="h-3.5 w-3.5" /></button>
          <span className="font-mono tabular-nums" style={{ color: 'hsl(var(--muted-foreground))' }}>{fmt(displayClipT)} / {fmt(durationSec)}</span>
        </div>
        <UndoRedoButtons canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
        <SaveStatus status={saveStatus} />
        {/* Version history — auto-snapshots + restore */}
        <div className="relative">
          <button onClick={openHistory} className="flex items-center gap-1 rounded-lg border px-2 py-1 text-2xs" style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }} title="Version history" aria-label="Version history"><History className="h-3.5 w-3.5" /></button>
          {historyOpen && (
            <>
              <div className="fixed inset-0 z-30" aria-hidden="true" onClick={() => setHistoryOpen(false)} />
              <div role="menu" aria-label="Version history" className="absolute right-0 top-full z-40 mt-1 max-h-72 w-64 overflow-auto rounded-lg border bg-card p-1.5 shadow-lg" style={{ borderColor: 'hsl(var(--border))' }}>
                <p className="px-1 pb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Version history</p>
                {revisions.length === 0 ? (
                  <p className="px-1 py-2 text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>No saved versions yet — they appear as you edit.</p>
                ) : revisions.map((rv) => (
                  <button key={rv.id} onClick={() => { applyDoc(rv.doc); setHistoryOpen(false); toast('Restored a previous version') }} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-2xs hover:bg-muted">
                    <span>{new Date(rv.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    <span className="font-medium text-primary">Restore</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* Format — one clip, any shape. Drives the canvas aspect + render channel. */}
        <div className="flex gap-1" role="group" aria-label="Output format">
          {FORMAT_KEYS.map((k) => (
            <Tooltip key={k}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setFormat(k)}
                  className="flex flex-col items-center gap-0.5 rounded-md border px-2.5 py-1 text-3xs leading-tight"
                  style={segBtn(format === k)}
                >
                  <span className="font-medium">{FORMATS[k].label}</span>
                  <span style={{ opacity: 0.7 }}>{FORMATS[k].dim}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{`${FORMATS[k].label} · ${FORMATS[k].dim}`}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        {/* Approve + publish this clip inline. Before a post exists, one
            "Sounds like me" renders the clip → creates the post → approves it;
            then the shared workflow bar takes over with the publish controls,
            all without leaving the clip editor. */}
        {/* Embedded (Reel/long-video content piece): bake edits back to THIS
            post, then the shared workflow bar (bound to the existing piece)
            approves / schedules / publishes the edited video. */}
        {embedded ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  disabled={busy}
                  loading={saveVideoToPiece.isPending}
                  onClick={() => saveVideoToPiece.mutate()}
                >
                  {!saveVideoToPiece.isPending && <Check className="mr-1.5 h-3.5 w-3.5" />}
                  {saveVideoToPiece.isPending ? 'Rendering… ~1 min' : 'Save video'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Renders your edits and saves the finished clip to this post (about a minute)</TooltipContent>
            </Tooltip>
            {post && <EditorWorkflowBar piece={post} onBeforeCommit={bakeVideoIfDirty} renderingReel={saveVideoToPiece.isPending} />}
          </>
        ) : post ? (
          <EditorWorkflowBar piece={post} />
        ) : (
          <>
            {/* Deny — the other half of the verdict. Only meaningful on a clip
                that hasn't become a post yet (once a post exists the workflow
                bar owns Approve/Reject), and only when a proposal is actually
                selected, since the verdict lands on that segment. Red per the
                house rule: approve=green, reject=red, brand teal reads as
                navigation. */}
            {selectedSegmentId && (
              <Popover
                open={denyOpen}
                onOpenChange={(o) => { setDenyOpen(o); if (!o) { setDenyReasons([]); setDenyNote('') } }}
              >
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" disabled={busy} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                    <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />Deny
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 space-y-3">
                  <p className="text-sm font-semibold text-foreground">Why doesn&rsquo;t this clip work?</p>
                  <ClipDiscardReasons
                    reasons={denyReasons}
                    onToggleReason={(k) => setDenyReasons((rs) => (rs.includes(k) ? rs.filter((x) => x !== k) : [...rs, k]))}
                    note={denyNote}
                    onNoteChange={setDenyNote}
                  />
                  <Button
                    size="sm"
                    disabled={busy}
                    loading={denyClip.isPending}
                    onClick={() => denyClip.mutate()}
                    className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {!denyClip.isPending && <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />}
                    {denyClip.isPending ? 'Denying…' : 'Deny this clip'}
                  </Button>
                </PopoverContent>
              </Popover>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="success"
                  size="sm"
                  disabled={busy}
                  loading={finalizeToPost.isPending}
                  onClick={() => finalizeToPost.mutate()}
                >
                  {!finalizeToPost.isPending && <Check className="mr-1.5 h-3.5 w-3.5" />}
                  {finalizeToPost.isPending ? 'Rendering clip…' : 'Approve'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Renders this clip into a post and approves it — then publish right here</TooltipContent>
            </Tooltip>
          </>
        )}
        {/* Export — b-roll + ad sizes. Hidden when embedded: on the publish
            screen the destination is THIS post, not a new Library clip / an ad
            download / a navigate-away whole-video render. */}
        {!embedded && (
        <div className="relative">
          <Button size="sm" disabled={busy} onClick={() => setExportOpen((v) => !v)} className="justify-center" style={{ background: 'hsl(var(--action))', color: 'hsl(var(--action-foreground))' }}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Export this clip<ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-30" aria-hidden="true" onClick={() => setExportOpen(false)} />
              <div role="menu" aria-label="Export destination" className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border bg-card p-2 shadow-lg" style={{ borderColor: 'hsl(var(--border))' }}>
                <p className="px-1 pb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Send this clip to — pick any</p>
                {[
                  { k: 'broll', icon: FolderOpen, label: 'Save to Library', sub: 'Reusable b-roll clip' },
                  { k: 'ad', icon: Megaphone, label: 'Export for ads', sub: 'Download ad-sized versions' },
                ].map((o) => (
                  <label key={o.k} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                    <input type="checkbox" checked={dest[o.k]} onChange={() => toggleDest(o.k)} />
                    <o.icon className="h-4 w-4 shrink-0" style={{ color: 'hsl(var(--muted-foreground))' }} />
                    <span className="min-w-0"><span className="block text-xs font-medium">{o.label}</span><span className="block text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{o.sub}</span></span>
                  </label>
                ))}
                <Button size="sm" disabled={busy || !anyDest} onClick={() => exportMutation.mutate()} className="mt-1.5 w-full justify-center" style={{ background: 'hsl(var(--action))', color: 'hsl(var(--action-foreground))' }}>
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
        )}
      </EditorChrome>
      {/* Brief-origin hint — this clip was opened from a Media Hub edit brief.
          "Save to Library" is the action that closes the brief (marks it
          returned), so point the user at it. */}
      {briefId && (
        <div className="flex shrink-0 items-center gap-1.5 border-b bg-primary/5 px-4 py-1.5 text-2xs text-primary" style={{ borderColor: 'hsl(var(--border))' }}>
          <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Editing a Media Hub brief — <b>Save to Library</b> to mark it returned.</span>
        </div>
      )}
      {/* WORK AREA: rail | inspector | canvas on top, timeline spanning full width below */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <IconRail ctx={ctx} />
          <aside className="flex w-[272px] shrink-0 flex-col border-r bg-card" style={{ borderColor: 'hsl(var(--border))' }}>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {sel === 'postcaption' && <PostCaptionInspector ctx={ctx} />}
              {sel === 'moments' && <MomentsInspector ctx={ctx} />}
              {sel === 'clip' && <ClipInspector ctx={ctx} />}
              {sel === 'media' && <MediaInspector ctx={ctx} />}
              {sel === 'grade' && <GradeInspector ctx={ctx} />}
              {sel === 'caption' && <CaptionInspector ctx={ctx} />}
              {sel === 'music' && <MusicInspector ctx={ctx} />}
              {sel === 'transcript' && <TranscriptInspector ctx={ctx} />}
              {isOverlaySel(sel) && <OverlayInspector ctx={ctx} />}
            </div>
          </aside>
          <Canvas ctx={ctx} />
        </div>
        <HorizontalTimeline ctx={ctx} />
      </div>
      {adExportOpen && (
        <AdVideoExportModal
          clip={{ assetId, startSec, durationSec, captionText: captionSummary(), overlayPosition: caption.position, overlaySize: caption.size, title: asset?.display_title || asset?.filename }}
          onClose={() => setAdExportOpen(false)}
        />
      )}

      {tplOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={() => setTplOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Save as video template"
            className="relative w-full max-w-md rounded-xl border bg-card p-5 shadow-lg">
            <h2 className="text-base font-semibold">Save as video template</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              New video posts will be able to use this look. It saves the styling, not this clip&apos;s content.
            </p>

            <label className="mt-4 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="tpl-name">Name</label>
            <input id="tpl-name" value={tplName} onChange={(e) => setTplName(e.target.value)} maxLength={80}
              className="mt-1 w-full rounded-md border bg-background px-2.5 py-1.5 text-sm" />

            <div className="mt-4 space-y-1.5">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">What carries over</p>
              {tplDraft.captured.map((c) => (
                <p key={c} className="flex gap-1.5 text-xs text-foreground"><Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />{c}</p>
              ))}
            </div>
            <div className="mt-3 space-y-1.5">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Stays with this clip</p>
              {tplDraft.skipped.map((s) => (
                <p key={s} className="pl-4.5 text-xs text-muted-foreground">{s}</p>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button type="button" onClick={() => setTplOpen(false)} className="text-xs text-muted-foreground hover:underline">Cancel</button>
              <div className="flex gap-2">
                <button type="button" disabled={!tplName.trim() || saveTemplateMutation.isPending}
                  onClick={() => saveTemplateMutation.mutate({ name: tplName.trim(), makeDefault: false })}
                  className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-60">Save</button>
                <button type="button" disabled={!tplName.trim() || saveTemplateMutation.isPending}
                  onClick={() => saveTemplateMutation.mutate({ name: tplName.trim(), makeDefault: true })}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-60"
                  style={{ background: 'hsl(var(--primary))' }}>
                  {saveTemplateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save &amp; use for new reels
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
