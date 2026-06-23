import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Scissors, Loader2, AlertCircle, BarChart3, Film, ShieldAlert,
  ShieldCheck, PlayCircle, Search, Sparkles, Gem, Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useStaffSummaries } from '@/lib/queries'
import { apiFetch } from '@/lib/api'
import { listMedia } from '@/lib/mediaLib'
import { findClips, listMoments, updateSegment, renderSegments } from '@/lib/clipsLib'
import { toast } from '@/lib/toast'
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

function fmtClock(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0))
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
}

// The type chips shown above the feed (the broad, common kinds). The display
// label for each moment comes from the API (m.momentTypeLabel).
const MOMENT_FILTERS = [
  { key: 'all', label: 'All types' },
  { key: 'coaching_cue', label: 'Coaching cue' },
  { key: 'patient_breakthrough', label: 'Patient breakthrough' },
  { key: 'hook', label: 'Hook' },
  { key: 'credibility', label: 'Credibility' },
]

// One mined moment — the moment-first card the Ready-to-review feed ranks
// strongest-first by quotability score. Real footage + real audio; "Looks good"
// saves it as an approved clip into the Library (Storyboard & Ads pull from there).
function MomentCard({ moment, onReview, onSave, onDismiss, saving }) {
  const m = moment
  const dur = m.durationSec ? `${Math.round(m.durationSec)}s` : null
  return (
    <div className="bg-card border border-border rounded-xl p-3.5 flex gap-4 hover:border-primary/40 transition-colors">
      <div
        className="w-[78px] shrink-0 rounded-lg overflow-hidden bg-gradient-to-b from-slate-600 to-slate-800 relative grid place-items-center"
        style={{ aspectRatio: m.width && m.height ? `${m.width} / ${m.height}` : '9 / 16' }}
      >
        {m.thumbnailUrl
          ? <img src={m.thumbnailUrl} alt="" className="w-full h-full object-cover" />
          : <PlayCircle className="h-6 w-6 text-white/60" />}
        {dur && <span className="absolute bottom-1 right-1 bg-black/60 text-white text-3xs px-1 rounded">{dur}</span>}
      </div>
      <div className="min-w-0 flex-1">
        {/* Score leads as the visual hierarchy — editorial judgment is the
            product's moat, so the quotability rating is the largest element,
            not a small badge. Quote reads next; provenance (staff + source)
            gets its own non-truncating lines so it never collapses to nothing. */}
        <div className="min-w-0 flex-1">
          {m.why && (
            <p className="text-xs font-medium text-foreground/80 mb-1.5 flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />{m.why}
            </p>
          )}
          <div className="flex items-start gap-2">
            <p className="text-sm font-semibold leading-snug flex-1">&ldquo;{m.quote}&rdquo;</p>
            {m.score != null && (
              <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-2xs font-bold text-primary bg-primary/10" title="Quotability score">
                <Gem className="h-2.5 w-2.5" />{m.score}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="px-2 py-0.5 rounded-full text-3xs font-semibold bg-accent text-accent-foreground">{m.momentTypeLabel || 'Moment'}</span>
            {m.staffName && <span className="text-2xs font-medium text-foreground">{m.staffName}</span>}
          </div>
          <p className="text-3xs text-muted-foreground mt-0.5 truncate">
            {m.filename} · @ {fmtClock(m.startSec)}–{fmtClock(m.endSec)}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => onReview(m)}
            className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium flex items-center gap-1.5 hover:bg-primary/90"
          >
            <Scissors className="h-4 w-4" />Review &amp; trim
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave(m)}
            className="px-3 py-1.5 rounded-lg border border-primary text-primary text-sm font-medium hover:bg-primary/5 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Looks good — save
          </button>
          <button
            type="button"
            onClick={() => onDismiss(m)}
            className="px-2.5 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted ml-auto"
          >
            Not this one
          </button>
        </div>
      </div>
    </div>
  )
}

