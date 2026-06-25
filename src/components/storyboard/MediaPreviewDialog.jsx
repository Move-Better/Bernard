import { useQuery } from '@tanstack/react-query'
import { Image as ImageIcon, Check, Plus, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import MediaVideoPlayer from '@/components/MediaVideoPlayer'
import { getMediaAsset } from '@/lib/mediaLib'

function topTags(aiTags, n = 12) {
  if (!Array.isArray(aiTags)) return []
  return aiTags
    .map((t) => (typeof t === 'string' ? t : t?.tag || t?.label || ''))
    .filter(Boolean)
    .slice(0, n)
}

/**
 * MediaPreviewDialog — full-size preview of a candidate so the producer can
 * actually evaluate it before attaching: photos render large; videos play for
 * real via MediaVideoPlayer (Mux-when-ready + native blob fallback). This is
 * the piece the cramped in-editor strip never had.
 *
 * For video we fetch the full media_assets row (transcode_status,
 * mux_playback_id, dimensions) on open — the suggestion clip alone doesn't
 * carry what the player needs. Photos render straight from the blob url.
 */
export default function MediaPreviewDialog({ clip, open, onOpenChange, attached, attaching, onAttach }) {
  const isVideo = clip?.kind === 'video'

  const { data: asset, isLoading: assetLoading, isError: assetError } = useQuery({
    queryKey: ['media-asset', clip?.assetId],
    queryFn: () => getMediaAsset(clip.assetId),
    enabled: open && isVideo && !!clip?.assetId,
    staleTime: 5 * 60_000,
  })

  if (!clip) return null

  const pct = Math.round((clip.similarity || 0) * 100)
  const tags = topTags(clip.aiTags)
  const photoUrl = clip.blobUrl || clip.url || clip.thumbnailUrl

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-3 p-4">
        <DialogTitle className="sr-only">Media preview</DialogTitle>

        <div className="flex items-center justify-between gap-3 pr-8">
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">{pct}% match</span>
          {clip.filename && <span className="truncate text-xs text-muted-foreground">{clip.filename}</span>}
        </div>

        <div className="flex items-center justify-center overflow-hidden rounded-md bg-black">
          {isVideo ? (
            assetLoading ? (
              <div role="status" className="flex h-72 items-center justify-center"><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-white/80" /><span className="sr-only">Loading video…</span></div>
            ) : assetError || !asset ? (
              <div className="flex h-72 items-center justify-center text-sm text-white/80">Couldn’t load this video.</div>
            ) : (
              <MediaVideoPlayer asset={asset} className="w-full" />
            )
          ) : photoUrl ? (
            <img src={photoUrl} alt={clip.filename || ''} className="mx-auto max-h-[70vh] w-auto object-contain" />
          ) : (
            <div className="flex h-72 items-center justify-center text-white/60"><ImageIcon className="h-10 w-10" /></div>
          )}
        </div>

        {tags.length > 0 && (
          <p className="text-xs leading-relaxed text-muted-foreground">{tags.join(' · ')}</p>
        )}

        <div className="flex justify-end">
          <Button type="button" disabled={attached || attaching} onClick={onAttach}>
            {attaching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : attached ? (
              <><Check className="mr-1.5 h-4 w-4 text-success" /> Attached</>
            ) : (
              <><Plus className="mr-1.5 h-4 w-4" /> Attach to draft</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
