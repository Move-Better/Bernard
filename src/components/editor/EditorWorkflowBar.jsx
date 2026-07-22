import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Check, CheckCircle2, CalendarClock, ChevronDown, ListPlus, Send,
  Clock, RotateCcw, XCircle, Lock, ThumbsDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useContentWorkflow } from '@/lib/useContentWorkflow'
import { useInterview } from '@/lib/queries'
import { captionOverage, CAPTION_LIMITS, PLATFORM_META } from '@/lib/contentMeta'
import VoiceChip from './VoiceChip'

// EditorWorkflowBar — approve, voice-check, and publish, inline in the editor's
// top bar so nothing needs a modal or a rail tab or backing out to another
// screen (Q, 2026-07-08). Design forks, all confirmed:
//   • Voice score + approve shown together — the passive VoiceChip (Bernard's
//     read) next to the "Sounds like me" approval (the human sign-off).
//   • Two visible steps — the publish control sits right there but stays
//     disabled until the piece is approved, keeping the review gate.
//   • Publish default = Schedule (suggested slot); queue / now in the menu.
//
// All actions run through useContentWorkflow — the SAME orchestration the full
// ApprovalPanel uses — so the two surfaces can never diverge.

function formatSlot(d) {
  if (!d) return ''
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function formatWhen(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })
}

// The Schedule / Add to queue / Publish now split-button. Disabled (but visible)
// until the piece is approved — that's the deliberate two-step gate.
function PublishControl({ wf, piece, enabled }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isBlog = piece.platform === 'blog'
  const busy = wf.publishing

  // Export-only channel (no wired integration): approve still works here, but
  // the export affordances live in the full Publish panel (rail / modal).
  if (!isBlog && !wf.canDirectPublish) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled
        title="This channel exports — use the Publish panel to copy the caption and download the media."
      >
        <Send className="mr-1.5 h-3.5 w-3.5" />
        Export in panel
      </Button>
    )
  }

  if (isBlog) {
    return (
      <Button
        size="sm"
        disabled={!enabled || busy}
        loading={busy}
        onClick={() => wf.publish({})}
        className="bg-action text-action-foreground hover:bg-action/90"
        title={enabled ? 'Publish to your website' : 'Approve first'}
      >
        {!busy && <Send className="mr-1.5 h-3.5 w-3.5" />}
        Publish to website
      </Button>
    )
  }

  const slotLabel = wf.suggested ? formatSlot(wf.suggested) : null

  return (
    <div className="relative inline-flex">
      <div className="inline-flex items-stretch">
        <Button
          size="sm"
          disabled={!enabled || busy}
          loading={busy}
          onClick={() => wf.publish({ scheduledAt: wf.suggested })}
          className="rounded-r-none bg-action text-action-foreground hover:bg-action/90"
          title={enabled ? (slotLabel ? `Schedule for ${slotLabel}` : 'Schedule') : 'Approve first'}
        >
          {!busy && <CalendarClock className="mr-1.5 h-3.5 w-3.5" />}
          Schedule
          {slotLabel && <span className="ml-1 hidden font-normal opacity-90 md:inline">· {slotLabel}</span>}
        </Button>
        <button
          type="button"
          disabled={!enabled || busy}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Publish options"
          className="inline-flex items-center rounded-r-md border-l border-black/15 bg-action px-1.5 text-action-foreground hover:bg-action/90 disabled:pointer-events-none disabled:opacity-50"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {menuOpen && enabled && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
            <MenuItem
              icon={CalendarClock}
              title={slotLabel ? `Schedule for ${slotLabel}` : 'Schedule'}
              sub="Bernard’s suggested slot for this channel"
              onClick={() => { setMenuOpen(false); wf.publish({ scheduledAt: wf.suggested }) }}
            />
            <MenuItem
              icon={ListPlus}
              title="Add to queue"
              sub="Drop into the next open posting slot"
              onClick={() => { setMenuOpen(false); wf.publish({ useQueue: true }) }}
            />
            <div className="my-1 h-px bg-border" />
            <MenuItem
              icon={Send}
              title="Publish now"
              sub="Send it live immediately"
              onClick={() => { setMenuOpen(false); wf.publish({}) }}
            />
          </div>
        </>
      )}
    </div>
  )
}

