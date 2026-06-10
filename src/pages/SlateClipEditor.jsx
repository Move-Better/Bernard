import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Scissors, Loader2, AlertCircle, ShieldAlert, ShieldCheck, ArrowLeft,
  Play, Pause, Film, Sparkles, Wand2, Quote, SlidersHorizontal,
  ChevronDown, FileText, FolderOpen, Maximize, CornerDownLeft,
  ChevronRight, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useAppMutation } from '@/lib/useAppMutation'
import { apiFetch } from '@/lib/api'
import { getMediaAsset } from '@/lib/mediaLib'
import { getSegments, updateSegment } from '@/lib/clipsLib'
import { toast } from '@/lib/toast'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

// Default render channel for "As a post" — one clip per session in Phase 1.
const DEFAULT_CHANNEL = 'instagram_reel'

function formatTime(sec) {
  if (!isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function SlateClipEditor() {
  useDocumentTitle('Clip Editor · Slate')
  const { assetId } = useParams()
  const navigate = useNavigate()
  const ws = useWorkspace()
  const queryClient = useQueryClient()

  // --- Source asset ---
  const { data: asset, isLoading, error } = useQuery({
    queryKey: ['media-asset', assetId],
    queryFn: () => getMediaAsset(assetId),
    enabled: !!assetId,
    retry: 1,
  })

  // --- Auto-suggest: content_pieces for this asset ---
  const { data: suggestions, isFetching: suggestionsLoading } = useQuery({
    queryKey: ['content-pieces', assetId],
    queryFn: () => apiFetch(`/api/content-pieces/list?sourceId=${assetId}&limit=5`),
    enabled: !!assetId,
    staleTime: 60_000,
  })

  function applyTopSuggestion() {
    const top = suggestions?.[0]
    if (!top) {
      toast('No suggestions found for this clip.')
      return
    }
    if (top.ai_caption)        setCaptionText(top.ai_caption)
    if (top.source_trim_start != null) setStartSec(top.source_trim_start)
    if (top.source_trim_start != null && top.source_trim_end != null) {
      setEndSec(Math.min(top.source_trim_end, top.source_trim_start + 60))
    }
    setRenderedBlobUrl(null)
  }

  // --- Video playback ---
  const videoRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [videoDuration, setVideoDuration] = useState(0)

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (playing) { v.pause() } else { v.play() }
  }

  // --- Trim state ---
  // startSec and endSec are both direct positions in the source; the render
  // API receives durationSec = endSec - startSec (capped at 60s server-side).
  const [startSec, setStartSec] = useState(0)
  const [endSec, setEndSec] = useState(60)

  // When video metadata loads, snap the end handle to min(duration, 60s).
  useEffect(() => {
    if (videoDuration > 0) {
      setEndSec(Math.min(videoDuration, 60))
    }
  }, [videoDuration])

  // Derived duration — what gets sent to the render API.
  const durationSec = Math.max(1, endSec - startSec)

  // --- Caption text ---
  const [captionText, setCaptionText] = useState('')

  // --- Caption overlay controls (C2) ---
  const [overlayPosition, setOverlayPosition] = useState('bottom')
  const [overlaySize, setOverlaySize] = useState('medium')

  // --- Render state ---
  const [rendering, setRendering] = useState(false)
  const [renderedBlobUrl, setRenderedBlobUrl] = useState(null)
  const [renderDims, setRenderDims] = useState({ width: null, height: null, sizeBytes: null })

  // --- AI-proposed moments (video_segments from ClipFinder detection) ---
  // This is the seam fix: the Slate grid's "Review N clips" badge counts these
  // rows, so the editor must load and present them — window pre-set on the trim
  // sliders, hook as the caption, transcript excerpt shown. Before this, the
  // editor only knew the content_pieces briefs system and proposals never
  // rendered anywhere.
  const { data: segData } = useQuery({
    queryKey: ['video-segments', assetId],
    queryFn: () => getSegments(assetId),
    enabled: !!assetId,
    staleTime: 30_000,
  })
  const proposals = (segData?.segments || []).filter(
    (s) => s.status === 'proposed' || s.status === 'kept',
  )
  const [selectedSegmentId, setSelectedSegmentId] = useState(null)
  const selectedSegment = proposals.find((s) => s.id === selectedSegmentId) || null
  // Guards: auto-apply the first proposal exactly once, and never stomp trim
  // values the user already dragged by hand.
  const autoAppliedRef = useRef(false)
  const trimTouchedRef = useRef(false)

  function applySegment(seg) {
    setSelectedSegmentId(seg.id)
    const start = Math.max(0, Number(seg.start_sec) || 0)
    let end = Number(seg.end_sec) || start + 30
    end = Math.min(end, start + 60)
    if (videoDuration > 0) end = Math.min(end, videoDuration)
    if (end <= start) end = start + 1
    setStartSec(start)
    setEndSec(end)
    if (seg.hook) setCaptionText(seg.hook)
    setRenderedBlobUrl(null)
    if (videoRef.current) videoRef.current.currentTime = start
  }

  useEffect(() => {
    if (autoAppliedRef.current || trimTouchedRef.current) return
    if (videoDuration <= 0 || proposals.length === 0) return
    autoAppliedRef.current = true
    applySegment(proposals[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoDuration, proposals.length])

  const discardSegment = useAppMutation({
    mutationFn: (segmentId) => updateSegment(segmentId, 'discarded'),
    onSuccess: (_data, segmentId) => {
      if (selectedSegmentId === segmentId) setSelectedSegmentId(null)
      queryClient.invalidateQueries({ queryKey: ['video-segments', assetId] })
      toast('Moment discarded.')
    },
  })

  // Best-effort: a proposal the user actually shipped is reviewed — mark it
  // kept so the Slate "clips to review" badge drops. Never blocks the send.
  function markSelectedKept() {
    if (selectedSegment && selectedSegment.status === 'proposed') {
      updateSegment(selectedSegment.id, 'kept').catch(() => {})
    }
  }

  // --- Full preview overlay ---
  const [fullPreview, setFullPreview] = useState(false)

  // Close full preview on Escape
  useEffect(() => {
    function handler(e) {
      if (e.key === 'Escape') setFullPreview(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // --- "Adjust by hand" collapsed state ---
  const [adjustOpen, setAdjustOpen] = useState(false)

  // --- AI chat log (Phase 4 — real AI) ---
  const [chatLog, setChatLog] = useState([
    { role: 'assistant', text: 'I can help you tighten the caption or adjust the size. Ask me anything.' },
  ])
  const [chatInput, setChatInput] = useState('')
  const chatLogRef = useRef(null)
  const [chatLoading, setChatLoading] = useState(false)

  function appendChat(msg) {
    setChatLog((prev) => [...prev, msg])
    setTimeout(() => {
      if (chatLogRef.current) chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight
    }, 50)
  }

  async function fireChip(label) {
    if (chatLoading) return
    appendChat({ role: 'user', text: label })
    setChatLoading(true)
    try {
      const result = await apiFetch('/api/editorial/restyle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surface: 'clip',
          instruction: label,
          content: captionText,
          transcript: asset?.transcript_excerpt || '',
        }),
      })
      const ch = result?.changes || {}
      let applied = false
      if (ch.content) {
        setCaptionText(ch.content)
        setRenderedBlobUrl(null)
        applied = true
      }
      if (typeof ch.fontSizeStep === 'number') {
        setOverlaySize((prev) => {
          const sizes = ['small', 'medium', 'large']
          const idx = sizes.indexOf(prev)
          return sizes[Math.max(0, Math.min(sizes.length - 1, idx + ch.fontSizeStep))]
        })
        setRenderedBlobUrl(null) // invalidate the cached render so the new size re-bakes
        applied = true
      }
      if (applied) {
        appendChat({ role: 'assistant', text: result?.explanation || 'Done!' })
      } else {
        // Honesty: themes / colors / brightness don't apply to a video caption.
        // Don't claim a change we didn't make (was the "Brand book" no-op bug).
        appendChat({
          role: 'assistant',
          text: "On a clip I can tighten the caption wording or change its size — themes and colors don't apply to a video caption. Try 'punchier caption' or 'bigger text'.",
        })
      }
    } catch (e) {
      appendChat({ role: 'assistant', text: `Could not apply: ${e?.message || 'unknown error'}` })
    } finally {
      setChatLoading(false)
    }
  }

  async function submitChat() {
    const msg = chatInput.trim()
    if (!msg || chatLoading) return
    setChatInput('')
    await fireChip(msg)
  }

  async function renderClip() {
    setRendering(true)
    setRenderedBlobUrl(null)
    try {
      const result = await apiFetch('/api/editorial/render-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId,
          captionText,
          channels: [DEFAULT_CHANNEL],
          startSec,
          durationSec,
          subtitles: true,
          overlayPosition,
          overlaySize,
        }),
      })
      const render = result?.renders?.[0]
      if (!render?.blobUrl) {
        toast.error('Render returned no output. Check the server logs.')
        return null
      }
      setRenderedBlobUrl(render.blobUrl)
      setRenderDims({ width: render.width, height: render.height, sizeBytes: render.sizeBytes })
      return render
    } catch (e) {
      toast.error(e?.message || 'Render failed.')
      return null
    } finally {
      setRendering(false)
    }
  }

  // --- "As a post" mutation ---
  const asPostMutation = useAppMutation({
    mutationFn: async () => {
      let blobUrl = renderedBlobUrl
      if (!blobUrl) {
        const render = await renderClip()
        if (!render) throw new Error('Render failed — cannot create post.')
        blobUrl = render.blobUrl
      }
      return apiFetch('/api/editorial/clip-to-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, renderedBlobUrl: blobUrl, captionText, platform: 'instagram' }),
      })
    },
    onSuccess: (data) => {
      markSelectedKept()
      const id = data?.contentItemId
      if (id) {
        toast('Draft created — opening in Storyboard.')
        navigate(`/storyboard/${id}`)
      } else {
        toast.error('Post created but no ID returned.')
      }
    },
  })

  // --- "Library b-roll" mutation ---
  const brollMutation = useAppMutation({
    mutationFn: async () => {
      let blobUrl = renderedBlobUrl
      let dims = renderDims
      if (!blobUrl) {
        const render = await renderClip()
        if (!render) throw new Error('Render failed — cannot save b-roll.')
        blobUrl = render.blobUrl
        dims = { width: render.width || null, height: render.height || null, sizeBytes: render.sizeBytes || null }
      }
      return apiFetch('/api/editorial/clip-to-broll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId,
          renderedBlobUrl: blobUrl,
          width: dims.width,
          height: dims.height,
          sizeBytes: dims.sizeBytes,
          captionText,
        }),
      })
    },
    onSuccess: () => {
      markSelectedKept()
      toast('Saved to Library — the clip will appear in Suggested media shortly.')
      navigate('/slate')
    },
  })

  const busy = rendering || asPostMutation.isPending || brollMutation.isPending
  const consentBlocked = asset?.consent_status === 'pending' || asset?.consent_status === 'revoked'
  const ok = !consentBlocked

  if (!ws?.video_pipeline_enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Film className="h-10 w-10 text-muted-foreground" />
        <p className="font-semibold text-lg">Slate is not enabled for this workspace</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !asset) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-destructive font-medium">Could not load asset</p>
        <Button size="sm" variant="outline" onClick={() => navigate('/slate')}>Back to Slate</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb row */}
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => navigate('/slate')}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Slate
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium truncate">
          {proposals.length > 0 ? 'Review moments' : 'Cut a clip'} · {asset.display_title || asset.filename || 'Untitled video'}
        </span>
        {ok ? (
          <span className="ml-2 flex items-center gap-1 text-2xs px-2 py-1 rounded-full bg-success/15 text-success font-semibold">
            <ShieldCheck className="h-3.5 w-3.5" />consent ok
          </span>
        ) : (
          <span className="ml-2 flex items-center gap-1 text-2xs px-2 py-1 rounded-full bg-destructive/15 text-destructive font-semibold">
            <ShieldAlert className="h-3.5 w-3.5" />consent pending
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setFullPreview(true)
          }}
          className="ml-auto flex items-center gap-1.5 text-2xs px-2.5 py-1 rounded-lg border border-border hover:border-primary hover:text-primary transition-colors"
        >
          <Maximize className="h-3.5 w-3.5" />Full preview
        </button>
      </div>

      {/* Two-column main layout — clip is the hero on the left in a fixed-width
          column (no dead gutters); controls fill the rest of the row. */}
      <div className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">

        {/* LEFT: clip canvas hero + trim timeline */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">The clip</span>
            {videoDuration > 0 && (
              <span className="text-2xs text-muted-foreground">
                · {formatTime(durationSec)} of {formatTime(videoDuration)}
              </span>
            )}
          </div>

          {/* Clip canvas */}
          <div className="bg-card border border-border rounded-xl overflow-hidden max-w-[420px] mx-auto">
            <div className="aspect-[9/16] relative flex items-center justify-center bg-zinc-900">
              {asset.blob_url ? (
                <>
                  <video
                    ref={videoRef}
                    src={asset.blob_url}
                    poster={asset.thumbnail_url || undefined}
                    className="w-full h-full object-contain"
                    onLoadedMetadata={(e) => setVideoDuration(e.target.duration)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                    playsInline
                  />
                  {/* Caption band preview — WYSIWYG */}
                  {captionText ? (
                    <div
                      className={`absolute left-0 right-0 pointer-events-none px-4 text-center ${
                        overlayPosition === 'top'    ? 'top-3' :
                        overlayPosition === 'center' ? 'top-1/2 -translate-y-1/2' :
                        'bottom-12'
                      }`}
                    >
                      <span className={`inline bg-black/45 text-white font-semibold px-2 py-1 rounded leading-relaxed ${
                        overlaySize === 'small'  ? 'text-xs' :
                        overlaySize === 'large'  ? 'text-lg' :
                        'text-base'
                      }`}>
                        {captionText}
                      </span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="absolute inset-0 flex items-center justify-center group"
                    aria-label={playing ? 'Pause' : 'Play'}
                  >
                    <div className={`h-14 w-14 rounded-full bg-white/15 backdrop-blur flex items-center justify-center text-white transition-opacity hover:bg-white/25 ${playing ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                      {playing ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7" />}
                    </div>
                  </button>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  No video URL
                </div>
              )}
              <span className="absolute top-3 left-3 text-3xs text-white/70 bg-black/30 rounded px-1.5 py-0.5">
                9:16 · captions burned
              </span>
            </div>

            {/* Trim timeline */}
            <div className="p-3 border-t border-border">
              <p className="text-3xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">Trim</p>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-3">
                  <label className="text-2xs text-muted-foreground w-10 shrink-0">Start</label>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, endSec - 1)}
                    step={0.5}
                    value={startSec}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      trimTouchedRef.current = true
                      setStartSec(v)
                      // Push end forward if start would cross it, keeping min 1s clip.
                      if (v >= endSec) setEndSec(Math.min(v + 1, videoDuration || v + 1))
                      if (videoRef.current) videoRef.current.currentTime = v
                    }}
                    className="flex-1 accent-primary"
                    disabled={videoDuration === 0}
                  />
                  <span className="text-3xs font-mono w-10 text-right text-muted-foreground">{formatTime(startSec)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-2xs text-muted-foreground w-10 shrink-0">End</label>
                  <input
                    type="range"
                    min={Math.min(startSec + 1, videoDuration || startSec + 1)}
                    max={Math.min(startSec + 60, videoDuration || startSec + 60)}
                    step={0.5}
                    value={endSec}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      trimTouchedRef.current = true
                      setEndSec(v)
                      if (videoRef.current) videoRef.current.currentTime = v
                    }}
                    className="flex-1 accent-primary"
                    disabled={videoDuration === 0}
                  />
                  <span className="text-3xs font-mono w-10 text-right text-muted-foreground">{formatTime(endSec)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-3xs text-muted-foreground mt-1.5">
                <span>{formatTime(startSec)}</span>
                <span className="text-primary font-medium">clip {formatTime(durationSec)}</span>
                {/* "1:00 / 0:00" read as a bug before metadata loads — show a
                    dash until the real source duration is known. */}
                <span>{formatTime(endSec)} / {videoDuration > 0 ? formatTime(videoDuration) : '—'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: proposals + transcript + polish + adjust + outputs */}
        <div className="flex min-w-0 flex-col gap-3">

          {/* Proposed moments — the AI's picks from ClipFinder detection. The
              "Review N clips" promise on the Slate grid pays off here. */}
          {(proposals.length > 0 || segData?.status === 'detecting') && (
            <div className="bg-card border border-primary/40 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-sm font-semibold">Proposed moments</span>
                {proposals.length > 0 && (
                  <span className="text-2xs text-muted-foreground">· {proposals.length}</span>
                )}
                {segData?.status === 'detecting' && (
                  <span className="ml-auto flex items-center gap-1 text-2xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />finding moments…
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {proposals.map((seg) => {
                  const isSel = seg.id === selectedSegmentId
                  const segLen = Math.max(0, (Number(seg.end_sec) || 0) - (Number(seg.start_sec) || 0))
                  return (
                    <div
                      key={seg.id}
                      className={`rounded-lg border p-2.5 transition-colors ${
                        isSel ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => applySegment(seg)}
                        className="w-full text-left"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-semibold leading-snug">
                            {seg.hook ? `“${seg.hook}”` : 'Untitled moment'}
                          </span>
                          <span className="text-3xs font-mono text-muted-foreground shrink-0 mt-0.5">
                            {formatTime(segLen)} · at {formatTime(Number(seg.start_sec) || 0)}
                          </span>
                        </div>
                        {seg.why_it_stands_alone && (
                          <p className="text-3xs text-muted-foreground leading-snug mt-1">
                            <span className="font-semibold text-foreground/60">Why:</span> {seg.why_it_stands_alone}
                          </p>
                        )}
                      </button>
                      <div className="flex items-center gap-2 mt-1.5">
                        {isSel ? (
                          <span className="text-3xs text-primary font-semibold">Loaded on the timeline — adjust or send below</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => applySegment(seg)}
                            className="text-3xs text-primary font-semibold hover:underline"
                          >
                            Load this moment
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={discardSegment.isPending}
                          onClick={() => discardSegment.mutate(seg.id)}
                          className="ml-auto flex items-center gap-0.5 text-3xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                        >
                          <X className="h-3 w-3" />discard
                        </button>
                      </div>
                    </div>
                  )
                })}
                {proposals.length === 0 && segData?.status === 'detecting' && (
                  <p className="text-2xs text-muted-foreground italic">
                    Transcribing the source and looking for standalone moments — this keeps running if you leave.
                  </p>
                )}
              </div>
              <p className="text-3xs text-muted-foreground mt-2">
                The AI window is a starting point, not a cage — drag the trim sliders to adjust.
              </p>
            </div>
          )}

          {/* What he actually said */}
          <div className="bg-card border border-border rounded-xl p-3">
            <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Quote className="h-3.5 w-3.5" />
              What{asset.staff_name ? ` ${asset.staff_name}` : ''} actually said (this clip)
            </div>
            <p className="text-xs text-foreground/80 leading-snug">
              {selectedSegment?.transcript_excerpt
                ? selectedSegment.transcript_excerpt
                : asset.transcript_excerpt
                  ? asset.transcript_excerpt
                  : <span className="italic text-muted-foreground">Transcript excerpt will appear here once the clip is trimmed.</span>
              }
            </p>
          </div>

          {/* Polish this clip — AI conversation */}
          <div className="bg-card border border-primary/40 rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 bg-primary/5 border-b border-border flex items-center gap-2 shrink-0">
              <Wand2 className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Polish this clip</span>
              <span className="text-2xs text-muted-foreground">· just ask</span>
              {(suggestionsLoading || chatLoading) && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
              )}
            </div>

            {/* Chat log */}
            <div
              ref={chatLogRef}
              className="px-4 py-3 space-y-2 text-xs max-h-[200px] min-h-[64px] overflow-y-auto"
            >
              {chatLog.map((msg, i) => (
                msg.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="bg-primary text-primary-foreground rounded-xl px-2.5 py-1.5 max-w-[80%] text-xs">
                      {msg.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex gap-2">
                    <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="h-3 w-3 text-primary" />
                    </div>
                    <div className="text-muted-foreground leading-snug">{msg.text}</div>
                  </div>
                )
              ))}
            </div>

            {/* Suggestion chips */}
            <div className="px-3 pb-3 shrink-0">
              <div className="flex flex-wrap gap-1.5 mb-2 text-2xs">
                <button
                  type="button"
                  disabled={chatLoading}
                  onClick={() => applyTopSuggestion()}
                  className="px-2 py-1 rounded-full border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Find the best moment
                </button>
                <button
                  type="button"
                  disabled={chatLoading}
                  onClick={() => fireChip('Punchier caption')}
                  className="px-2 py-1 rounded-full border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Punchier caption
                </button>
                <button
                  type="button"
                  disabled={chatLoading}
                  onClick={() => fireChip('Bigger caption')}
                  className="px-2 py-1 rounded-full border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Bigger caption
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitChat() }}
                  placeholder="e.g. 'punchier caption' or 'bigger text'…"
                  className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-xs outline-none focus:ring-2 focus:ring-primary/30"
                  disabled={chatLoading}
                />
                <button
                  type="button"
                  disabled={chatLoading || !chatInput.trim()}
                  onClick={submitChat}
                  className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CornerDownLeft className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Adjust by hand — collapsible */}
          <div className="bg-card border border-border rounded-xl">
            <button
              type="button"
              onClick={() => setAdjustOpen((v) => !v)}
              className="w-full px-4 py-2.5 flex items-center gap-2 text-left"
            >
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Adjust by hand</span>
              <span className="text-2xs text-muted-foreground">· same knobs the AI turns</span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground ml-auto transition-transform ${adjustOpen ? 'rotate-180' : ''}`} />
            </button>

            {adjustOpen && (
              <div className="px-4 pb-3 pt-3 border-t border-border space-y-2.5 text-xs">
                {/* In / Out */}
                <div className="flex items-center gap-2">
                  <span className="w-14 text-muted-foreground text-2xs">In / Out</span>
                  <input
                    type="text"
                    value={formatTime(startSec)}
                    readOnly
                    className="w-16 px-2 py-1 rounded-lg border border-border bg-background text-center text-xs"
                  />
                  <span className="text-muted-foreground">→</span>
                  <input
                    type="text"
                    value={formatTime(endSec)}
                    readOnly
                    className="w-16 px-2 py-1 rounded-lg border border-border bg-background text-center text-xs"
                  />
                  <span className="text-2xs text-muted-foreground">({formatTime(durationSec)})</span>
                </div>

                {/* Caption text */}
                <div>
                  <label className="text-3xs uppercase tracking-wide text-muted-foreground font-semibold">Caption text</label>
                  <textarea
                    value={captionText}
                    onChange={(e) => {
                      setCaptionText(e.target.value)
                      setRenderedBlobUrl(null)
                    }}
                    rows={2}
                    maxLength={500}
                    placeholder="Text overlaid on the clip…"
                    className="mt-1 w-full resize-none outline-none text-sm leading-snug bg-background border border-border rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                {/* Position + size controls (C2 — from PR #1142) */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs text-muted-foreground w-14 shrink-0">Position</span>
                    <div className="flex gap-1">
                      {[
                        { value: 'top',    label: 'Top' },
                        { value: 'center', label: 'Center' },
                        { value: 'bottom', label: 'Bottom' },
                      ].map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => { setOverlayPosition(value); setRenderedBlobUrl(null) }}
                          className={`text-2xs px-2.5 py-1 rounded-md font-medium border transition-colors ${
                            overlayPosition === value
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border text-muted-foreground hover:border-primary/40'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xs text-muted-foreground w-14 shrink-0">Size</span>
                    <div className="flex gap-1">
                      {[
                        { value: 'small',  label: 'Small' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'large',  label: 'Large' },
                      ].map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => { setOverlaySize(value); setRenderedBlobUrl(null) }}
                          className={`text-2xs px-2.5 py-1 rounded-md font-medium border transition-colors ${
                            overlaySize === value
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border text-muted-foreground hover:border-primary/40'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Send this clip to… */}
          <div className="bg-card border border-border rounded-xl p-3">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Send this clip to…</p>

            {consentBlocked && (
              <div className="flex items-center gap-1.5 text-2xs text-destructive mb-2">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                Resolve consent before sending this clip anywhere.
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => !busy && !consentBlocked && asPostMutation.mutate()}
                disabled={busy || consentBlocked}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  consentBlocked
                    ? 'border-border opacity-45 cursor-not-allowed'
                    : 'border-primary bg-primary/5 hover:bg-primary/10'
                }`}
              >
                {asPostMutation.isPending || (rendering && !brollMutation.isPending) ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <FileText className="h-4 w-4 text-primary" />
                )}
                <div className="text-xs font-semibold mt-1">As a post</div>
                <div className="text-3xs text-muted-foreground">→ Storyboard draft, ready to schedule</div>
              </button>

              <button
                type="button"
                onClick={() => !busy && !consentBlocked && brollMutation.mutate()}
                disabled={busy || consentBlocked}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  consentBlocked
                    ? 'border-border opacity-45 cursor-not-allowed'
                    : 'border-border hover:border-primary'
                }`}
              >
                {brollMutation.isPending || (rendering && !asPostMutation.isPending) ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                )}
                <div className="text-xs font-semibold mt-1">As b-roll</div>
                <div className="text-3xs text-muted-foreground">→ Library, reusable in other posts</div>
              </button>
            </div>

            <p className="text-3xs text-muted-foreground mt-2">
              Slate never publishes. It hands off to the one pipeline — exactly two ways out.
            </p>
          </div>
        </div>
      </div>

      {/* Edge-to-edge full preview overlay */}
      {fullPreview && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
          <button
            type="button"
            onClick={() => setFullPreview(false)}
            className="absolute top-4 right-5 h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            aria-label="Close full preview"
          >
            <Scissors className="h-5 w-5 rotate-45" />
          </button>
          <div
            className="relative flex items-center justify-center rounded-2xl overflow-hidden bg-zinc-900"
            style={{ height: '86vh', aspectRatio: '9/16' }}
          >
            {asset.blob_url ? (
              <video
                src={asset.blob_url}
                className="w-full h-full object-contain"
                autoPlay
                playsInline
                controls
              />
            ) : (
              <div className="flex items-center justify-center h-full text-white/50">No video</div>
            )}
            {captionText && (
              <div className="absolute left-0 right-0 bottom-16 px-6 text-center pointer-events-none">
                <span className="inline bg-black/45 text-white font-semibold px-3 py-1.5 rounded text-2xl leading-relaxed">
                  {captionText}
                </span>
              </div>
            )}
            <span className="absolute top-4 left-4 text-2xs text-white/70 bg-black/30 rounded px-2 py-1">
              9:16 · {formatTime(durationSec)} · captions burned
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
