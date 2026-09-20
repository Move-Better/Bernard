import { ROLE_FS, clamp, fmt, isOverlaySel } from './constants'
import { CAPTION_BASE_FS_PCT, CAPTION_SIZE_SCALE, captionCss, normCaptionText } from './captions'
import { gradeToCanvasFilter } from '@/lib/gradeParams'
import { AlertCircle, Pause, Play } from 'lucide-react'
import { useMemo, useState } from 'react'

// ── CANVAS ───────────────────────────────────────────────────────────────────
export function Canvas({ ctx }) {
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
                // % mirror the bake's marginV (karaokeCaptions.js: top 0.10,
                // bottom 0.14 of frame height) so preview placement == publish.
                top: caption.position === 'top' ? '10%' : caption.position === 'center' ? '46%' : 'auto',
                bottom: caption.position === 'bottom' ? '14%' : 'auto',
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
