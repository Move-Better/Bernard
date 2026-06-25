import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Eye, Image as ImageIcon, Link2, Type, Video, X } from 'lucide-react'
import PostPreview from '@/components/PostPreview'
import MediaPicker from '@/components/MediaPicker'
import { ApprovalPanel } from '@/components/story-detail/AssetsPane'
import BufferMetricsRow from '@/components/story-detail/BufferMetricsRow'
import WinnerToggle from '@/components/story-detail/WinnerToggle'
import { useUpdateContentItem } from '@/lib/queries'
import { deriveStory } from '@/lib/storyFields'
import { pickerItemToMediaEntry, isVideoEntry, photoSourceUrl } from '@/lib/mediaEntry'
import { toast } from '@/lib/toast'

// StoryComposer — the Instagram Story editor. One 9:16 frame, so there's no
// slide rail and no timeline: just media (photo OR video), the overlay headline,
// and the link-sticker label, beside the live Story preview.
//
// Story fields are spread across columns (content / overlay_text / text_card),
// so we seed local state from deriveStory() and write each field to its
// canonical home on blur:
//   overlay  → content + overlay_text   (both, for back-compat readers)
//   sticker  → text_card.cta            (merged into any existing text_card)
//   media    → media_urls (single entry; a Story shows one asset)
export default function StoryComposer({ piece, remainingNeedsMedia = [] }) {
  const update = useUpdateContentItem()
  const [pickerOpen, setPickerOpen] = useState(false)

  // Seed from the row; re-seed only when the piece identity changes so an
  // in-progress edit isn't clobbered by a background refetch of the same row.
  const seed = deriveStory(piece)
  const [overlay, setOverlay] = useState(seed.overlay)
  const [sticker, setSticker] = useState(seed.sticker)
  const seededId = useRef(piece?.id)
  useEffect(() => {
    if (seededId.current !== piece?.id) {
      const s = deriveStory(piece)
      setOverlay(s.overlay)
      setSticker(s.sticker)
      seededId.current = piece?.id
    }
  }, [piece])

  const media = Array.isArray(piece?.media_urls) ? piece.media_urls : []
  const first = media[0] || null
  const firstIsVideo = first ? isVideoEntry(first) : false
  const thumbSrc = first ? (photoSourceUrl(first) || first.url || first.thumbnailUrl) : null

  const patch = (p) =>
    update.mutateAsync({ id: piece.id, patch: p }).catch((e) =>
      toast.error("Couldn't save", { description: e?.message }),
    )

  const saveOverlay = () => {
    const v = overlay.trim()
    if (v === deriveStory(piece).overlay) return
    patch({ content: v, overlayText: v })
  }
  const saveSticker = () => {
    const v = sticker.trim()
    const existing = piece?.text_card && typeof piece.text_card === 'object' ? piece.text_card : {}
    if (v === (existing.cta || '')) return
    patch({ textCard: { ...existing, cta: v } })
  }

  const handlePicked = (assets) => {
    setPickerOpen(false)
    const incoming = (Array.isArray(assets) ? assets : [assets]).filter(Boolean).map(pickerItemToMediaEntry)
    if (incoming.length === 0) return
    // A Story is a single asset — the pick replaces whatever was there.
    patch({ mediaUrls: [incoming[0]] }).then(() => toast.success('Media attached'))
  }
  const removeMedia = () => patch({ mediaUrls: [] })

  const published = piece?.status === 'published'

  return (
    <div className="grid grid-cols-1 gap-6 lg:[grid-template-columns:minmax(0,300px)_minmax(0,1fr)]">
      {/* Left — live Story preview */}
      <div className="lg:sticky lg:top-20 lg:self-start space-y-2">
        <p className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Eye className="h-3.5 w-3.5" /> Story preview
        </p>
        <PostPreview
          platform="instagram_story"
          content={typeof piece?.content === 'string' ? piece.content : ''}
          mediaUrls={media}
          overlayText={piece?.overlay_text || null}
          textCard={piece?.text_card || null}
        />
      </div>

      {/* Right — compose + publish */}
      <div className="space-y-4">
        {/* Media */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Media</p>
          {first ? (
            <div className="flex items-center gap-3 rounded-lg bg-muted/40 p-2.5">
              <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md bg-slate-900">
                {thumbSrc && <img src={thumbSrc} alt={first.name || 'media'} className="h-full w-full object-cover" />}
                {firstIsVideo && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Video className="h-4 w-4 text-white/90" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{first.name || (firstIsVideo ? 'Video clip' : 'Photo')}</p>
                <p className="text-xs text-muted-foreground">{firstIsVideo ? 'Video' : 'Photo'}</p>
              </div>
              <button
                type="button"
                onClick={removeMedia}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Remove media"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No media yet — a Story needs a photo or video. Without one, the branded card publishes.
            </p>
          )}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <ImageIcon className="h-4 w-4" />
            {first ? 'Replace media' : 'Pick photo or video'}
          </button>
        </div>

        {/* Story text */}
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Story text</p>

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Type className="h-3.5 w-3.5 text-muted-foreground" /> Overlay text
            </label>
            <textarea
              aria-label="Overlay text"
              value={overlay}
              onChange={(e) => setOverlay(e.target.value)}
              onBlur={saveOverlay}
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 text-sm font-semibold uppercase tracking-wide outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              placeholder="YOUR SHORT, PUNCHY HEADLINE"
            />
            <p className="text-3xs text-muted-foreground">Short + all-caps · printed over the media</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="sticker-label-input" className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" /> Link sticker label
            </label>
            <input
              id="sticker-label-input"
              type="text"
              value={sticker}
              onChange={(e) => setSticker(e.target.value)}
              onBlur={saveSticker}
              className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              placeholder="e.g. Reserve your seat · Book now · Learn more"
            />
            <p className="text-3xs text-muted-foreground">2–4 words · the tap target on the posted Story</p>
          </div>
        </div>

        {/* Schedule / publish */}
        <ApprovalPanel piece={piece} mode="publish" />

        {/* Next up — loop back into the queue */}
        {remainingNeedsMedia.length > 0 && (
          <Link
            to="/publish"
            className="group block rounded-lg border border-primary/20 bg-accent/20 p-3 transition-colors hover:border-primary/40"
          >
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Next up</p>
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

        {published && piece.buffer_update_id && <BufferMetricsRow contentItemId={piece.id} />}
        {published && <WinnerToggle piece={piece} />}
      </div>

      {pickerOpen && <MediaPicker onClose={() => setPickerOpen(false)} onSelect={handlePicked} />}
    </div>
  )
}
