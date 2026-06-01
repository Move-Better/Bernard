import { Play, Image as ImageIcon, Check, Plus, Loader2, Maximize2, Video, Scissors } from 'lucide-react'
import { Button } from '@/components/ui/button'

function topTags(aiTags, n = 5) {
  if (!Array.isArray(aiTags)) return []
  return aiTags
    .map((t) => (typeof t === 'string' ? t : t?.tag || t?.label || ''))
    .filter(Boolean)
    .slice(0, n)
}

// m:ss for a clip length in seconds; null when unknown so the badge falls back
// to a plain "Video" label rather than showing a bogus "0:00".
function fmtDuration(s) {
  const n = Math.round(Number(s))
  if (!Number.isFinite(n) || n <= 0) return null
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
}

/**
 * CandidateCard — one ranked media candidate, sized for real evaluation: a
 * large thumbnail you can actually read, click-to-open full-size preview
 * (with video playback), and a one-click Attach. The big-card replacement for
 * the cramped 128px in-editor suggestion strip.
 *
 * Props:
 *   clip      — a suggest-media result ({ assetId, kind, blobUrl, thumbnailUrl,
 *               similarity, aiTags, durationS, chunkId, filename }). A precut
 *               segment also carries { isSegment, startSec, endSec, segmentHook }.
 *   attached  — already on the draft (button shows "Attached")
 *   attaching — this card's attach is in flight
 *   onPreview — open the full-size preview dialog
 *   onAttach  — attach this candidate to the draft
 */
export default function CandidateCard({ clip, attached, attaching, onPreview, onAttach }) {
  const isVideo = clip.kind === 'video'
  const isSegment = !!clip.isSegment
  const thumb = clip.thumbnailUrl || (!isVideo ? clip.blobUrl : null)
  const pct = Math.round((clip.similarity || 0) * 100)
  const tags = topTags(clip.aiTags)
  // A precut clip's own length (end-start); falls back to the source duration.
  const segLen = isSegment
    ? fmtDuration((Number(clip.endSec) || 0) - (Number(clip.startSec) || 0))
    : null

  return (
    <div className="group overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={onPreview}
        className="relative block aspect-[4/3] w-full bg-muted"
        title="Open full-size preview"
        aria-label="Open full-size preview"
      >
        {thumb ? (
          <img src={thumb} alt={clip.filename || ''} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            {isVideo ? <Play className="h-8 w-8" /> : <ImageIcon className="h-8 w-8" />}
          </div>
        )}
        {isVideo && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-black/55 p-3 transition-transform group-hover:scale-110">
              <Play className="h-6 w-6 text-white" fill="white" />
            </div>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-2xs font-semibold text-white">
          {pct}% match
        </span>
        {/* Precut-clip marker — a primary pill so a short, ready-to-post cut
            reads apart from the full source video at a glance. */}
        {isSegment && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-3xs font-semibold text-primary-foreground shadow group-hover:opacity-0">
            <Scissors className="h-2.5 w-2.5" /> Clip
          </span>
        )}
        <span className="absolute right-2 top-2 rounded bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2 className="h-3.5 w-3.5" />
        </span>
        {/* Kind badge — labels each candidate Photo, Video, or a precut Clip
            (with its length) so the producer can tell stills from clips from
            ready-to-post segments at a glance. */}
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-3xs font-medium text-white">
          {isVideo ? <Video className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
          {isSegment
            ? (segLen ? `Clip · ${segLen}` : 'Clip')
            : isVideo
              ? (fmtDuration(clip.durationS) ? `Video · ${fmtDuration(clip.durationS)}` : 'Video')
              : 'Photo'}
        </span>
      </button>
      <div className="space-y-2 p-2.5">
        {/* For a precut clip, lead with its hook (the standalone moment's
            title) — that's why this slice was cut out and what makes it
            postable. Falls back to the source's visual tags. */}
        {isSegment && clip.segmentHook ? (
          <p className="line-clamp-2 text-2xs font-medium leading-snug text-foreground" title={clip.segmentHook}>
            “{clip.segmentHook}”
          </p>
        ) : tags.length > 0 ? (
          <p className="line-clamp-2 text-2xs leading-snug text-muted-foreground" title={tags.join(', ')}>
            {tags.join(' · ')}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant={attached ? 'ghost' : 'default'}
          className="w-full"
          disabled={attached || attaching}
          onClick={onAttach}
        >
          {attaching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : attached ? (
            <><Check className="mr-1.5 h-4 w-4 text-success" /> Attached</>
          ) : (
            <><Plus className="mr-1.5 h-4 w-4" /> Attach</>
          )}
        </Button>
      </div>
    </div>
  )
}
