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
import { ArrowRight, CalendarClock, CheckCircle2, ExternalLink } from 'lucide-react'
import EditorChrome from '@/components/editor/EditorChrome'
import PostPreview from '@/components/PostPreview'
import PostMetricsRow from '@/components/story-detail/PostMetricsRow'
import GbpInsightsRow from '@/components/story-detail/GbpInsightsRow'
import WinnerToggle from '@/components/story-detail/WinnerToggle'
import ModelPostRating from '@/components/story-detail/ModelPostRating'
import { CommentThread } from '@/components/story-detail/AssetsPane'
import { Button } from '@/components/ui/button'
import { useContentWorkflow } from '@/lib/useContentWorkflow'
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
 * until the post went live.
 *
 * It goes through the workflow's cancelScheduled, which cancels the post at
 * bundle.social FIRST and only then returns the piece to `approved`. This used
 * to patch the status alone: our record said "editable" while the network
 * still held the scheduled post, so it would have gone out anyway, and
 * scheduling it again would have posted it twice (found 2026-11-11, no post
 * affected). If the cancel fails, the piece stays scheduled.
 */
function UnscheduleControl({ piece }) {
  const wf = useContentWorkflow(piece)
  const [confirming, setConfirming] = useState(false)
  const busy = wf.publishing

  if (!confirming) {
    return (
      <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
        Unschedule to edit
      </Button>
    )
  }

  return (
    <div className="absolute right-4 top-full z-40 mt-2 flex w-[360px] flex-wrap items-center gap-2 rounded-lg border border-action/40 bg-card p-2.5 shadow-lg">
      <p className="text-xs text-foreground">
        This pulls the post out of the queue so you can edit it. You will need to schedule it again.
      </p>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
          Keep it scheduled
        </Button>
        <Button size="sm" onClick={() => wf.cancelScheduled()} disabled={busy}>
          {busy ? 'Pulling back…' : 'Unschedule'}
        </Button>
      </div>
    </div>
  )
}

// Post editor audit E (2026-11-11): the published view uses the editors' own
// frame — full screen, the shared top bar, the post on the canvas side and its
// results in a side panel that scrolls by itself — so opening a committed post
// no longer looks like leaving the editor. Nothing here is editable.
export default function PublishedReceipt({ piece, title, storyLine = null, formatLabel = null, onBack, nextPiece, nextTitle, nextMeta }) {
  const meta = PLATFORM_META[piece.platform] || { label: piece.platform || '—' }
  const isPublished = piece.status === 'published'
  const when = formatWhen(isPublished ? piece.published_at || piece.scheduled_at : piece.scheduled_at)

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <EditorChrome
        onBack={onBack}
        title={title}
        subtitle={storyLine}
        destination={meta.icon ? { icon: meta.icon, label: meta.label, colorClass: meta.color, bgClass: meta.bg, borderClass: meta.border } : null}
        badge={formatLabel && formatLabel !== meta.label ? { label: formatLabel } : null}
        note={isPublished ? 'Locked — this is what went out' : 'Locked while queued'}
      >
        <div className="relative flex items-center gap-2">
          {isPublished ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {piece.platform === 'blog' ? 'Published to website' : 'Published'}
              {when && <span className="font-normal text-muted-foreground">· {when}</span>}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-1.5 text-xs font-semibold text-primary">
              <CalendarClock className="h-3.5 w-3.5" />
              Scheduled
              {when && <span className="font-normal text-muted-foreground">· {when}</span>}
            </span>
          )}
          {piece.resolved_url && (
            <a
              href={piece.resolved_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View live post
            </a>
          )}
          {canUnschedule(piece) && <UnscheduleControl piece={piece} />}
        </div>
      </EditorChrome>

      {/* Phone: one scrolling column (post, then panel). Desktop: the canvas
          and the side panel each scroll on their own, as in the editors. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* The post exactly as it went out. No canvas tools, no picker. */}
        <div className="flex flex-1 justify-center bg-muted/40 p-6 lg:overflow-y-auto">
          <div className="w-full max-w-[420px]">
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
          </div>
        </div>

        {/* How it did, and the calls you can still make on it. */}
        <aside className="space-y-4 border-t border-border p-4 lg:w-[380px] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
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
        </aside>
      </div>
    </div>
  )
}
