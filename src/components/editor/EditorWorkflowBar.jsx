import { useState } from 'react'
import {
  Check, CheckCircle2, CalendarClock, ChevronDown, ListPlus, Send,
  Clock, RotateCcw, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useContentWorkflow } from '@/lib/useContentWorkflow'
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

  return (
    <div className="flex items-center gap-2">
      <VoiceChip piece={piece} />

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

      {/* Failed — one-click retry through the same publish path */}
      {status === 'failed' && (
        <Button
          size="sm"
          disabled={wf.publishing}
          loading={wf.publishing}
          onClick={() => wf.publish({})}
          title={piece.publish_error || 'Retry publishing'}
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
          <PublishControl wf={wf} piece={piece} enabled />
        </>
      )}

      {/* Not yet approved — the two-step gate: "Sounds like me" + a disabled,
          visible publish control that lights up once approved. */}
      {canApproveNow && (
        <>
          <Button
            size="sm"
            disabled={wf.statusPending}
            loading={wf.statusPending}
            onClick={wf.approve}
            title="Approve this text — it sounds like you"
          >
            {!wf.statusPending && <Check className="mr-1.5 h-3.5 w-3.5" />}
            Sounds like me
          </Button>
          <PublishControl wf={wf} piece={piece} enabled={false} />
        </>
      )}

      {/* Review-workflow shops: a draft goes to a reviewer first */}
      {!canApproveNow && canSendForReview && (
        <>
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