// The moment-first feed: staff filter + type chips + ranked MomentCards.
// Replaces the per-source-video review rows.
function MomentFeed({ loading, moments, totalCount, momentType, setMomentType, staffFilter, setStaffFilter, staffOptions, savingId, onReview, onSave, onDismiss, onSeeUncut }) {
  return (
    <div className="flex flex-col gap-3">
      {staffOptions.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Staff</span>
          <select
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            className="border border-border rounded-lg px-2.5 py-1.5 bg-card outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="all">All staff</option>
            {staffOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {MOMENT_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setMomentType(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              momentType === f.key ? 'border-primary bg-primary text-white' : 'border-border bg-card hover:bg-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
      ) : moments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center rounded-xl border-2 border-dashed border-border">
          <Sparkles className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">{totalCount === 0 ? 'No moments yet' : 'No moments match this filter'}</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            {totalCount === 0
              ? 'Run "Find moments" on uncut footage and the strongest moments land here, ranked.'
              : 'Try a different type or staff member.'}
          </p>
          {totalCount === 0 && <Button size="sm" variant="outline" onClick={onSeeUncut}>See uncut footage</Button>}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-2xs text-muted-foreground -mb-0.5">
            The best moments from your sessions — ranked strongest-first. Save the keepers to your Library.
          </p>
          {moments.map((m) => (
            <MomentCard
              key={m.id}
              moment={m}
              saving={savingId === m.id}
              onReview={onReview}
              onSave={onSave}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function VideoCard({ asset, staffName, onEdit, onFind }) {
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

        {/* Uncut footage: let the AI do the watching. Detection runs in the
            background; the source moves to "Ready to review" when it lands. */}
        {onFind && (proposals === null || proposals === 0) && (
          asset.segment_status === 'detecting' ? (
            <div className="w-full px-3 py-1.5 rounded-lg text-3xs text-muted-foreground flex items-center justify-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />finding moments…
            </div>
          ) : (
            <button
              type="button"
              onClick={() => ok && onFind(asset.id)}
              disabled={!ok}
              className="w-full px-3 py-1.5 rounded-lg text-3xs font-semibold text-primary bg-primary/10 hover:bg-primary/15 flex items-center justify-center gap-1 disabled:opacity-50 transition-colors"
            >
              <Sparkles className="h-3 w-3" />Find moments
            </button>
          )
        )}
      </div>
    </div>
  )
}

export default function MomentMiner() {
  useDocumentTitle('Moment Miner')
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
  // Mirror of "is any source video detecting", kept current by the effect below.
  // The secondary count queries read this ref (not the mediaData state) inside
  // their refetchInterval so they never poll on a stale closure after detection
  // finishes.
  const detectingRef = useRef(false)

  // Source videos (kind=video, not archived)
  const {
    data: mediaData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['slate-source-videos', searchQ],
    queryFn: () => listMedia({ kind: 'video', limit: 100, q: searchQ || undefined }),
    enabled: !!ws,
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
    enabled: !!ws,
    refetchInterval: () => {
      // The count map has no job-state of its own; gate on the source videos'
      // detection state (counts only change while detection or its follow-on
      // render is in flight) and hard-cap at 5 min. Read the ref, not mediaData,
      // to avoid a stale closure firing one extra poll after detection ends.
      if (!detectingRef.current) return false
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
    enabled: !!ws,
    refetchInterval: () => {
      // Same gating as clip counts: proposals appear when detection lands, so
      // poll only while a source video is detecting, capped at 5 min. Ref-read
      // avoids the stale-closure extra poll after detection ends.
      if (!detectingRef.current) return false
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
    detectingRef.current = isDetecting
    if (!isDetecting) pollStartRef.current = { at: 0 }
  }, [isDetecting])

  const sourceVideos = useMemo(() => {
    const assets = Array.isArray(mediaData) ? mediaData : []
    const counts = clipCounts?.counts || {}
    const proposals = proposalCounts?.counts || {}
    const samples = proposalCounts?.samples || {}
    return assets.map((a) => ({
      ...a,
      clip_count: counts[a.id] ?? null,
      proposal_count: proposals[a.id] ?? null,
      proposal_sample: samples[a.id] ?? null,
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

  // Review-first: Slate opens on the decisions the AI already prepared, not
  // the uncut backlog. Seed once when counts first arrive; never fight a tab
  // the user has clicked.
  const viewSeededRef = useRef(false)
  useEffect(() => {
    // Wait for BOTH the counts and the media list — seeding on counts alone
    // raced the source-video fetch, saw an empty review list, and burned the
    // one-shot without switching (seen on prod, 2026-06-09).
    if (viewSeededRef.current || !proposalCounts || isLoading) return
    viewSeededRef.current = true
    if (clipsToReviewVideos.length > 0) setView('clips_to_review')
  }, [proposalCounts, isLoading, clipsToReviewVideos.length])

  const queryClient = useQueryClient()
  const [momentType, setMomentType] = useState('all')
  const [staffFilter, setStaffFilter] = useState('all')
  const [savingId, setSavingId] = useState(null)

  // Moment Miner feed — flattened, ranked proposed moments across all sources.
  const { data: momentsData, isLoading: momentsLoading } = useQuery({
    queryKey: ['moments'],
    queryFn: listMoments,
    enabled: !!ws,
  })
  const allMoments = useMemo(() => momentsData?.moments || [], [momentsData])
  const staffOptions = useMemo(
    () => [...new Set(allMoments.map((m) => m.staffName).filter(Boolean))],
    [allMoments],
  )
  const moments = useMemo(() => {
    let list = allMoments
    if (momentType !== 'all') list = list.filter((m) => m.momentType === momentType)
    if (staffFilter !== 'all') list = list.filter((m) => m.staffName === staffFilter)
    return list
  }, [allMoments, momentType, staffFilter])

  async function handleFindMoments(id) {
    try {
      await findClips(id)
      toast('Finding moments — transcribing and scanning the source. It moves to "Ready to review" when done.')
      refetch()
    } catch (e) {
      toast.error(e?.message || 'Could not start detection.')
    }
  }

  function refreshMoments() {
    queryClient.invalidateQueries({ queryKey: ['moments'] })
    queryClient.invalidateQueries({ queryKey: ['slate-proposal-counts'] })
  }

  // "Looks good — save": keep the segment + render it into a Library clip.
  async function handleSaveMoment(m) {
    setSavingId(m.id)
    try {
      await updateSegment(m.id, 'kept')
      await renderSegments([m.id])
      toast('Saved to your Library — Storyboard & Ads can pull it.')
      refreshMoments()
    } catch (e) {
      toast.error(e?.message || 'Could not save this clip.')
    } finally {
      setSavingId(null)
    }
  }

  async function handleDismissMoment(m) {
    try {
      await updateSegment(m.id, 'discarded')
      toast('Dismissed.')
      refreshMoments()
    } catch (e) {
      toast.error(e?.message || 'Could not dismiss.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Page heading */}
      <div className="flex items-end gap-2 mt-1">
        <h1 className="text-2xl font-bold tracking-tight">Moment Miner</h1>
        <span className="text-muted-foreground text-sm mb-0.5">
          · mine your sessions for the best moments — saved as clips to your Library
        </span>
      </div>

      {/* Tabs + search row — review-first: the decisions tab leads, in the
          act-now amber so the eye lands where the AI finished its homework.
          On mobile: tabs scroll horizontally, search drops below. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 text-xs overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setView('clips_to_review')}
            className={`shrink-0 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1.5 ${
              view === 'clips_to_review'
                ? 'bg-action text-white border-action'
                : allMoments.length > 0
                  ? 'bg-card border-action/40 text-foreground hover:border-action'
                  : 'bg-card border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Ready to review{' '}
            {!momentsLoading && allMoments.length > 0 && (
              <span
                className={
                  view === 'clips_to_review'
                    ? 'opacity-80'
                    : 'inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-action text-action-foreground text-3xs font-bold'
                }
              >
                {allMoments.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setView('needs_cutting')}
            className={`shrink-0 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              view === 'needs_cutting'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            Uncut footage{' '}
            {!isLoading && (
              <span className="opacity-70">{needsCuttingVideos.length}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setView('in_progress')}
            className={`shrink-0 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              view === 'in_progress'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            Has clips{' '}
            {!isLoading && (
              <span className="opacity-70">{inProgressVideos.length}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setView('coverage')}
            className={`shrink-0 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1 ${
              view === 'coverage'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />Coverage
          </button>
        </div>

        {/* Search — right side on desktop, full-width below tabs on mobile */}
        {view !== 'coverage' && (
          <div className="relative sm:ml-auto">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              placeholder="Search videos…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-lg border border-border bg-card text-sm w-full sm:w-48 outline-none focus:ring-2 focus:ring-primary/30"
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
              {view === 'in_progress'
                ? 'No clips in progress'
                : view === 'clips_to_review'
                  ? 'Nothing waiting for review'
                  : 'No source videos yet'}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {view === 'in_progress'
                ? 'Cut a clip from a source video to see it here.'
                : view === 'clips_to_review'
                  ? 'Run "Find moments" on uncut footage and the AI-proposed clips land here for a keep/discard decision.'
                  : 'Upload videos via Capture or the Library. Once a video is in your library, it appears here for clipping.'}
            </p>
          </div>
          {view === 'clips_to_review' ? (
            <Button size="sm" variant="outline" onClick={() => setView('needs_cutting')}>
              See uncut footage
            </Button>
          ) : view !== 'in_progress' && (
            <Button size="sm" variant="outline" onClick={() => navigate('/library')}>
              Go to Library
            </Button>
          )}
        </div>
      ) : view === 'clips_to_review' ? (
        <MomentFeed
          loading={momentsLoading}
          moments={moments}
          totalCount={allMoments.length}
          momentType={momentType}
          setMomentType={setMomentType}
          staffFilter={staffFilter}
          setStaffFilter={setStaffFilter}
          staffOptions={staffOptions}
          savingId={savingId}
          onReview={(m) => navigate(`/moments/clip/${m.sourceAssetId}`)}
          onSave={handleSaveMoment}
          onDismiss={handleDismissMoment}
          onSeeUncut={() => setView('needs_cutting')}
        />
      ) : (
        <div className={`grid sm:grid-cols-2 lg:grid-cols-3 ${view === 'needs_cutting' ? 'xl:grid-cols-4' : ''} gap-3`}>
          {visibleVideos.map((asset) => (
            <VideoCard
              key={asset.id}
              asset={asset}
              staffName={staffMap[asset.staff_id]}
              onEdit={(id) => navigate(`/moments/clip/${id}`)}
              onFind={view === 'needs_cutting' ? handleFindMoments : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
