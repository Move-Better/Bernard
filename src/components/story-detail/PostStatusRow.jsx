import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, ExternalLink, Image as ImageIcon, Video, FileText,
  MessageSquareWarning,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PLATFORM_META, statusMetaFor } from '@/lib/contentMeta'
import { photoSourceUrl, isVideoEntry } from '@/lib/mediaEntry'
import { useAddComment, useUpdateContentItemStatus } from '@/lib/queries'
import { toast } from '@/lib/toast'
import BufferMetricsRow from './BufferMetricsRow'
import GbpInsightsRow from './GbpInsightsRow'
import WinnerToggle from './WinnerToggle'

function formatDateTime(d) {
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function RowThumb({ piece }) {
  const media = Array.isArray(piece.media_urls) ? piece.media_urls : []
  const first = media[0]
  if (first && isVideoEntry(first)) {
    return (
      <div className="flex h-14 w-11 shrink-0 items-center justify-center rounded-md border bg-muted" aria-hidden="true">
        <Video className="h-4 w-4 text-muted-foreground" />
      </div>
    )
  }
  const src = first ? photoSourceUrl(first) : null
  if (src) {
    return <img src={src} alt="" className="h-14 w-11 shrink-0 rounded-md border object-cover" />
  }
  if (['blog', 'email', 'landing_page'].includes(piece.platform)) {
    return (
      <div className="flex h-14 w-11 shrink-0 items-center justify-center rounded-md border bg-muted/60" aria-hidden="true">
        <FileText className="h-4 w-4 text-muted-foreground/50" />
      </div>
    )
  }
  return (
    <div className="flex h-14 w-11 shrink-0 items-center justify-center rounded-md border border-dashed bg-muted/30" aria-hidden="true">
      <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
    </div>
  )
}

function subline(piece) {
  if (piece.status === 'failed') {
    return piece.publish_error || 'Publish failed — open the editor to see why and retry.'
  }
  if (piece.status === 'scheduled' && piece.scheduled_at) {
    const d = new Date(piece.scheduled_at)
    return d < new Date()
      ? `Schedule expired (${formatDateTime(d)}) — repick a time in the editor`
      : `Scheduled for ${formatDateTime(d)}`
  }
  if (piece.status === 'published') {
    const when = piece.published_at || piece.scheduled_at
    return when ? `Published ${formatDateTime(when)}` : 'Published'
  }
  if (piece.status === 'in_review') return 'Waiting on review'
  if (piece.status === 'approved') return 'Ready to publish — not scheduled yet'
  return 'Not scheduled yet'
}

// Request changes — the reviewer's "this needs a redo" verdict on an
// in_review piece. Judging whether a post needs a rewrite is exactly the
// kind of call this monitor screen exists for (no visual editor required),
// so it lives here rather than only inside whichever editor renders the
// piece. Posts a change_request comment (Bernard's revision loop replies to
// it) and resets the piece to draft — same two-step effect the old
// Stories-step "Request changes" button had.
function RequestChangesControl({ piece }) {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const addComment = useAddComment(piece.id)
  const updateStatus = useUpdateContentItemStatus()
  const busy = addComment.isPending || updateStatus.isPending

  if (piece.status !== 'in_review') return null

  const submit = async (e) => {
    e.preventDefault()
    if (!body.trim()) return
    try {
      await addComment.mutateAsync({ body, kind: 'change_request' })
      await updateStatus.mutateAsync({ id: piece.id, status: 'draft' })
      setBody('')
      setOpen(false)
      toast.success('Sent back for changes')
    } catch (e2) {
      toast.error('Could not submit', { description: e2.message })
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-2xs font-medium text-warning hover:underline"
      >
        <MessageSquareWarning className="h-3 w-3" aria-hidden="true" />
        Request changes
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mt-1.5 space-y-1.5 basis-full">
      <textarea
        aria-label="Describe what needs to change"
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Describe what needs to change…"
        className="w-full min-h-[56px] resize-none rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-warning/50"
      />
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" variant="outline" disabled={!body.trim() || busy} loading={busy} className="h-6 border-warning/40 text-2xs text-warning hover:bg-warning/10">
          Submit
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setBody('') }} className="h-6 text-2xs">
          Cancel
        </Button>
      </div>
    </form>
  )
}

// One post's status, at a glance — the atom of the per-story monitor. No
// caption text, no regenerate, no publish/retry button: every verb that
// sends the post lives behind "Open in editor," which is the only place a
// post can actually publish (see the story-monitor-redesign mockup).
export default function PostStatusRow({ piece }) {
  const meta = PLATFORM_META[piece.platform] || { label: piece.platform, icon: FileText, color: 'text-muted-foreground', bg: 'bg-muted' }
  const Icon = meta.icon
  // statusMetaFor, not STATUS_META — a post that was just sent is 'scheduled'
  // for the minute bundle takes to post it, and must read "Publishing…" rather
  // than looking like it sat down in a queue.
  const sm = statusMetaFor(piece)
  const isFailed = piece.status === 'failed'
  const isPublished = piece.status === 'published'
  const seriesLabel = piece.series_id && piece.series_part
    ? ` · Part ${piece.series_part} of ${piece.series_total || '?'}`
    : ''

  return (
    <div className={`flex flex-wrap sm:flex-nowrap items-center gap-3 rounded-lg border p-3 ${isFailed ? 'border-destructive/40 bg-destructive/[0.04]' : 'bg-card'}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${meta.bg}`} aria-hidden="true">
        <Icon className={`h-4 w-4 ${meta.color}`} />
      </div>

      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{meta.label}{seriesLabel}</span>
          <span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${sm.color}`}>{sm.label}</span>
        </div>
        <p className={`mt-0.5 text-xs ${isFailed ? 'text-destructive' : 'text-muted-foreground'}`}>
          {subline(piece)}
          {/* The receipt. Was blog-only because only the website publish path
              recorded a URL; the bundle webhook now records the network's own
              permalink too, so a social post can be checked rather than taken on
              trust. Absent = we don't have a confirmed URL yet, which is why
              nothing renders instead of a broken link. */}
          {isPublished && piece.resolved_url && (
            <a href={piece.resolved_url} target="_blank" rel="noreferrer noopener" className="ml-2 inline-flex items-center gap-1 text-primary hover:underline">
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              View live post
            </a>
          )}
        </p>

        {isPublished && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {piece.buffer_update_id && <BufferMetricsRow contentItemId={piece.id} />}
            {piece.platform === 'gbp' && <GbpInsightsRow contentItemId={piece.id} />}
            <WinnerToggle piece={piece} />
          </div>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <RequestChangesControl piece={piece} />
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3 sm:ml-0">
        <RowThumb piece={piece} />
        <Link
          to={`/publish/${piece.id}`}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium transition-colors ${
            isFailed
              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              : 'border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15'
          }`}
        >
          Open in editor
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
