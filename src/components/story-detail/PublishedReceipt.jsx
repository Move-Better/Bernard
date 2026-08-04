// PublishedReceipt — what a committed post opens into instead of an editor.
//
// A scheduled or published piece has left our hands: the payload is with
// bundle.social or already live. Loading the slide/video editor on one invited
// edits that changed nothing downstream and quietly rewrote our record of what
// shipped (see src/lib/publishLock.js for the full why). So the content renders
// read-only here and the only controls are the ones that don't claim anything
// about the artifact: the two ratings, and — on a scheduled post only — the
// escape back to editable.
//
// The ratings are not new. `ModelPostRating` was already status-agnostic but
// buried in the publish dialog behind the sliders icon, and `WinnerToggle` only
// appeared on the Stories monitor row. Both surface here because judging a post
// you just published is the reason you opened it.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarClock, CheckCircle2, ExternalLink, Lock } from 'lucide-react'
import { toast } from 'sonner'
import BackLink from '@/components/ui/BackLink'
import PostPreview from '@/components/PostPreview'
import PostMetricsRow from '@/components/story-detail/PostMetricsRow'
import GbpInsightsRow from '@/components/story-detail/GbpInsightsRow'
import WinnerToggle from '@/components/story-detail/WinnerToggle'
import ModelPostRating from '@/components/story-detail/ModelPostRating'
import { CommentThread } from '@/components/story-detail/AssetsPane'
import { Button } from '@/components/ui/button'
import { useUpdateContentItem } from '@/lib/queries'
import { canUnschedule } from '@/lib/publishLock'
import { PLATFORM_META } from '@/lib/contentMeta'

function formatWhen(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Pull a scheduled post back to the editable queue. The one legal way out of
 * the lock — without it, a typo spotted after scheduling would be unfixable
 * until the post went live. Returns the piece to `approved` (it was approved
 * before it was scheduled, so that is where it belongs) and clears the time.
 */
function UnscheduleControl({ piece }) {
  const updateItem = useUpdateContentItem()
  const [confirming, setConfirming] = useState(false)

  const unschedule = () => {
    updateItem.mutate(
      { id: piece.id, patch: { status: 'approved', scheduledAt: null } },
      {
        onSuccess: () => toast.success('Pulled back — this post is editable again'),
        onError: () => toast.error('Could not unschedule. It may have already gone out.'),
      },
    )
  }

  if (!confirming) {
    return (
      <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
        Unschedule to edit
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-action/40 bg-action/10 p-2.5">
      <p className="text-xs text-foreground">
        This pulls the post out of the queue so you can edit it. You will need to schedule it again.
      </p>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={updateItem.isPending}>
          Keep it scheduled
        </Button>
        <Button size="sm" onClick={unschedule} disabled={updateItem.isPending}>
          {updateItem.isPending ? 'Pulling back…' : 'Unschedule'}
        </Button>
      </div>
    </div>
  )
}

export default function PublishedReceipt({ piece, title, nextPiece, nextTitle, nextMeta }) {
  const meta = PLATFORM_META[piece.platform] || { label: piece.platform || '—' }
  const Icon = meta.icon
  const isPublished = piece.status === 'published'
  const when = formatWhen(isPublished ? piece.published_at || piece.scheduled_at : piece.scheduled_at)

  return (
    <div className="space-y-5 py-6">
      <div className="min-w-0">
        <BackLink to="/publish">Back to Publish</BackLink>
        <h1 className="mt-1 flex items-center gap-2 text-lg font-semibold text-foreground">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          <span className="truncate">{title}</span>
        </h1>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{meta.label}</span>
          <span aria-hidden="true">·</span>
          {isPublished ? (
            <span className="inline-flex items-center gap-1 font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {piece.platform === 'blog' ? 'Published to Website' : 'Published'}
              {when ? ` · ${when}` : ''}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              Scheduled{when ? ` for ${when}` : ''}
            </span>
          )}
          {piece.resolved_url && (
            <>
              <span aria-hidden="true">·</span>
              <a
                href={piece.resolved_url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View live post
              </a>
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:[grid-template-columns:minmax(0,420px)_minmax(0,1fr)]">
        {/* Left — the post exactly as it went out. No canvas, no rail, no picker. */}
        <div className="lg:sticky lg:top-20 lg:self-start space-y-2">
          <PostPreview
            platform={piece.platform}
            content={typeof piece.content === 'string' ? piece.content : ''}
            mediaUrls={Array.isArray(piece.media_urls) ? piece.media_urls : []}
            slides={piece.slides || null}
            overlayText={piece.overlay_text || null}
            textCard={piece.text_card || null}
            locationOverrides={piece.location_overrides || null}
            photoTemplateId={piece.photo_template_id || null}
            aspectRatio={piece.aspect_ratio || '4:5'}
            format={piece.format || null}
          />
          <p className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            {isPublished
              ? 'Words, media and design are locked — this is what went out.'
              : 'Words, media and design are locked while this post is queued.'}
          </p>
        </div>

        {/* Right — how it did, and the calls you can still make on it. */}
        <div className="space-y-4">
          {isPublished && piece.platform_post_id && <PostMetricsRow contentItemId={piece.id} />}
          {isPublished && piece.platform === 'gbp' && <GbpInsightsRow contentItemId={piece.id} />}

          {/* Two signals, deliberately not interchangeable: one is YOUR read of
              the craft (words, media, framing) and teaches Bernard how to
              write; the other is the AUDIENCE's response and teaches it what to
              write about. Both used to be phrased as verdicts on quality, which
              made them impossible to tell apart — so each now states the effect
              it has. The winner half only appears once a post is live, because
              until then there is no audience to have responded. */}
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Teach Bernard from this post
            </p>

            <div className="space-y-1">
              <ModelPostRating piece={piece} />
              <p className="pl-1 text-2xs text-muted-foreground">
                Used as a style example in future drafts — words, media and framing.
              </p>
            </div>

            {isPublished && (
              <div className="space-y-1">
                <WinnerToggle piece={piece} variant="row" />
                <p className="pl-1 text-2xs text-muted-foreground">
                  Brings this topic back sooner in the plan.
                </p>
              </div>
            )}
          </div>

          {canUnschedule(piece) && <UnscheduleControl piece={piece} />}

          {nextPiece && (
            <Link
              to={`/publish/${nextPiece.id}`}
              className="group block rounded-lg border border-primary/20 bg-accent/20 p-3 transition-colors hover:border-primary/40"
            >
              <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Next up</p>
              <span className="flex items-center justify-between gap-3">
                <span className="min-w-0 text-sm text-foreground">
                  <b className="block truncate font-medium">{nextTitle}</b>
                  <span className="text-xs text-muted-foreground">{nextMeta?.label} · needs media</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                  Open <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </span>
            </Link>
          )}

          <CommentThread pieceId={piece.id} interviewId={piece.interview_id} />
        </div>
      </div>
    </div>
  )
}
