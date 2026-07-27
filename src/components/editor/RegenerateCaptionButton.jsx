import { useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRegenerateContentItem } from '@/lib/queries'
import { toast } from '@/lib/toast'

// Regenerate button for SOCIAL content_items (LinkedIn / Facebook / Instagram /
// GBP / X / Threads / Bluesky / Mastodon). The blog has its own streamed regen
// (BlogWordsExtras / useRegenerateBlogStreamed); this is the non-blog analog —
// it wires the previously-orphaned useRegenerateContentItem hook (defined but
// mounted nowhere) to a real button, mirroring the blog RegenerateSection's
// look, confirm-on-overwrite, and pending state.
//
// Mounted in BOTH caption editors: SlideEditor's CaptionPanel (photo / carousel
// pieces) and UnifiedEditor's WordsPanel (media-less social cards) — the two
// surfaces StoryboardPublish routes a social piece to.
//
// Eligibility mirrors api/_routes/content-items/regenerate.js's own rejections
// so the button never shows for a piece the endpoint would 422: needs a source
// interview, and never blog (its own path), email (no atom prompt), or video
// platforms (rendered assets, not text atoms).
const VIDEO_PLATFORMS = new Set(['youtube', 'youtube_short', 'tiktok', 'reels', 'instagram_reel'])

export function canRegenerateCaption(piece) {
  if (!piece?.interview_id) return false
  if (piece.platform === 'blog' || piece.platform === 'email') return false
  if (VIDEO_PLATFORMS.has(piece.platform)) return false
  return true
}

export default function RegenerateCaptionButton({ piece }) {
  const regenerate = useRegenerateContentItem()
  const [confirming, setConfirming] = useState(false)

  if (!canRegenerateCaption(piece)) return null

  // content diverges from ai_original_content only after a human edit — warn
  // extra hard that those specific edits are about to be discarded.
  const edited =
    typeof piece.content === 'string' &&
    typeof piece.ai_original_content === 'string' &&
    piece.content !== piece.ai_original_content

  const handleRegenerate = async () => {
    setConfirming(false)
    try {
      await regenerate.mutateAsync({ id: piece.id })
      toast.success('Regenerated', {
        description: 'Caption rewritten from the interview and reset to draft.',
      })
    } catch (e) {
      toast.error('Regeneration failed', { description: e?.message })
    }
  }

  if (regenerate.isPending) {
    return (
      <div role="status" className="flex items-center gap-2 text-2xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        Regenerating — this can take 10–20 seconds…
      </div>
    )
  }

  if (confirming) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-2xs space-y-2">
        <span className="text-warning">
          Replace this caption with a fresh AI generation? The current text and approval state will be lost.
          {edited && (
            <span className="block mt-0.5 font-medium text-warning/80">
              Your manual edits to this caption will be discarded.
            </span>
          )}
          {piece.staff_name && (
            <span className="block mt-0.5 text-warning/80">
              Bernard will apply {piece.staff_name}&rsquo;s voice settings.
            </span>
          )}
        </span>
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-6 border-warning/40 text-2xs text-warning hover:bg-warning/10"
            onClick={handleRegenerate}
          >
            Regenerate
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-2xs" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 text-2xs"
      onClick={() => setConfirming(true)}
    >
      <RotateCcw className="h-3 w-3" />
      Regenerate
    </Button>
  )
}
