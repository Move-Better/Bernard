import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Scissors, Loader2, AlertCircle, BarChart3, Film, ShieldAlert,
  ShieldCheck, PlayCircle, Search, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useStaffSummaries } from '@/lib/queries'
import { apiFetch } from '@/lib/api'
import { listMedia } from '@/lib/mediaLib'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import CoveragePanel from '@/components/slate/CoveragePanel'

const REFETCH_INTERVAL_MS = 30_000
// Hard cap on every Slate poll loop. Detection of a long seminar can run for
// minutes (see api/_lib/segmentDetect.js), so the ceiling sits well above a
// single job; its job is to stop a row stuck in 'detecting' from polling
// forever once the tab is left open.
const POLL_CEILING_MS = 5 * 60_000

// True when any source video is mid-detection. This is the only background
// job-state the Slate page can observe — auto-detect flips segment_status
// null → 'detecting' → 'ready' | 'failed'. The proposal/clip count maps carry
// no state of their own, but they only change while a detection (or its
// follow-on render) is in flight, so all three poll loops gate on this.
function anyDetecting(assets) {
  return Array.isArray(assets) && assets.some((a) => a?.segment_status === 'detecting')
}

function clipCount(asset) {
  return typeof asset.clip_count === 'number' ? asset.clip_count : null
}

function consentOk(asset) {
  const s = asset?.consent_status
  return s !== 'pending' && s !== 'revoked'
}

// Display-only label for a source video. Prefers a real human title when the
// asset carries one (linked interview topic / caption); otherwise prettifies
// the raw upload filename (drop extension, normalize separators) so the grid
// doesn't read as a list of camera-roll filenames. Never fabricates — a bare
// "Capture 2026-06-02" stays as-is, just cleaned up.
function videoLabel(asset) {
  const real = asset?.display_title || asset?.title || asset?.topic || asset?.caption
  if (real && real.trim()) return real.trim()
  const name = asset?.filename
  if (!name || !name.trim()) return 'Untitled video'
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, '')   // drop extension
    .replace(/[_-]+/g, ' ')              // separators → spaces
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled video'
}

