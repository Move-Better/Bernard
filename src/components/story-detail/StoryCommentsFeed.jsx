import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MessageSquare, Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PLATFORM_META } from '@/lib/contentMeta'
import { useComments, useAddComment, useStaff } from '@/lib/queries'

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Rules of hooks forbid calling useComments once per item in a variable-
// length loop — this child owns one piece's fetch and reports results up to
// the merged feed via a stable callback. Renders nothing itself.
function PieceThreadLoader({ pieceId, onData }) {
  const { data: comments = [] } = useComments(pieceId)
  useEffect(() => {
    onData(pieceId, comments)
  }, [pieceId, comments, onData])
  return null
}

// Comments are stored per-piece (they're load-bearing for Bernard's per-post
// revision loop — see RequestChangesControl), but the monitor shows them as
// ONE merged, chronological feed across every post in the story, each tagged
// with its channel — Decision A from the story-monitor redesign.
export default function StoryCommentsFeed({ pieces }) {
  const [byPiece, setByPiece] = useState({})
  const { data: staff = [] } = useStaff()
  const [targetId, setTargetId] = useState(pieces[0]?.id || null)
  const [draft, setDraft] = useState('')
  const addComment = useAddComment(targetId)

  const handleData = useCallback((pieceId, comments) => {
    setByPiece((prev) => (prev[pieceId] === comments ? prev : { ...prev, [pieceId]: comments }))
  }, [])

  const allLoaded = Object.keys(byPiece).length === pieces.length
  const merged = useMemo(() => {
    return Object.entries(byPiece)
      .flatMap(([pieceId, comments]) => {
        const piece = pieces.find((p) => p.id === pieceId)
        return comments.map((c) => ({ ...c, pieceId, platform: piece?.platform }))
      })
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  }, [byPiece, pieces])

  const authorLabel = (c) => {
    if (c.user_id === 'bernard-producer') return 'Bernard'
    const match = c.user_id && staff.find((s) => s?.user_id === c.user_id)
    if (match?.name) return match.name
    const email = c.user_email || ''
    return email.includes('@') ? email.split('@')[0] : (email || 'Someone')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!draft.trim() || !targetId) return
    await addComment.mutateAsync({ body: draft, kind: 'comment' })
    setDraft('')
  }

  if (pieces.length === 0) return null

  return (
    <div className="space-y-2.5 border-t pt-4">
      {pieces.map((p) => (
        <PieceThreadLoader key={p.id} pieceId={p.id} onData={handleData} />
      ))}

      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Comments</p>

      {!allLoaded && (
        <div role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}

      {allLoaded && merged.length === 0 && (
        <p className="text-xs italic text-muted-foreground">No comments yet.</p>
      )}

      {merged.map((c) => {
        const isBernard = c.user_id === 'bernard-producer'
        const platformMeta = PLATFORM_META[c.platform]
        return (
          <div
            key={c.id}
            className={`rounded-md p-2.5 text-xs ${
              c.kind === 'change_request'
                ? 'border border-warning/30 bg-warning/10'
                : isBernard
                  ? 'border border-primary/25 bg-primary/[0.06]'
                  : 'border border-border bg-muted/40'
            }`}
          >
            <div className="mb-1 flex items-center gap-1.5 flex-wrap">
              {isBernard && <Bot className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />}
              <span className={`font-medium ${isBernard ? 'text-primary' : 'text-foreground'}`}>{authorLabel(c)}</span>
              <span className="text-muted-foreground">{timeAgo(c.created_at)}</span>
              {platformMeta && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-3xs text-muted-foreground">
                  {platformMeta.label}
                </span>
              )}
              {c.kind === 'change_request' && (
                <span className="ml-auto font-medium text-warning">Change request</span>
              )}
            </div>
            <p className="whitespace-pre-wrap leading-relaxed text-foreground/90">{c.body}</p>
          </div>
        )
      })}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 pt-1">
        <select
          aria-label="Comment on"
          value={targetId || ''}
          onChange={(e) => setTargetId(e.target.value)}
          className="h-8 rounded border border-border bg-background px-2 text-xs"
        >
          {pieces.map((p) => (
            <option key={p.id} value={p.id}>
              {PLATFORM_META[p.platform]?.label || p.platform}
            </option>
          ))}
        </select>
        <textarea
          aria-label="Add a comment"
          className="min-h-[36px] flex-1 resize-none rounded border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
          placeholder="Add a comment…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!draft.trim() || addComment.isPending}
          aria-label={addComment.isPending ? 'Submitting comment…' : 'Submit comment'}
        >
          {addComment.isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <MessageSquare className="h-3 w-3" aria-hidden="true" />}
        </Button>
      </form>
    </div>
  )
}
