import { useState, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  CheckCircle2, XCircle, Send, Loader2,
  ChevronDown, MessageSquare, RotateCcw, ExternalLink, Quote,
  Calendar, Clock, AlertTriangle, Copy, Download, Lock,
  Bot,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StaffChip } from '@/components/StaffChip'
import { PLATFORM_META, STATUS_META } from '@/lib/contentMeta'
import { getStageToken } from '@/lib/stageTokens'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { canDirectPublishPlatform, exportShapeForPlatform, EXPORT_SHAPES } from '@/lib/outputChannels'
import {
  useComments,
  useAddComment,
  useStaff,
  queryKeys,
} from '@/lib/queries'
import { explainPlatformSlot, findScheduleConflict } from '@/lib/scheduleHeuristics'
import { toast } from '@/lib/toast'
import { useContentWorkflow } from '@/lib/useContentWorkflow'
import PostStatusRow from './PostStatusRow'
import StoryCommentsFeed from './StoryCommentsFeed'
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

// Format a Date for an HTML datetime-local input ("YYYY-MM-DDTHH:mm" in local
// time). The native input rejects ISO strings with a Z suffix.
function toLocalDatetimeInput(d) {
  if (!d) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Approval panel helpers ──────────────────────────────────────────────────

// Map content_item.status → canonical story stage so colours stay in sync
// with the stage tokens used everywhere else (StoryCard, StoriesThemesView).
const STATUS_TO_STAGE = {
  draft:     'drafting',
  in_review: 'review',
  approved:  'review',
  scheduled: 'scheduled',
  published: 'published',
}

function StatusBadge({ status }) {
  const sm = STATUS_META[status] || { label: status || '—' }
  const stage = STATUS_TO_STAGE[status]
  const token = stage ? getStageToken(stage) : null
  const badgeClass = token?.badge ?? 'bg-muted text-muted-foreground'
  return <Badge className={`text-xs border-0 ${badgeClass}`}>{sm.label}</Badge>
}

function CommentThread({ pieceId, interviewId }) {
  const qc = useQueryClient()
  // While the newest comment is a human change request Bernard hasn't answered,
  // poll so his reply appears live (within ~one 5-min tick). Stops the moment he
  // replies (newest becomes his comment) or after an 8-min cap so an unanswered
  // request never polls forever.
  const { data: comments = [], isLoading } = useComments(pieceId, {
    refetchInterval: (q) => {
      const list = q.state.data || []
      const last = list[list.length - 1]
      if (!last || last.kind !== 'change_request') return false
      if (Date.now() - new Date(last.created_at).getTime() > 8 * 60_000) return false
      return 20_000
    },
    refetchIntervalInBackground: false,
  })
  const addComment = useAddComment(pieceId)
  const { data: staff = [] } = useStaff()
  const [draft, setDraft] = useState('')

  // When a new Bernard reply lands, refresh the piece so its body + status
  // (draft→in_review) update in place — not just the thread. Skips the initial
  // mount and fires again on each subsequent revision (iterative change requests).
  const bernardCountRef = useRef(null)
  useEffect(() => {
    // Wait for the real fetch — seeding the ref from the [] placeholder would
    // then fire a spurious invalidation on the first loaded render of any piece
    // that already has prior Bernard replies.
    if (isLoading) return
    const n = comments.filter((c) => c.user_id === 'bernard-producer').length
    if (bernardCountRef.current !== null && n > bernardCountRef.current && interviewId) {
      qc.invalidateQueries({ queryKey: queryKeys.stories.detail(interviewId) })
    }
    bernardCountRef.current = n
  }, [comments, isLoading, interviewId, qc])

  // Resolve a comment's author to a human display name. Prefer a matching
  // clinician row (by Clerk user id) so threads read "Q" rather than
  // "drq@withbernard.ai"; fall back to the email local-part.
  const authorLabel = (c) => {
    if (c.user_id === 'bernard-producer') return 'Bernard'
    const match = c.user_id && staff.find((s) => s?.user_id === c.user_id)
    if (match?.name) return match.name
    const email = c.user_email || ''
    return email.includes('@') ? email.split('@')[0] : (email || 'Someone')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!draft.trim()) return
    await addComment.mutateAsync({ body: draft, kind: 'comment' })
    setDraft('')
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Comments</p>

      {isLoading && (
        <div role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}

      {!isLoading && comments.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No comments yet.</p>
      )}

      {comments.map((c) => {
        const isBernard = c.user_id === 'bernard-producer'
        return (
        <div
          key={c.id}
          className={`rounded-md p-2.5 text-xs ${
            c.kind === 'change_request'
              ? 'bg-warning/10 border border-warning/30'
              : isBernard
                ? 'bg-primary/[0.06] border border-primary/25'
                : 'bg-muted/40 border border-border'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            {isBernard && <Bot className="h-3 w-3 text-primary shrink-0" aria-hidden="true" />}
            <span className={`font-medium ${isBernard ? 'text-primary' : 'text-foreground'}`}>{authorLabel(c)}</span>
            <span className="text-muted-foreground">
              {timeAgo(c.created_at)}
            </span>
            {c.kind === 'change_request' && (
              <span className="ml-auto text-warning font-medium">Change request</span>
            )}
            {isBernard && (
              <span className="ml-auto text-primary/70 font-medium">Producer</span>
            )}
          </div>
          <p className="text-foreground/90 whitespace-pre-wrap leading-relaxed">{c.body}</p>
        </div>
        )
      })}

      <form onSubmit={handleSubmit} className="flex gap-2 pt-1">
        <textarea
          aria-label="Add a comment"
          className="flex-1 text-xs rounded border border-border bg-background px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 min-h-[56px]"
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
          className="self-end"
        >
          {addComment.isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <MessageSquare className="h-3 w-3" aria-hidden="true" />}
        </Button>
      </form>
    </div>
  )
}

// Gather every scheduled content_item the React Query cache has seen, across
// all stories lists. Used by the approve action sheet to (a) feed the
// platform-aware suggestion engine so it skips slots within 2h of another
// post, and (b) soft-warn when the user picks a custom time near another
// scheduled post on the same platform. Free when Stories has already loaded.
function formatScheduledLabel(d) {
  if (!d) return ''
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Export action sheet — the DEFAULT path for any workspace/channel without a
// wired direct-publish integration (per the export-first model: everything
// exports; "Publish" is the upgrade that unlocks when an integration is
// connected). Offers copy + download affordances keyed off the channel's
// exportShape: markdown for blog, HTML for email, caption + image for social.
function ExportCard({ piece }) {
  const shape = exportShapeForPlatform(piece.platform)
  const body = typeof piece.content === 'string' ? piece.content : JSON.stringify(piece.content, null, 2)
  const imageUrl = Array.isArray(piece.media_urls) && piece.media_urls[0]?.url ? piece.media_urls[0].url : null

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error('Copy failed — select and copy manually')
    }
  }

  const copyLabel = shape === EXPORT_SHAPES.MARKDOWN ? 'Copy markdown'
    : shape === EXPORT_SHAPES.HTML_EMAIL ? 'Copy HTML'
    : 'Copy caption'

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Download className="h-3.5 w-3.5" />
        Export
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => copy(body, copyLabel.replace('Copy ', '').replace(/^\w/, (c) => c.toUpperCase()))}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Copy className="h-3.5 w-3.5 mr-1.5" />
          {copyLabel}
        </Button>
        {shape === EXPORT_SHAPES.SOCIAL_COMPOSE && imageUrl && (
          <Button asChild size="sm" variant="outline">
            <a href={imageUrl} download target="_blank" rel="noopener noreferrer">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download image
            </a>
          </Button>
        )}
      </div>
      <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          Paste into your tool of choice. Direct publishing unlocks for this
          channel once an integration is connected.
        </span>
      </p>
    </div>
  )
}

// Action sheet shown on approved pieces. Replaces the old toggle-group +
// Publish button with a primary suggested-time CTA, an explainer caption,
// and inline alt actions (pick a time / publish now). Blog pieces collapse
// to a single "Publish to website" button since the WP path is synchronous.
//
// bufferUseQueue: when true (workspace.buffer_use_queue), the primary CTA
// flips to "Add to Buffer queue" — Buffer picks the next open slot from the
// channel's own posting schedule. The explainer + heuristic suggestion are
// hidden in this mode; "Pick a specific time" remains available as an alt.
//
// prefsOverride: workspace.schedule_prefs JSONB — replaces the global
// PLATFORM_SCHEDULE_PREFS for the explainer caption when present.
function WhenToPublishCard({
  piece, suggested, otherScheduled,
  bufferUseQueue, prefsOverride,
  onSchedule, onPublishToQueue, onPublishNow,
  onSendToBeehiiv, beehiivPublishing,
  publishing,
}) {
  const [mode, setMode] = useState('default') // 'default' | 'pick'
  const [customAt, setCustomAt] = useState(
    suggested ? toLocalDatetimeInput(suggested) : '',
  )

  const explainer = explainPlatformSlot(piece.platform, prefsOverride)
  const customDate = customAt ? new Date(customAt) : null
  const customConflict = customDate && !Number.isNaN(customDate.getTime())
    ? findScheduleConflict(piece.platform, customDate, otherScheduled)
    : null
  const customInPast = customDate && customDate.getTime() <= Date.now()

  // Blog: synchronous publish, no scheduling choice. Beehiiv is offered as an
  // optional secondary destination — it creates a draft and pops Beehiiv open
  // in a new tab for final review. Independent of the website publish, so a
  // tenant can do either, both, or neither.
  if (piece.platform === 'blog') {
    return (
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Publish</div>
        <Button
          size="sm"
          onClick={onPublishNow}
          disabled={publishing || beehiivPublishing}
          loading={publishing}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {!publishing && <Send className="h-3.5 w-3.5 mr-1.5" />}
          Publish to Website
        </Button>
        <p className="text-xs text-muted-foreground">
          Publishes immediately — the website webhook can take 30–90s.
        </p>
        {onSendToBeehiiv && (
          <div className="pt-2 mt-1 border-t border-muted-foreground/10 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <button
              type="button"
              onClick={onSendToBeehiiv}
              disabled={publishing || beehiivPublishing}
              className="text-primary hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {beehiivPublishing ? 'Sending to Beehiiv…' : 'Also send draft to Beehiiv'}
            </button>
            <span className="text-muted-foreground">
              Creates a draft — finish the send in Beehiiv.
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        When to publish
      </div>

      {mode === 'default' && (
        <>
          {bufferUseQueue ? (
            <>
              <Button
                size="sm"
                onClick={onPublishToQueue}
                disabled={publishing}
                loading={publishing}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {!publishing && <Calendar className="h-3.5 w-3.5 mr-1.5" />}
                Add to queue
              </Button>
              <p className="text-xs text-muted-foreground">
                This will slot into the next open spot on your channel&rsquo;s queue.
              </p>
            </>
          ) : suggested ? (
            <>
              <Button
                size="sm"
                onClick={() => onSchedule(suggested)}
                disabled={publishing}
                loading={publishing}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {!publishing && <Calendar className="h-3.5 w-3.5 mr-1.5" />}
                Schedule for {formatScheduledLabel(suggested)}
              </Button>
              {explainer && (
                <p className="text-xs text-muted-foreground">
                  {explainer}. Avoids slots within 2h of another scheduled post.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              No open slot found in the next 60 days — pick a time below.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs pt-1">
            <button
              type="button"
              onClick={() => setMode('pick')}
              disabled={publishing}
              className="text-primary hover:underline"
            >
              {bufferUseQueue ? 'Pick a specific time' : 'Pick a different time'}
            </button>
            {!bufferUseQueue && (
              <>
                <span className="text-muted-foreground">•</span>
                <button
                  type="button"
                  onClick={onPublishToQueue}
                  disabled={publishing}
                  className="text-primary hover:underline"
                >
                  Add to queue
                </button>
              </>
            )}
            <span className="text-muted-foreground">•</span>
            <button
              type="button"
              onClick={onPublishNow}
              disabled={publishing}
              className="text-primary hover:underline"
            >
              Publish now
            </button>
          </div>
        </>
      )}

      {mode === 'pick' && (
        <div className="space-y-2">
          <Input
            type="datetime-local"
            value={customAt}
            onChange={(e) => setCustomAt(e.target.value)}
            aria-label="Schedule date and time"
            min={toLocalDatetimeInput(new Date(Date.now() + 60_000))}
            className="h-8 text-sm w-fit"
          />
          {customConflict && (
            <div className="flex items-start gap-1.5 text-xs text-warning bg-warning/10 border border-warning/30 rounded px-2 py-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Another {PLATFORM_META[piece.platform]?.label || piece.platform} post is scheduled near this time
                {' — '}
                {formatScheduledLabel(new Date(customConflict.scheduled_at))}.
                You can still proceed.
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                const d = new Date(customAt)
                if (!customAt || Number.isNaN(d.getTime())) {
                  toast.error('Pick a valid date and time')
                  return
                }
                if (d.getTime() <= Date.now()) {
                  toast.error('Pick a time in the future')
                  return
                }
                onSchedule(d)
              }}
              disabled={publishing || !customAt || customInPast}
              loading={publishing}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {!publishing && <Calendar className="h-3.5 w-3.5 mr-1.5" />}
              Schedule
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMode('default')
                setCustomAt(suggested ? toLocalDatetimeInput(suggested) : '')
              }}
              disabled={publishing}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// mode='publish' is the only live caller as of the story-monitor redesign
// (StoryComposer, UnifiedEditor, StoryboardPublish) — schedule/publish/export
// actions + scheduled/published state, plus Approve (draft+skipReview or
// in_review) and Unapprove. mode='workflow' (the default) has no remaining
// caller: AssetsPane (the Stories-step monitor) used to render it for the
// earlier review-only stage (send-for-review/request-changes/comments), but
// that moved to the monitor itself (PostStatusRow's RequestChangesControl +
// StoryCommentsFeed) so publishing is never triggered from a screen that
// only shows raw text. The `!isPublish` branches below are therefore dead
// code kept for now rather than risk a cross-file `mode` removal across the
// 3 live callers in the same PR that rebuilt the monitor — worth deleting in
// a followup once nothing depends on the distinction.
export function ApprovalPanel({ piece, mode = 'workflow' }) {
  const isPublish = mode === 'publish'
  const { canReview } = useUserRole()
  const workspace = useWorkspace()
  const skipReview = !!workspace?.skip_review
  const addComment = useAddComment(piece.id)
  const { data: staffList = [] } = useStaff()

  const [changeRequestOpen, setChangeRequestOpen] = useState(false)
  const [changeRequestBody, setChangeRequestBody] = useState('')

  // Approve / send-for-review / publish / schedule / queue / beehiiv / cancel
  // all run through the shared workflow hook — the SAME orchestration the editor
  // header bar (EditorWorkflowBar) uses, so the two publish surfaces can never
  // diverge (the recurring publish-path-divergence bug class). This component
  // owns only the review-workflow extras (comments + the change-request form).
  const wf = useContentWorkflow(piece)
  const updateStatus = wf.updateStatus
  const { publishing, beehiivPublishing, suggested, otherScheduled, prefsOverride } = wf
  const handleSendForReview = wf.sendForReview
  const handleApprove = wf.approve
  const handleUnapprove = wf.unapprove
  const handlePublish = wf.publish
  const handleSendToBeehiiv = wf.sendToBeehiiv
  const handleCancelScheduled = wf.cancelScheduled

  const handleRequestChanges = async (e) => {
    e.preventDefault()
    if (!changeRequestBody.trim()) return
    try {
      await addComment.mutateAsync({ body: changeRequestBody, kind: 'change_request' })
      await updateStatus.mutateAsync({ id: piece.id, status: 'draft' })
      setChangeRequestBody('')
      setChangeRequestOpen(false)
    } catch (err) {
      toast.error('Failed to submit change request', { description: err.message })
    }
  }

  const isBusy = updateStatus.isPending || addComment.isPending

  const provSummary = piece.provenance?.summary
  const ownWordsPct  = provSummary ? provSummary.verbatim_pct + provSummary.paraphrase_pct : null
  const echoCount    = provSummary?.voice_phrase_echo_count ?? 0
  // verbatim_count isn't on summary today — derive from blocks. Same shape
  // as if it were precomputed, so we can swap to summary.verbatim_count later
  // without touching the render path.
  const verbatimCount = provSummary
    ? piece.provenance?.blocks?.filter((b) => b.source_type === 'verbatim').length ?? 0
    : 0

  // Approver display: the API only ever writes piece.approved_by as the
  // approver's raw Clerk user id (db/content.js sets it server-side from
  // auth.userId, ignoring any client-supplied value) — it is never an email
  // or a name. Resolve it to a human name via the workspace staff list
  // (staff.user_id is bound to the same Clerk id — see ensure-self.js) and
  // show a StaffChip when the approver is a clinician; fall back to the raw
  // id only if no staff row matches (e.g. the row was since deleted).
  const approverStaff = staffList.find((s) => s.user_id === piece.approved_by)
  const approverName = approverStaff?.name || piece.approved_by

  return (
    <div className="mt-3 pt-3 border-t space-y-3">
      {/* Voice-drift scorecard — sourced from provenance.summary (PR1 substrate) */}
      {provSummary && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {verbatimCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-success/10 text-success border border-success/30 font-medium">
              <Quote className="h-3 w-3" aria-hidden="true" />
              {verbatimCount} verbatim phrase{verbatimCount === 1 ? '' : 's'} preserved
            </span>
          )}
          <span className="inline-flex items-center rounded-full bg-success/10 border border-success/30 px-2 py-0.5 text-xs text-success">
            {ownWordsPct}% in clinician&rsquo;s voice
          </span>
          {(provSummary.prior_corpus_pct ?? 0) > 0 && (
            <span className="inline-flex items-center rounded-full bg-info/10 border border-info/20 px-2 py-0.5 text-xs text-info">
              {provSummary.prior_corpus_pct}% drew on your prior work
            </span>
          )}
          {echoCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-xs text-primary">
              {echoCount} phrase{echoCount === 1 ? '' : 's'} echo prior work
            </span>
          )}
          {provSummary.synthesis_pct > 40 && (
            <span className="inline-flex items-center rounded-full bg-warning/10 border border-warning/30 px-2 py-0.5 text-xs text-warning">
              {provSummary.synthesis_pct}% model-invented — read closely
            </span>
          )}
        </div>
      )}

      {/* Status + audit trail */}
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={piece.status} />
        {piece.approved_by && piece.approved_at && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            Approved by
            {approverStaff
              ? <StaffChip name={approverName} id={approverStaff.id} size="sm" showName />
              : <span>{approverName}</span>
            }
            <span>on{' '}
              {new Date(piece.approved_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </span>
        )}
      </div>

      {/* When-to-publish action sheet — shown on approved pieces. The reviewer
          can accept the suggested time (one click), pick a custom time, or
          publish immediately. Blog pieces collapse to a single Publish button
          since the website webhook is synchronous. */}
      {isPublish && piece.status === 'approved' && canReview && (
        canDirectPublishPlatform(workspace, piece.platform, workspace?.connected_publish_services) ? (
          <WhenToPublishCard
            piece={piece}
            suggested={suggested}
            otherScheduled={otherScheduled}
            bufferUseQueue={!!workspace?.buffer_use_queue && piece.platform !== 'blog'}
            prefsOverride={prefsOverride}
            onSchedule={(d) => handlePublish({ scheduledAt: d })}
            onPublishToQueue={() => handlePublish({ useQueue: true })}
            onPublishNow={() => handlePublish({})}
            onSendToBeehiiv={piece.platform === 'blog' ? handleSendToBeehiiv : undefined}
            beehiivPublishing={beehiivPublishing}
            publishing={publishing}
          />
        ) : (
          // Default path — no wired integration for this channel. Export-first.
          <ExportCard piece={piece} />
        )
      )}

      {/* Scheduled state — shows the scheduled time + Cancel button so the
          reviewer can pull the post out of the queue and pick a different
          time (or unapprove). Only valid for Buffer/bundle-dispatched platforms;
          blog publishes don't go through this state. */}
      {isPublish && piece.status === 'scheduled' && canReview && piece.platform !== 'blog' && (
        <div className="rounded-lg border bg-primary/5 border-primary/20 p-3 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Calendar className="h-3.5 w-3.5" />
            Scheduled
          </div>
          {piece.scheduled_at && (
            <p className="text-sm font-medium text-foreground">
              {new Date(piece.scheduled_at).toLocaleString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancelScheduled}
              disabled={publishing || !piece.buffer_update_id}
              loading={publishing}
              className="border-warning/30 text-warning hover:bg-warning/10"
            >
              {!publishing && <XCircle className="h-3.5 w-3.5 mr-1.5" />}
              Cancel scheduled post
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Removes the post from the queue and returns this piece to Approved so you can pick a new time or unapprove.
          </p>
        </div>
      )}

      {/* Failed state — bundle.social rejected the post on the network. Shows the
          reason + a one-click Retry that re-dispatches the piece as-is through the
          shared publish path (creates a fresh bundle post; status flips off
          'failed'). Manual only — Bernard never silently re-sends (Q's call). */}
      {piece.status === 'failed' && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            Failed to publish
          </div>
          {piece.publish_error && (
            <p className="text-sm text-foreground/80 leading-snug">{piece.publish_error}</p>
          )}
          {piece.updated_at && (
            <p className="text-xs text-muted-foreground">
              Detected {new Date(piece.updated_at).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
          {canReview && (
            <div className="flex flex-wrap gap-2 pt-0.5">
              <Button
                size="sm"
                onClick={() => handlePublish({})}
                disabled={publishing}
                loading={publishing}
              >
                {!publishing && <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
                Retry now
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {/* Send for review — all roles, only on draft, only when review workflow is on */}
        {!isPublish && piece.status === 'draft' && !skipReview && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleSendForReview}
            disabled={isBusy}
            loading={isBusy && updateStatus.isPending}
          >
            {!(isBusy && updateStatus.isPending) && <Send className="h-3.5 w-3.5 mr-1.5" />}
            Send for review
          </Button>
        )}

        {/* Approve — on draft when workspace skips the review step, or on in_review */}
        {((piece.status === 'draft' && skipReview && canReview) ||
          (piece.status === 'in_review' && canReview)) && (
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={isBusy}
            loading={isBusy && updateStatus.isPending}
          >
            {!(isBusy && updateStatus.isPending) && <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
            Approve
          </Button>
        )}

        {/* Unapprove — reviewer only, while still on approved (pre-Buffer). Once
            the piece is scheduled or published the post lives on Buffer and the
            undo path is Cancel scheduled / Delete published, not Unapprove. In
            the workflow (Words) view the Undo lives in the handoff banner above,
            so this standalone button only renders in the publish view. */}
        {isPublish && piece.status === 'approved' && canReview && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleUnapprove}
            disabled={isBusy}
            loading={isBusy && updateStatus.isPending}
            className="border-warning/30 text-warning hover:bg-warning/10"
          >
            {!(isBusy && updateStatus.isPending) && <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
            Unapprove
          </Button>
        )}

        {/* Request changes — reviewer only, in_review */}
        {!isPublish && piece.status === 'in_review' && canReview && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setChangeRequestOpen((v) => !v)}
            disabled={isBusy}
          >
            <XCircle className="h-3.5 w-3.5 mr-1.5 text-warning" />
            Request changes
            <ChevronDown className={`h-3 w-3 ml-1 transition-transform ${changeRequestOpen ? 'rotate-180' : ''}`} />
          </Button>
        )}

        {/* Published state — no further action available */}
        {piece.status === 'published' && (
          <div className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Button
              size="sm"
              variant="outline"
              disabled
              className="border-success/30 bg-success/10 text-success cursor-default opacity-100"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              {piece.platform === 'blog' ? 'Published to Website' : 'Published'}
            </Button>
            {piece.published_at && (
              <span className="text-xs text-muted-foreground">
                {new Date(piece.published_at).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: new Date(piece.published_at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>
        )}

        {/* Live link — shown once the website publish round-trip captures a URL */}
        {piece.status === 'published' && piece.platform === 'blog' && piece.resolved_url && (
          <a
            href={piece.resolved_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline self-center"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View live post
          </a>
        )}
      </div>



      {/* Change request inline form */}
      {!isPublish && changeRequestOpen && (
        <form onSubmit={handleRequestChanges} className="space-y-2">
          <textarea
            aria-label="Describe what needs to change"
            className="w-full text-xs rounded border border-warning/30 bg-warning/10 px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-warning/50 min-h-[72px]"
            placeholder="Describe what needs to change…"
            value={changeRequestBody}
            onChange={(e) => setChangeRequestBody(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!changeRequestBody.trim() || isBusy}
              loading={isBusy}
              className="border-warning/40 text-warning hover:bg-warning/10"
            >
              Submit request
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setChangeRequestOpen(false)
                setChangeRequestBody('')
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {/* Comment thread — review surface; lives with the words workflow. */}
      {!isPublish && <CommentThread pieceId={piece.id} interviewId={piece.interview_id} />}
    </div>
  )
}

// ── AssetsPane ──────────────────────────────────────────────────────────────
//
// AssetsPane is the per-story MONITOR — review and watch, not compose and
// publish. It shows the keystone words-approval state, then every post as a
// status row (channel, state, a rendered preview, and once published, its
// performance + Mark as winner). Nothing here can edit words, regenerate,
// approve-to-publish, retry, or schedule — every verb that changes or sends
// a post lives behind "Open in editor" on its row (PostStatusRow). See
// .claude/mockups/story-monitor-redesign.html + .claude/story-monitor-redesign-plan.md.

// Keystone bar — Phase 1 ships a STATIC, derived-only read of what already
// happened (no gate, no action yet), since interviews.words_approved_at
// doesn't exist until Phase 3 adds the real approve/pending flow + a
// dedicated words screen. This just tells the truth in the meantime.
function KeystoneBar({ pieces }) {
  const anyApproved = pieces.some((p) => (
    p.approved_by || ['approved', 'scheduled', 'published'].includes(p.status)
  ))
  return (
    <div className={`flex items-center gap-3 rounded-lg border p-3.5 ${
      anyApproved ? 'border-primary/20 bg-primary/5' : 'border-dashed bg-muted/40'
    }`}
    >
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
        anyApproved
          ? 'bg-primary text-primary-foreground'
          : 'border-2 border-dashed border-muted-foreground/40 text-muted-foreground'
      }`}
      >
        {anyApproved ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <span className="text-xs font-bold">1</span>}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">
          {anyApproved ? 'Words approved' : 'Words not yet reviewed'}
        </p>
        <p className="text-xs text-muted-foreground">
          Validates the clinician&rsquo;s voice — every post below is written from these words.
        </p>
      </div>
    </div>
  )
}

export default function AssetsPane({
  story,
  className = '',
}) {
  const workspace = useWorkspace()
  const [searchParams] = useSearchParams()
  const pieceParam = searchParams.get('piece')

  // Filter to channels active in this story's plan (selected_outputs
  // overrides workspace enabled_outputs; fall back to showing all if
  // unknown), but always include a piece being linked to directly even if
  // its platform was filtered — otherwise a direct ?piece= link to a stray
  // atom draft would silently show nothing. Sort so series parts appear in
  // series_part order (the content API returns rows by created_at.desc).
  const pieces = useMemo(() => {
    const base = story?.pieces ?? []
    const activeChannels = story?.selected_outputs ?? workspace?.enabled_outputs ?? null
    const filtered = activeChannels
      ? base.filter((p) => activeChannels.includes(p.platform))
      : base
    const withParam = (pieceParam && !filtered.some((p) => p.id === pieceParam))
      ? [...filtered, ...(base.filter((p) => p.id === pieceParam))]
      : filtered
    return [...withParam].sort((a, b) => {
      if (a.series_id && a.series_id === b.series_id) {
        return (a.series_part || 0) - (b.series_part || 0)
      }
      return 0
    })
  }, [story?.pieces, story?.selected_outputs, workspace?.enabled_outputs, pieceParam])

  if (pieces.length === 0) {
    return (
      <div className={`rounded-xl border bg-card p-4 space-y-3 ${className}`}>
        <p className="text-sm text-muted-foreground">
          No content pieces yet. Generate content from the interview to see it here.
        </p>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border bg-card p-4 space-y-4 ${className}`}>
      <KeystoneBar pieces={pieces} />

      <div className="space-y-2">
        <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          Posts <span className="font-mono normal-case">· {pieces.length}</span>
        </p>
        {pieces.map((piece) => (
          <PostStatusRow key={piece.id} piece={piece} />
        ))}
      </div>

      <StoryCommentsFeed pieces={pieces} />
    </div>
  )
}
