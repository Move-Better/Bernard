import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { GalleryHorizontalEnd, ArrowRight, Check, Loader2, Video, Image as ImageIcon, Inbox, Send, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useContentItems, useDeleteContentItem } from '@/lib/queries'
import { PLATFORM_META } from '@/lib/contentMeta'
import { mediaKindForPlatform, mediaKindLabel } from '@/lib/platformMediaKind'

// "Draft" (needs media) = no media attached. Empty array or null both count. Kept in
// one place so the count and the list always agree.
const NEEDS_MEDIA = (p) => !Array.isArray(p?.media_urls) || p.media_urls.length === 0

// A draft is "stale" once it has waited this long without media — the cue to
// prioritize it. Drives the amber age label (vs muted for fresher drafts),
// replacing the old uniform amber "Review media" that shouted on every row.
const STALE_DAYS = 7

function firstHeading(content) {
  if (typeof content !== 'string') return ''
  const m = content.match(/^#{1,6}\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

// Whole days since `iso`; null when missing/unparseable so callers can hide the
// age signal rather than render a bogus "NaNd ago".
function daysSince(iso) {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((Date.now() - then) / 86_400_000)
}

function ageLabel(days) {
  if (days == null) return null
  if (days <= 0) return 'today'
  return `${days}d ago`
}

// Publisher inbox banner — shown at the top of Storyboard when there is
// actionable work. Mirrors the DraftsReadyRow warm-inbox treatment from Home
// so the visual language is consistent: primary-orange border + gradient bg =
// "your queue, act now."
function PublisherInboxBanner({ needsMediaCount, readyCount }) {
  if (needsMediaCount === 0 && readyCount === 0) return null
  const parts = []
  if (needsMediaCount > 0)
    parts.push(`${needsMediaCount} draft${needsMediaCount > 1 ? 's' : ''} need${needsMediaCount === 1 ? 's' : ''} media`)
  if (readyCount > 0)
    parts.push(`${readyCount} ready to send`)
  return (
    <div className="rounded-2xl border border-action/30 bg-gradient-to-b from-white to-[#fffbf2] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-18px_rgba(217,119,6,0.22)] px-5 py-4 flex items-center gap-3">
      <span className="inline-block w-1 h-6 rounded-full shrink-0 bg-action" aria-hidden="true" />
      <Inbox className="h-4 w-4 text-action shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground">
          Your queue: {parts.join(' · ')}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {needsMediaCount > 0
            ? 'Start with the oldest draft — attach media, then compose and schedule.'
            : "Media's attached — open each and compose & schedule to get it out the door."}
        </p>
      </div>
      {readyCount > 0 && (
        <Link
          to="/storyboard#ready"
          className="shrink-0 inline-flex items-center gap-1.5 bg-action text-white text-xs font-semibold px-3 py-2 rounded-lg hover:opacity-90 transition-opacity"
        >
          <Send className="h-3.5 w-3.5" />
          Work the inbox
        </Link>
      )}
    </div>
  )
}

/**
 * Storyboard — the queue. Every written-and-ready draft that still has no
 * photo or video. Each card opens the focused Storyboard page
 * (/storyboard/:pieceId) where the producer reviews suggested media at full
 * size — plays the videos — and attaches the right one.
 *
 * The content→media tool, sibling to Slate (video→content). Ungated like
 * Library so producers (no interview.start) see it; it's their surface.
 *
 * Layout: an edge-to-edge responsive card grid (not a single capped column),
 * oldest draft first so age is the priority signal. Each card carries the
 * channel's accepted media kind and how long it's been waiting.
 */
export default function Storyboard() {
  const { data: items = [], isLoading } = useContentItems({ status: 'draft,in_review' })
  // Oldest first — age is the priority signal, so the draft that has waited
  // longest for media sits at the top of the queue.
  const rows = useMemo(
    () =>
      items
        .filter(NEEDS_MEDIA)
        .slice()
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)),
    [items],
  )

  // Pieces that HAVE media but aren't published yet. Without this they'd vanish
  // from every list the moment media was attached (they leave the needs-media
  // queue but never reach a published view) — leaving no way back to finish or
  // publish them. Newest first: the one you just worked on is at the top.
  const ready = useMemo(
    () =>
      items
        .filter((p) => !NEEDS_MEDIA(p))
        .slice()
        .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)),
    [items],
  )

  const nothingToShow = rows.length === 0 && ready.length === 0

  return (
    <div className="space-y-6 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <GalleryHorizontalEnd className="h-5 w-5 text-primary" />
          Storyboard
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Drafts that need a photo or video, and the ones you’ve already given media and can take to
          publish. Open one to review the suggested media at full size — play the videos — and attach
          the right match.
        </p>
      </div>

      {!isLoading && <PublisherInboxBanner needsMediaCount={rows.length} readyCount={ready.length} />}

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your drafts…
        </div>
      ) : nothingToShow ? (
        <div className="rounded-lg border bg-muted/20 py-12 text-center">
          <Check className="mx-auto h-8 w-8 text-success" />
          <p className="mt-2 text-sm font-medium text-foreground">Nothing in the Storyboard right now 🎉</p>
          <p className="text-xs text-muted-foreground">New drafts show up here when they need media.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Draft — the work queue. Pieces that still need media attached. */}
          {rows.length > 0 && (
            <section className="space-y-3">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Draft · {rows.length}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {rows.map((piece) => (
                  <NeedsMediaCard key={piece.id} piece={piece} />
                ))}
              </div>
            </section>
          )}

          {/* Ready to Distribute — has media, not yet published. Publisher's
              action queue: these are done waiting, they just need to be sent.
              Warm-orange heading + badge so the eye lands here as "act now",
              matching the approved-lane treatment in PipelineKanban. */}
          {ready.length > 0 && (
            <section id="ready" className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1 h-4 rounded-full shrink-0 bg-action" aria-hidden="true" />
                <Send className="h-3.5 w-3.5 text-action" />
                <p className="text-sm font-bold text-action tracking-tight">
                  Ready to distribute
                </p>
                <span className="text-3xs font-bold rounded-full px-2 py-0.5 bg-action/10 text-action">
                  {ready.length}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {ready.map((piece) => (
                  <ReadyCard key={piece.id} piece={piece} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// A draft that still needs media → opens the Choose media step. Carries the age
// signal (amber once stale) and the channel's accepted media kind.
function NeedsMediaCard({ piece }) {
  const meta = PLATFORM_META[piece.platform] || { label: piece.platform }
  const Icon = meta.icon
  const title = piece.topic || firstHeading(piece.content) || 'Untitled draft'
  const kind = mediaKindForPlatform(piece.platform)
  const kindLabel = mediaKindLabel(kind)
  const days = daysSince(piece.created_at)
  const age = ageLabel(days)
  const stale = days != null && days >= STALE_DAYS
  const { mutate: deletePiece, isPending: deleting } = useDeleteContentItem()
  return (
    <div className="relative group">
      <Link
        to={`/storyboard/${piece.id}`}
        className="block rounded-lg border bg-card p-3 transition-colors hover:border-primary/40 hover:shadow-sm"
      >
        <div className="flex items-start justify-between gap-2">
          <Badge variant="outline" className="gap-1 text-2xs">
            {Icon && <Icon className="h-3 w-3" />}{meta.label}
          </Badge>
          {age && (
            <span className={`shrink-0 text-2xs font-medium pr-5 ${stale ? 'text-warning' : 'text-muted-foreground'}`}>
              {age}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm font-medium leading-snug text-foreground">{title}</p>
        <div className="mt-2 flex items-center gap-2 text-2xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {kind === 'video' && <Video className="h-3 w-3" />}
            {kind === 'photo' && <ImageIcon className="h-3 w-3" />}
            {kindLabel}
          </span>
          {piece.staff_name && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{piece.staff_name}</span>
            </>
          )}
        </div>
        <div className="mt-3 flex items-center justify-end">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            Add media <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </Link>
      <button
        type="button"
        disabled={deleting}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); deletePiece(piece.id) }}
        className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:border-destructive/50 hover:text-destructive disabled:pointer-events-none"
        aria-label="Remove draft"
      >
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

// A piece that already has media → jumps straight to its Publish page. Shows a
// media count and a green "has media" cue so it reads as further along than the
// needs-media cards.
function ReadyCard({ piece }) {
  const meta = PLATFORM_META[piece.platform] || { label: piece.platform }
  const Icon = meta.icon
  const title = piece.topic || firstHeading(piece.content) || 'Untitled draft'
  const count = Array.isArray(piece.media_urls) ? piece.media_urls.length : 0
  const { mutate: deletePiece, isPending: deleting } = useDeleteContentItem()
  return (
    <div className="relative group">
      <Link
        to={`/storyboard/${piece.id}/publish`}
        className="block rounded-lg border border-primary/30 bg-gradient-to-b from-white to-[#f4fbf8] p-3 transition-all hover:shadow-[0_4px_12px_-8px_rgba(16,185,129,0.3)] hover:-translate-y-0.5"
      >
        <div className="flex items-start justify-between gap-2">
          <Badge variant="outline" className="gap-1 text-2xs">
            {Icon && <Icon className="h-3 w-3" />}{meta.label}
          </Badge>
          <span className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-muted-foreground pr-5">
            <ImageIcon className="h-3 w-3" /> {count}
          </span>
        </div>
        <p className="mt-2 text-sm font-medium leading-snug text-foreground">{title}</p>
        <div className="mt-2 flex items-center gap-2 text-2xs text-muted-foreground">
          <span>{count} media attached</span>
          {piece.staff_name && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{piece.staff_name}</span>
            </>
          )}
        </div>
        <div className="mt-3 flex items-center justify-end">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline underline-offset-2">
            Compose &amp; publish <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </Link>
      <button
        type="button"
        disabled={deleting}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); deletePiece(piece.id) }}
        className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:border-destructive/50 hover:text-destructive disabled:pointer-events-none"
        aria-label="Remove draft"
      >
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
