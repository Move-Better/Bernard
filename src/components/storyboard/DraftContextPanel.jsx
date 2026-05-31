import { X, Play, Image as ImageIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { PLATFORM_META } from '@/lib/contentMeta'
import { mediaKindForPlatform, mediaKindLabel } from '@/lib/platformMediaKind'
import { mediaEntryKey } from '@/lib/mediaEntry'

function firstHeading(content) {
  if (typeof content !== 'string') return ''
  const m = content.match(/^#{1,6}\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

/**
 * DraftContextPanel — the left rail of the Storyboard focused page: what the
 * producer is matching media TO. Shows the draft's topic, platform (+ which
 * media kinds it accepts), the message body, and the currently-attached media
 * with one-click remove. Pinned alongside the candidates so the producer never
 * loses the message while evaluating media.
 */
export default function DraftContextPanel({ piece, onRemoveMedia, removingKey }) {
  const meta = PLATFORM_META[piece?.platform] || { label: piece?.platform || '—' }
  const Icon = meta.icon
  const kindHint = mediaKindLabel(mediaKindForPlatform(piece?.platform))
  const title = piece?.topic || firstHeading(piece?.content) || 'Untitled draft'
  const media = Array.isArray(piece?.media_urls) ? piece.media_urls : []
  const body = typeof piece?.content === 'string' ? piece.content : ''

  return (
    <aside className="space-y-4 lg:sticky lg:top-20">
      <div>
        <p className="text-2xs font-bold uppercase tracking-widest text-muted-foreground">The draft</p>
        <h2 className="mt-1 text-lg font-semibold leading-snug text-foreground">{title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="outline" className="gap-1">
            {Icon && <Icon className="h-3 w-3" />}{meta.label}
          </Badge>
          <span className="text-2xs text-muted-foreground">· {kindHint}</span>
          {piece?.staff_name && <span className="text-2xs text-muted-foreground">· {piece.staff_name}</span>}
        </div>
      </div>

      {/* Currently attached */}
      <div>
        <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Attached {media.length > 0 && <span className="text-foreground/60">({media.length})</span>}
        </p>
        {media.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">Nothing attached yet — pick a match on the right.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {media.map((m) => {
              const isVideo = m.type === 'video' || m.kind === 'video'
              const thumb = m.thumbnailUrl || (!isVideo ? m.url : null)
              const key = mediaEntryKey(m)
              return (
                <div key={key} className="group relative h-16 w-16 overflow-hidden rounded border bg-muted">
                  {thumb ? (
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      {isVideo ? <Play className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveMedia(m)}
                    disabled={removingKey === key}
                    className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100 disabled:opacity-50"
                    title="Remove"
                    aria-label="Remove attached media"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* The message they're matching to */}
      <div>
        <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          The message you’re matching
        </p>
        <div className="max-h-[42vh] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm leading-relaxed text-foreground/90">
          {body || <span className="italic text-muted-foreground">No body text.</span>}
        </div>
      </div>
    </aside>
  )
}
