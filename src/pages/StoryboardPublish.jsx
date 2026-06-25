import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import BackLink from '@/components/ui/BackLink'
import Breadcrumb from '@/components/ui/Breadcrumb'
import { pieceLabel } from '@/lib/pieceLabel'
import { postFormat } from '@/lib/mediaEntry'
import { resolveArchetype } from '@/lib/editorArchetype'
import LoadingState from '@/components/LoadingState'
import ErrorState from '@/components/ErrorState'
import SlideEditor from '@/components/story-detail/SlideEditor'
import StoryComposer from '@/components/story-detail/StoryComposer'
import BufferMetricsRow from '@/components/story-detail/BufferMetricsRow'
import WinnerToggle from '@/components/story-detail/WinnerToggle'
import UnifiedEditor from '@/components/editor/UnifiedEditor'
import { ApprovalPanel } from '@/components/story-detail/AssetsPane'
import { useContentItem, useContentItems } from '@/lib/queries'
import { PLATFORM_META } from '@/lib/contentMeta'

// Same predicate the Storyboard queue uses — a draft "needs media" when nothing
// is attached. Shared shape keeps the "Next up" count honest against the queue.
const NEEDS_MEDIA = (p) => !Array.isArray(p?.media_urls) || p.media_urls.length === 0

function firstHeading(content) {
  if (typeof content !== 'string') return ''
  const m = content.match(/^#{1,6}\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

/**
 * StoryboardPublish — the final output surface for one content piece. The third
 * step of the divided flow: Stories (words) → Storyboard (media) → Publish.
 *
 * Everything needed to turn an approved, media-attached draft into a live post
 * lives here at full size: a big live preview (left), the compose controls
 * (carousel slide text + position + theme, via SlideEditor) and the
 * schedule/publish/export actions (right, via ApprovalPanel mode="publish").
 *
 * This is where the publish/compose tooling moved OUT of the cramped Stories
 * editor — so there is exactly one place to publish.
 */
export default function StoryboardPublish() {
  const { pieceId } = useParams()
  const navigate = useNavigate()
  const { data: piece, isLoading, isError } = useContentItem(pieceId)

  // Other drafts still waiting on media — drives the "Next up" loop-close so the
  // producer flows straight back into the queue after publishing one piece,
  // instead of dead-ending on a single post.
  const { data: worklist = [] } = useContentItems({ status: 'draft,in_review' })
  const remainingNeedsMedia = useMemo(
    () => worklist.filter((p) => p.id !== pieceId && NEEDS_MEDIA(p)),
    [worklist, pieceId],
  )

  if (isLoading) return <LoadingState />
  if (isError || !piece) {
    return (
      <div className="space-y-4 py-6">
        <BackLink to="/publish">Back to Publish</BackLink>
        <ErrorState message="Draft not found." />
      </div>
    )
  }

  const meta = PLATFORM_META[piece.platform] || { label: piece.platform || '—' }
  const Icon = meta.icon
  const title = piece.topic || firstHeading(piece.content) || 'Untitled draft'
  // Route by editing archetype (the unified-shell resolver) instead of ad-hoc
  // platform/media flags. An Instagram piece with a video is a Reel ('vvideo'),
  // without is a carousel; instagram_story routes to the Story composer whether
  // it's a photo frame ('story') or a video story ('storyvid').
  const archetype = resolveArchetype(piece)
  const isCarousel = archetype === 'carousel'
  const isStory = piece.platform === 'instagram_story'
  // Named format + slide-count badge from the shared helper — the header used to
  // count source photos ("1 media attached") next to N slide cards.
  const fmt = postFormat(piece)
  const photoCount = Array.isArray(piece.media_urls) ? piece.media_urls.length : 0

  // Carousel → full-bleed dedicated editor. Breaks out of the page's padding
  // (the Layout `main` adds px/py) and fills the content region so the editor
  // canvas dominates, matching the approved mockup. Publish/schedule actions
  // fold into the editor's own top bar (Schedule button → modal). All page
  // chrome (stepper, breadcrumb, heading) is intentionally dropped here.
  if (isCarousel) {
    const scheduleNode = (
      <div className="space-y-4">
        <ApprovalPanel piece={piece} mode="publish" />
        {remainingNeedsMedia.length > 0 && (
          <Link
            to="/publish"
            className="group block rounded-lg border border-primary/20 bg-accent/20 p-3 transition-colors hover:border-primary/40"
          >
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Next up
            </p>
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm text-foreground">
                <b className="font-medium">
                  {remainingNeedsMedia.length} more draft{remainingNeedsMedia.length === 1 ? '' : 's'}
                </b>{' '}
                need media
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                Publish <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </span>
          </Link>
        )}
        {piece.status === 'published' && piece.buffer_update_id && (
          <BufferMetricsRow contentItemId={piece.id} />
        )}
        {piece.status === 'published' && <WinnerToggle piece={piece} />}
      </div>
    )
    return (
      <div className="-mx-4 -my-8 sm:-mx-6 lg:-mx-8 h-[100dvh] overflow-hidden">
        <SlideEditor
          piece={piece}
          onBack={() => navigate('/publish')}
          formatLabel={fmt.label}
          formatSub={`${fmt.count} ${fmt.unit}`}
          photoCount={photoCount}
          scheduleNode={scheduleNode}
        />
      </div>
    )
  }

  // Instagram Story → the dedicated single-frame composer (media + overlay text
  // + link sticker), inside the standard page chrome.
  if (isStory) {
    return (
      <div className="space-y-5 py-6">
        <Breadcrumb
          items={[
            { label: 'Publish queue', to: '/publish' },
            { label: pieceLabel(piece) },
          ]}
        />
        <div className="min-w-0">
          <BackLink to="/publish">Back to Publish</BackLink>
          <h1 className="mt-1 flex items-center gap-2 text-lg font-semibold text-foreground">
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            <span className="truncate">{title}</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            {fmt.label} · {photoCount === 0 ? 'no media yet' : `${photoCount} ${photoCount === 1 ? 'item' : 'items'}`}
          </p>
        </div>
        <StoryComposer piece={piece} remainingNeedsMedia={remainingNeedsMedia} />
      </div>
    )
  }

  // Everything else — visual (LinkedIn/Facebook/Twitter/GBP…), video posts,
  // doc (blog/landing), email, text ads, ad creative — flows through the unified
  // shell editor (full-bleed, same chrome as the carousel/reel editors).
  return (
    <div className="-mx-4 -my-8 sm:-mx-6 lg:-mx-8 h-[100dvh] overflow-hidden">
      <UnifiedEditor
        piece={piece}
        onBack={() => navigate('/publish')}
        formatLabel={fmt.label}
        formatSub={`${fmt.count} ${fmt.unit}`}
        photoCount={photoCount}
        remainingNeedsMedia={remainingNeedsMedia}
      />
    </div>
  )
}