function VideoCard({ asset, staffName, onEdit }) {
  const ok = consentOk(asset)
  const clips = clipCount(asset)
  const proposals = typeof asset.proposal_count === 'number' ? asset.proposal_count : null
  const thumbUrl = asset.thumbnail_url || null
  const durationLabel = asset.duration_s
    ? (() => {
        const m = Math.floor(asset.duration_s / 60)
        const s = Math.floor(asset.duration_s % 60)
        return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `0:${s.toString().padStart(2, '0')}`
      })()
    : null

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col hover:border-primary/40 hover:-translate-y-px transition-all">
      {/* Thumbnail — sized to the video's native aspect ratio (like the
          Library grid) so portrait clips aren't cropped/zoomed into 16:9.
          Falls back to aspect-video only when dimensions are unknown. */}
      <div
        style={asset.width && asset.height
          ? { aspectRatio: `${asset.width} / ${asset.height}` }
          : undefined}
        className={`bg-muted relative overflow-hidden flex items-center justify-center ${
          asset.width && asset.height ? '' : 'aspect-video'
        }`}
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <PlayCircle className="h-9 w-9 text-muted-foreground/40" />
        )}
        {durationLabel && (
          <span className="absolute bottom-1.5 right-1.5 text-3xs text-white/85 bg-black/40 rounded px-1.5 py-0.5">
            {durationLabel}
          </span>
        )}
        {proposals !== null && proposals > 0 && (
          <span className="absolute top-1.5 left-1.5 text-3xs bg-primary text-primary-foreground rounded px-1.5 py-0.5 font-medium flex items-center gap-1">
            <Sparkles className="h-2.5 w-2.5" />{proposals} clip{proposals !== 1 ? 's' : ''} proposed
          </span>
        )}
        {(proposals === null || proposals === 0) && clips !== null && clips > 0 && (
          <span className="absolute top-1.5 left-1.5 text-3xs bg-white/90 text-foreground rounded px-1.5 py-0.5 font-medium">
            {clips} clip{clips !== 1 ? 's' : ''} cut
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <p className="text-sm font-medium leading-snug line-clamp-2 min-h-[2.5rem]">
          {videoLabel(asset)}
        </p>
        <div className="flex items-center gap-2 text-2xs text-muted-foreground">
          {staffName && <span>{staffName}</span>}
          {ok ? (
            <span className="ml-auto flex items-center gap-1 text-success">
              <ShieldCheck className="h-3 w-3" />consent ok
            </span>
          ) : (
            <span className="ml-auto flex items-center gap-1 text-destructive">
              <ShieldAlert className="h-3 w-3" />consent pending
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => ok && onEdit(asset.id)}
          disabled={!ok}
          className={`mt-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
            ok
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          }`}
          title={!ok ? 'Resolve consent before cutting clips' : undefined}
        >
          {proposals !== null && proposals > 0
            ? <><Sparkles className="h-3.5 w-3.5" />Review {proposals} clip{proposals !== 1 ? 's' : ''}</>
            : <><Scissors className="h-3.5 w-3.5" />Cut a clip</>
          }
        </button>
      </div>
    </div>
  )
}

export default function Slate() {
  useDocumentTitle('Slate')
  const ws = useWorkspace()
  const navigate = useNavigate()

  const { data: staff = [] } = useStaffSummaries()
  const staffMap = useMemo(
    () => Object.fromEntries(staff.map((c) => [c.id, c.name])),
    [staff]
  )

  const [view, setView] = useState('needs_cutting')  // 'needs_cutting' | 'clips_to_review' | 'in_progress' | 'coverage'
  const [searchQ, setSearchQ] = useState('')

  // Track when the current poll window started, so the refetch loops below can
  // hard-cap even if a detection job silently stalls in 'detecting'. The window
  // start is set LAZILY the first time detection is observed (inside
  // refetchInterval), not at mount — anchoring at mount means a page left idle
  // past POLL_CEILING_MS before detection starts would see the cap already
  // exceeded and never poll. Reset to 0 when detection ends (effect below) so a
  // future detection restarts the window. Matches the Book/ClipFinder pattern.
  const pollStartRef = useRef({ at: 0 })

  // Source videos (kind=video, not archived)
  const {
    data: mediaData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['slate-source-videos', searchQ],
    queryFn: () => listMedia({ kind: 'video', limit: 100, q: searchQ || undefined }),
    enabled: ws?.video_pipeline_enabled === true,
    refetchInterval: (q) => {
      // Only poll while a source video is mid-detection; hard-cap at 5 min so a
      // stuck 'detecting' row can't poll for the life of the tab.
      if (!anyDetecting(q.state.data)) return false
      if (!pollStartRef.current.at) pollStartRef.current.at = Date.now()
      if (Date.now() - pollStartRef.current.at > POLL_CEILING_MS) return false
      return REFETCH_INTERVAL_MS
    },
    refetchOnWindowFocus: false,
  })

  // Clip counts per source asset (rendered clips already cut from this source)
  const { data: clipCounts } = useQuery({
    queryKey: ['slate-clip-counts'],
    queryFn: () => apiFetch('/api/editorial/clip-counts'),
    enabled: ws?.video_pipeline_enabled === true,
    refetchInterval: () => {
      // The count map has no job-state of its own; gate on the source videos'
      // detection state (counts only change while detection or its follow-on
      // render is in flight) and hard-cap at 5 min.
      if (!anyDetecting(mediaData)) return false
      if (!pollStartRef.current.at) pollStartRef.current.at = Date.now()
      if (Date.now() - pollStartRef.current.at > POLL_CEILING_MS) return false
      return 60_000
    },
    refetchOnWindowFocus: false,
  })

  // Unreviewed proposal counts per source asset (video_segments status='proposed')
  const { data: proposalCounts } = useQuery({
    queryKey: ['slate-proposal-counts'],
    queryFn: () => apiFetch('/api/editorial/proposal-counts'),
    enabled: ws?.video_pipeline_enabled === true,
    refetchInterval: () => {
      // Same gating as clip counts: proposals appear when detection lands, so
      // poll only while a source video is detecting, capped at 5 min.
      if (!anyDetecting(mediaData)) return false
      if (!pollStartRef.current.at) pollStartRef.current.at = Date.now()
      if (Date.now() - pollStartRef.current.at > POLL_CEILING_MS) return false
      return 60_000
    },
    refetchOnWindowFocus: false,
  })

  // Reset the poll-cap window when detection ends, so the next detection lazily
  // restarts a fresh window (set inside refetchInterval the moment it's seen).
  const isDetecting = anyDetecting(mediaData)
  useEffect(() => {
    if (!isDetecting) pollStartRef.current = { at: 0 }
  }, [isDetecting])

  const sourceVideos = useMemo(() => {
    const assets = Array.isArray(mediaData) ? mediaData : []
    const counts = clipCounts?.counts || {}
    const proposals = proposalCounts?.counts || {}
    return assets.map((a) => ({
      ...a,
      clip_count: counts[a.id] ?? null,
      proposal_count: proposals[a.id] ?? null,
    }))
  }, [mediaData, clipCounts, proposalCounts])

  const needsCuttingVideos = useMemo(
    () => sourceVideos.filter((a) => !a.clip_count && !a.proposal_count),
    [sourceVideos]
  )
  // Videos that have AI-proposed clips waiting for keep/discard review.
  const clipsToReviewVideos = useMemo(
    () => sourceVideos.filter((a) => !!a.proposal_count),
    [sourceVideos]
  )
  const inProgressVideos = useMemo(
    () => sourceVideos.filter((a) => !!a.clip_count),
    [sourceVideos]
  )

  const visibleVideos = useMemo(() => {
    if (view === 'in_progress') return inProgressVideos
    if (view === 'clips_to_review') return clipsToReviewVideos
    return needsCuttingVideos
  }, [view, needsCuttingVideos, clipsToReviewVideos, inProgressVideos])

  if (!ws?.video_pipeline_enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Scissors className="h-10 w-10 text-muted-foreground" />
        <p className="font-semibold text-lg">Slate is coming soon</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          {"The video pipeline isn't enabled for this workspace yet."}
        </p>
        <a
          href="/settings/workspace"
          className="text-sm text-primary underline underline-offset-2 hover:opacity-80"
        >
          Open workspace settings to enable it
        </a>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Page heading */}
      <div className="flex items-end gap-2 mt-1">
        <h1 className="text-xl font-semibold">Slate</h1>
        <span className="text-muted-foreground text-sm mb-0.5">
          · turn raw video into clips — each becomes a post or reusable b-roll
        </span>
      </div>

      {/* Tabs + search row */}
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setView('needs_cutting')}
          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
            view === 'needs_cutting'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-card border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          Needs cutting{' '}
          {!isLoading && (
            <span className="opacity-70">{needsCuttingVideos.length}</span>
          )}
        </button>
        {clipsToReviewVideos.length > 0 && (
          <button
            type="button"
            onClick={() => setView('clips_to_review')}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1.5 ${
              view === 'clips_to_review'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Clips to review{' '}
            <span className="opacity-70">{clipsToReviewVideos.length}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setView('in_progress')}
          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
            view === 'in_progress'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-card border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          In progress{' '}
          {!isLoading && (
            <span className="opacity-70">{inProgressVideos.length}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setView('coverage')}
          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1 ${
            view === 'coverage'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-card border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />Coverage
        </button>

        {/* Search — right side */}
        {view !== 'coverage' && (
          <div className="ml-auto relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              placeholder="Search videos…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-lg border border-border bg-card text-sm w-48 outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        )}
      </div>

      {/* Content area */}
      {view === 'coverage' ? (
        <CoveragePanel />
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-destructive font-medium">Failed to load videos</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      ) : visibleVideos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center rounded-xl border-2 border-dashed border-border">
          <Film className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-semibold text-base">
              {view === 'in_progress' ? 'No clips in progress' : 'No source videos yet'}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {view === 'in_progress'
                ? 'Cut a clip from a source video to see it here.'
                : 'Upload videos via Capture or the Library. Once a video is in your library, it appears here for clipping.'}
            </p>
          </div>
          {view !== 'in_progress' && (
            <Button size="sm" variant="outline" onClick={() => navigate('/library')}>
              Go to Library
            </Button>
          )}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleVideos.map((asset) => (
            <VideoCard
              key={asset.id}
              asset={asset}
              staffName={staffMap[asset.staff_id]}
              onEdit={(id) => navigate(`/slate/clip/${id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
