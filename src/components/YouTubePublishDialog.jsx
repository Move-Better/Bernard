import { useEffect, useState } from 'react'
import { Youtube, Loader2, Sparkles, AlertTriangle } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import Icon from '@/components/ui/Icon'
import { useAppMutation } from '@/lib/useAppMutation'
import { useUser } from '@clerk/react'
import { toast } from '@/lib/toast'
import {
  draftYouTubeCopy, createYouTubePiece, isWithinUploadLimit,
  formatBytes, formatDuration,
  YOUTUBE_TITLE_MAX, YOUTUBE_DESCRIPTION_MAX,
} from '@/lib/youtubeLib'
import { publishAndTrack } from '@/lib/publish'

const VISIBILITIES = [
  { id: 'PUBLIC',   label: 'Public' },
  { id: 'UNLISTED', label: 'Unlisted' },
  { id: 'PRIVATE',  label: 'Private' },
]

/**
 * Publish a finished landscape video to YouTube, whole and untouched.
 *
 * Deliberately NOT an editor: this lane exists for footage that is already
 * finished, so the source file is sent as-is — no trim, no re-encode, no
 * branding pass. Video that still needs cutting goes to the clip editor instead.
 *
 * Publishes directly rather than routing through the approval rail (Q, 2026-08-03):
 * the operator reads the exact title and description here before confirming, and
 * that is the human checkpoint the words-approval gate defers to for pieces with
 * no parent interview.
 */
export default function YouTubePublishDialog({ asset, open, onOpenChange, onPublished }) {
  const { user } = useUser()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState('PUBLIC')
  const [drafted, setDrafted] = useState(false)
  const [chapterCount, setChapterCount] = useState(0)
  const [noTranscript, setNoTranscript] = useState(false)

  const sizeOk = isWithinUploadLimit(asset)
  const sizeLabel = formatBytes(asset?.size_bytes)
  const durationLabel = formatDuration(asset?.duration_s)

  const draft = useAppMutation({
    mutationFn: () => draftYouTubeCopy(asset.id),
    onSuccess: (d) => {
      setTitle(d?.title || '')
      setDescription(d?.description || '')
      setChapterCount(d?.chapterCount || 0)
      setNoTranscript(d?.hasTranscript === false)
      setDrafted(true)
    },
    onError: () => setDrafted(true),
  })

  // Draft once per open, and only when the file can actually be sent — there is
  // no point spending a model call on a video the upload path will refuse.
  useEffect(() => {
    if (!open || !asset?.id || drafted || draft.isPending || !sizeOk) return
    draft.mutate()
  }, [open, asset?.id, drafted, draft, sizeOk])

  // Reset between assets so a second open never shows the previous video's copy.
  useEffect(() => {
    if (open) return
    setTitle(''); setDescription(''); setVisibility('PUBLIC')
    setDrafted(false); setChapterCount(0); setNoTranscript(false)
  }, [open])

  const publish = useAppMutation({
    mutationFn: async () => {
      const { contentItemId } = await createYouTubePiece({
        assetId: asset.id, title: title.trim(), description: description.trim(),
      })
      if (!contentItemId) throw new Error('Could not create the post.')
      return publishAndTrack(
        {
          id: contentItemId,
          platform: 'youtube',
          content: description.trim() || title.trim(),
          mediaUrls: [{
            url: asset.blob_url, type: 'video', kind: 'video', mediaAssetId: asset.id,
          }],
          youtubeTitle: title.trim(),
          youtubeDescription: description.trim(),
          youtubePrivacy: visibility,
        },
        user?.primaryEmailAddress?.emailAddress || 'unknown',
      )
    },
    onSuccess: () => {
      toast('Sent to YouTube — it goes live in about a minute.')
      onOpenChange(false)
      onPublished?.()
    },
  })

  const titleOver = title.length > YOUTUBE_TITLE_MAX
  const descOver = description.length > YOUTUBE_DESCRIPTION_MAX
  const canPublish = sizeOk && !!title.trim() && !titleOver && !descOver && !publish.isPending

  if (!asset) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon as={Youtube} size="md" className="text-red-600" />
            Publish to YouTube
          </DialogTitle>
          <DialogDescription>
            Sends this video to YouTube exactly as it is — no trim, no re-encode.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Source video */}
          <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-2.5">
            <div className="relative w-24 shrink-0 overflow-hidden rounded aspect-video bg-muted">
              {asset.thumbnail_url && (
                <img
                  src={asset.thumbnail_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
              {durationLabel && (
                <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-3xs font-medium text-white tabular-nums">
                  {durationLabel}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {asset.display_title || asset.filename}
              </div>
              <div className="text-2xs text-muted-foreground tabular-nums">
                {[asset.width && asset.height ? `${asset.width}×${asset.height}` : null, sizeLabel]
                  .filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>

          {!sizeOk ? (
            <div className="flex gap-2.5 rounded-md border-l-2 border-l-action bg-action/10 p-3">
              <Icon as={AlertTriangle} size="sm" className="mt-0.5 shrink-0 text-action" />
              <div className="space-y-1">
                <div className="text-xs font-semibold">This file is too large to send</div>
                <p className="text-2xs leading-snug text-muted-foreground">
                  {sizeLabel} is past the 2.5 GB our publishing route can carry. This
                  is a camera original — an export at normal delivery quality would be
                  a fraction the size and would look the same on YouTube. Export a
                  delivery copy and upload that instead.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Label htmlFor="yt-title">Title</Label>
                  <span className={`text-3xs tabular-nums ${titleOver ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                    {title.length} / {YOUTUBE_TITLE_MAX}
                  </span>
                </div>
                <Input
                  id="yt-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={draft.isPending ? 'Reading the transcript…' : 'Video title'}
                  disabled={draft.isPending}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Label htmlFor="yt-description">Description</Label>
                  <span className={`text-3xs tabular-nums ${descOver ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                    {description.length} / {YOUTUBE_DESCRIPTION_MAX}
                  </span>
                </div>
                <Textarea
                  id="yt-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={8}
                  placeholder={draft.isPending ? 'Reading the transcript…' : 'Video description'}
                  disabled={draft.isPending}
                />
                <p className="text-2xs text-muted-foreground">
                  {draft.isPending ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon as={Loader2} size="xs" className="animate-spin" />
                      Drafting from what is said in the video…
                    </span>
                  ) : noTranscript ? (
                    'This video has no transcript, so there was nothing to draft from — write the description yourself.'
                  ) : chapterCount > 0 ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon as={Sparkles} size="xs" className="text-primary" />
                      Drafted from the transcript, with {chapterCount} chapters.
                    </span>
                  ) : (
                    'Drafted from the transcript. Rewrite anything.'
                  )}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Visibility</Label>
                <div className="flex w-fit overflow-hidden rounded-md border" role="group" aria-label="Visibility">
                  {VISIBILITIES.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVisibility(v.id)}
                      aria-pressed={visibility === v.id}
                      className={`px-3.5 py-1.5 text-xs border-r last:border-r-0 transition-colors ${
                        visibility === v.id
                          ? 'bg-primary text-primary-foreground font-semibold'
                          : 'text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={publish.isPending}>
            {sizeOk ? 'Cancel' : 'Close'}
          </Button>
          {sizeOk && (
            <Button onClick={() => publish.mutate()} disabled={!canPublish} className="gap-1.5">
              {publish.isPending && <Icon as={Loader2} size="sm" className="animate-spin" />}
              {publish.isPending ? 'Sending…' : 'Publish'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