// T4 learning loop — reject with a reason instead of silently deleting or
// ignoring a wrong draft. Reason is required (fixed enum, mirrors the server's
// REJECT_REASONS in api/_routes/db/content.js); note is an optional detail.
const REJECT_REASONS = [
  { value: 'wrong_visuals', label: 'Wrong visuals' },
  { value: 'wrong_words', label: 'Wrong words' },
  { value: 'wrong_topic', label: 'Wrong topic' },
  { value: 'wrong_timing', label: 'Wrong timing' },
  { value: 'other', label: 'Other' },
]

function RejectControl({ wf }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(null)
  const [note, setNote] = useState('')
  const busy = wf.statusPending

  const submit = async () => {
    if (!reason) return
    await wf.reject(reason, note)
    setOpen(false)
    setReason(null)
    setNote('')
  }

  return (
    <div className="relative inline-flex">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />
        Reject
      </Button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 z-50 mt-9 w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg">
            <div className="mb-2 text-xs font-semibold text-foreground">Why doesn&rsquo;t this work?</div>
            <div className="mb-2 flex flex-col gap-1">
              {REJECT_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setReason(r.value)}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
                    reason === r.value ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <span className={`h-3 w-3 shrink-0 rounded-full border ${reason === r.value ? 'border-primary bg-primary' : 'border-border'}`} />
                  {r.label}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note — what would make this right?"
              rows={2}
              className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                size="sm"
                disabled={!reason || busy}
                loading={busy}
                onClick={submit}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Reject
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({ icon: Icon, title, sub, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-accent"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>
        <span className="block text-xs font-semibold text-foreground">{title}</span>
        <span className="block text-2xs text-muted-foreground">{sub}</span>
      </span>
    </button>
  )
}

export default function EditorWorkflowBar({ piece }) {
  const wf = useContentWorkflow(piece)
  const status = piece?.status || 'draft'

  const canApproveNow =
    (status === 'draft' && wf.skipReview && wf.canReview) ||
    (status === 'in_review' && wf.canReview)
  const canSendForReview = status === 'draft' && !wf.skipReview && wf.canReview

  // Words-approval gate (Phase 3, story-monitor redesign) — mirrors the
  // server-side check in api/_lib/wordsApprovalGate.js so publish/retry are
  // visibly disabled with a reason instead of a raw 403. The real
  // enforcement lives server-side; this is a UX nicety, not the boundary —
  // so default to NOT blocking while the interview is still loading rather
  // than flash-disabling the button on every editor open.
  const { data: interview, isLoading: interviewLoading } = useInterview(piece?.interview_id)
  const wordsGateBlocked = !interviewLoading && !!piece?.interview_id && !interview?.words_approved_at

  // Caption-length gate — same shape as the words gate above: the boundary is
  // the server (checkCaptionCap in api/_lib/socialLengthTargets.js, enforced on
  // the approve route), this just makes the reason visible instead of letting
  // Approve fail on click. Approving an over-cap caption used to succeed and
  // then die at the network hours later with the post simply never appearing.
  const captionOver = captionOverage(piece?.platform, piece?.content)
  const captionLabel = PLATFORM_META[piece?.platform]?.label || piece?.platform

  return (
    <div className="flex flex-wrap items-center gap-2">
      <VoiceChip piece={piece} />

      {/* Only the states where Publish/Retry actually matters — the gate
          doesn't block approving-to-publish or sending-for-review, so no
          banner there (see the file-level comment above). */}
      {wordsGateBlocked && (status === 'failed' || status === 'approved') && (
        <Link
          to={`/stories/${piece.interview_id}/words`}
          className="inline-flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs font-medium text-warning hover:bg-warning/20"
          title="This story's words haven't been approved yet — publishing is blocked until they are."
        >
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          Approve the story&rsquo;s words first
        </Link>
      )}

      {/* Published — terminal state */}
      {status === 'published' && (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Published
          {piece.published_at && (
            <span className="font-normal text-muted-foreground">· {formatWhen(piece.published_at)}</span>
          )}
        </span>
      )}

      {/* Rejected — terminal, but reversible (misclick recovery). T4 learning
          loop: the reason + note are captured server-side for the weekly
          "Bernard learned" digest; nothing more to do here. */}
      {status === 'rejected' && (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs font-semibold text-destructive">
          <ThumbsDown className="h-3.5 w-3.5" />
          Rejected
          {piece.reject_reason && (
            <span className="font-normal opacity-80">
              · {REJECT_REASONS.find((r) => r.value === piece.reject_reason)?.label || piece.reject_reason}
            </span>
          )}
          {wf.canReview && (
            <button
              type="button"
              onClick={() => wf.updateStatus.mutateAsync({ id: piece.id, status: wf.skipReview ? 'draft' : 'in_review' })}
              disabled={wf.statusPending}
              className="ml-0.5 font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              restore to draft
            </button>
          )}
        </span>
      )}

      {/* Failed — one-click retry through the same publish path */}
      {status === 'failed' && (
        <Button
          size="sm"
          disabled={wf.publishing || wordsGateBlocked}
          loading={wf.publishing}
          onClick={() => wf.publish({})}
          title={wordsGateBlocked ? "Approve the story's words before retrying" : (piece.publish_error || 'Retry publishing')}
          className="bg-action text-action-foreground hover:bg-action/90"
        >
          {!wf.publishing && <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
          Retry
        </Button>
      )}

      {/* Scheduled — show the slot + a Cancel to pull it back to Approved */}
      {status === 'scheduled' && (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-1.5 text-xs font-semibold text-primary">
            <Clock className="h-3.5 w-3.5" />
            Scheduled
            {piece.scheduled_at && (
              <span className="font-normal text-muted-foreground">· {formatWhen(piece.scheduled_at)}</span>
            )}
          </span>
          {wf.canReview && piece.platform !== 'blog' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={wf.publishing || !piece.buffer_update_id}
              loading={wf.publishing}
              onClick={wf.cancelScheduled}
              className="text-warning hover:bg-warning/10 hover:text-warning"
            >
              {!wf.publishing && <XCircle className="mr-1.5 h-3.5 w-3.5" />}
              Cancel
            </Button>
          )}
        </>
      )}

      {/* Approved — the sign-off is done; publish controls are now live */}
      {status === 'approved' && wf.canReview && (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approved
            <button
              type="button"
              onClick={wf.unapprove}
              disabled={wf.statusPending}
              className="ml-0.5 font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              undo
            </button>
          </span>
          <PublishControl wf={wf} piece={piece} enabled={!wordsGateBlocked} />
        </>
      )}

      {/* Not yet approved — the two-step gate: "Sounds like me" + a disabled,
          visible publish control that lights up once approved. */}
      {canApproveNow && (
        <>
          {captionOver > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs font-medium text-warning"
              title={`${captionLabel} captions cap at ${CAPTION_LIMITS[piece.platform]} characters.`}
            >
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              {captionOver} character{captionOver === 1 ? '' : 's'} over the {captionLabel} limit
            </span>
          )}
          <Button
            size="sm"
            disabled={wf.statusPending || captionOver > 0}
            loading={wf.statusPending}
            onClick={wf.approve}
            title={captionOver > 0 ? `Shorten the caption by ${captionOver} characters to approve` : undefined}
          >
            {!wf.statusPending && <Check className="mr-1.5 h-3.5 w-3.5" />}
            Approve
          </Button>
          <RejectControl wf={wf} />
          <PublishControl wf={wf} piece={piece} enabled={false} />
        </>
      )}

      {/* Review-workflow shops: a draft goes to a reviewer first */}
      {!canApproveNow && canSendForReview && (
        <>
          <RejectControl wf={wf} />
          <Button
            size="sm"
            variant="outline"
            disabled={wf.statusPending}
            loading={wf.statusPending}
            onClick={wf.sendForReview}
          >
            {!wf.statusPending && <Send className="mr-1.5 h-3.5 w-3.5" />}
            Send for review
          </Button>
          <PublishControl wf={wf} piece={piece} enabled={false} />
        </>
      )}
    </div>
  )
}
