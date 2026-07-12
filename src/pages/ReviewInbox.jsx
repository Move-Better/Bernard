import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useUser } from '@clerk/react'
import {
  Inbox, Eye, Send, Check, CheckCheck, ChevronRight, Loader2, Image as ImageIcon, Shield,
  CalendarClock, LayoutGrid,
} from 'lucide-react'
import {
  useContentItems, useUpdateContentItemStatus, useUpdateContentItem, useCarouselThemes,
  useStories,
} from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { PLATFORM_META } from '@/lib/contentMeta'
import { BUFFER_DISPATCH_PLATFORMS } from '@/lib/publish'
import { publishPieceToBuffer } from '@/lib/publishPiece'
import { toast } from '@/lib/toast'
import LoadingState from '@/components/LoadingState'
import PageHelp from '@/components/PageHelp'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import StoriesPipelineView from '@/components/stories/StoriesPipelineView'

// A piece "has media" when at least one entry is attached. Mirrors the
// Storyboard NEEDS_MEDIA predicate so the "Open" target stays honest: a piece
// with media jumps to Publish, one without goes to the media picker first.
const HAS_MEDIA = (p) => Array.isArray(p?.media_urls) && p.media_urls.length > 0

function firstHeading(content) {
  if (typeof content !== 'string') return ''
  const m = content.match(/^#{1,6}\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

function daysSince(iso) {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((Date.now() - then) / 86_400_000)
}

function ageLabel(days) {
  if (days == null) return null
  if (days <= 0) return 'today'
  return `${days}d ago`
}

const STALE_DAYS = 7

/**
 * Review Inbox — the producer's single queue (P4).
 *
 * Collapses the three review→publish paths a producer used to juggle (Home
 * task buckets, Stories ?stage=review, and the Storyboard queue + per-piece
 * Publish) into one surface with bulk actions. Phase 1 ships the queue +
 * bulk approve; bulk scheduling + the upgraded shared calendar land in
 * Phase 2 (the calendar lives under Overview, not here).
 *
 * Role-gated to editors (owner / producer / director), exactly like Overview —
 * an individual clinician never sees it.
 */
export default function ReviewInbox() {
  useDocumentTitle('Review Inbox')
  const { user } = useUser()
  const { isEditor, isLoading: roleLoading } = useUserRole()
  const workspace = useWorkspace()
  const updateStatus = useUpdateContentItemStatus()
  const updateItem = useUpdateContentItem()
  const { data: allThemes = [] } = useCarouselThemes()
  const [selected, setSelected] = useState(() => new Set())
  // Bulk-schedule is real outbound (Buffer) — gate it behind an explicit
  // confirm and a busy flag so a producer can't double-fire the batch.
  const [scheduleConfirmOpen, setScheduleConfirmOpen] = useState(false)
  const [scheduling, setScheduling] = useState(false)

  // Both stages of the producer's queue in one fetch: words awaiting sign-off
  // (in_review) and approved pieces waiting to be scheduled (approved).
  const { data: items = [], isLoading } = useContentItems(
    { status: 'in_review,approved' },
    { enabled: !roleLoading && isEditor },
  )
  const { data: stories = [], isLoading: storiesLoading } = useStories({}, { enabled: !roleLoading && isEditor })

  const needsReview = useMemo(
    () =>
      items
        .filter((p) => p.status === 'in_review')
        .slice()
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)),
    [items],
  )
  const readyToSchedule = useMemo(
    () =>
      items
        .filter((p) => p.status === 'approved')
        .slice()
        .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)),
    [items],
  )

  const allIds = useMemo(
    () => [...needsReview, ...readyToSchedule].map((p) => p.id),
    [needsReview, readyToSchedule],
  )

  const userEmail = user?.primaryEmailAddress?.emailAddress || user?.id || ''

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function toggleAll(checked) {
    setSelected(checked ? new Set(allIds) : new Set())
  }
  function clearSel() {
    setSelected(new Set())
  }

  // Pieces in the selection that can still be approved (status in_review).
  // Approving an already-approved piece is a no-op, so the bulk Approve button
  // only acts on — and only counts — the reviewable ones.
  const selectedReviewable = useMemo(
    () => needsReview.filter((p) => selected.has(p.id)),
    [needsReview, selected],
  )

  // Pieces in the selection that can be sent to the Buffer queue: approved,
  // a Buffer-eligible channel (blog/email publish elsewhere), and with media
  // attached (the single-piece path warns on no-media; bulk plays it safe and
  // simply skips those — the producer schedules them individually).
  const selectedSchedulable = useMemo(
    () =>
      readyToSchedule.filter(
        (p) =>
          selected.has(p.id) &&
          BUFFER_DISPATCH_PLATFORMS.includes(p.platform) &&
          HAS_MEDIA(p),
      ),
    [readyToSchedule, selected],
  )

  async function bulkApprove() {
    if (selectedReviewable.length === 0) return
    const n = selectedReviewable.length
    try {
      // Sequential keeps the per-row toast/error attribution clean and avoids a
      // burst of concurrent PATCHes; the queue is small (a producer's daily
      // batch), so latency is not a concern.
      for (const piece of selectedReviewable) {
        await updateStatus.mutateAsync({
          id: piece.id,
          status: 'approved',
          approvedBy: userEmail,
          approvedAt: new Date().toISOString(),
        })
      }
      toast.success(`Approved ${n} piece${n === 1 ? '' : 's'} — ready to schedule`)
      clearSel()
    } catch (err) {
      toast.error('Some approvals failed', { description: err?.message })
    }
  }

  async function quickApprove(piece) {
    try {
      await updateStatus.mutateAsync({
        id: piece.id,
        status: 'approved',
        approvedBy: userEmail,
        approvedAt: new Date().toISOString(),
      })
      toast.success('Approved — ready to schedule')
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(piece.id)
        return next
      })
    } catch (err) {
      toast.error('Failed to approve', { description: err?.message })
    }
  }

  // Role gate — wait for the role to resolve before deciding so we don't bounce
  // an editor mid-load (same pattern as Overview.jsx), AND so a non-editor never
  // sees producer content during the ~300–1000ms role resolution on a warm Clerk
  // session. The data query is also gated on `enabled: !roleLoading && isEditor`
  // so unauthorized users never trigger the fetch. Placed after all hooks so
  // hook order stays stable across renders.
  if (roleLoading) return <LoadingState />

  if (!isEditor) return <Navigate to="/" replace />

  // Bulk "Add to Buffer queue" — loops the SHARED publishPieceToBuffer helper
  // (same path the single-piece ApprovalPanel uses, incl. carousel slide-baking)
  // with useQueue:true so Buffer assigns each slot. Real outbound: confirmed
  // first, sequential to keep attribution clean, and resilient (one failure
  // doesn't abort the batch).
  async function bulkSchedule() {
    if (selectedSchedulable.length === 0) return
    setScheduling(true)
    let ok = 0
    let fail = 0
    // Distinguished from a generic failure so the toast tells the producer
    // WHY, rather than "couldn't be queued" for a story whose words simply
    // haven't been approved yet (api/_lib/wordsApprovalGate.js, Phase 3).
    let wordsBlocked = 0
    for (const piece of selectedSchedulable) {
      try {
        const { scheduledAt, renderedSlides } = await publishPieceToBuffer(piece, {
          useQueue: true,
          userEmail,
          workspace,
          themes: allThemes,
        })
        if (renderedSlides) {
          try {
            await updateItem.mutateAsync({ id: piece.id, patch: { slides: renderedSlides } })
          } catch { /* non-fatal: publish already used the rendered URLs */ }
        }
        await updateStatus.mutateAsync({
          id: piece.id,
          status: 'scheduled',
          approvedBy: userEmail,
          approvedAt: new Date().toISOString(),
          scheduledAt,
        })
        ok++
      } catch (e) {
        if (e?.payload?.error === 'words_not_approved') wordsBlocked++
        else fail++
      }
    }
    setScheduling(false)
    setScheduleConfirmOpen(false)
    if (ok) toast.success(`Added ${ok} post${ok === 1 ? '' : 's'} to the queue`)
    if (wordsBlocked) {
      toast.warning(`${wordsBlocked} skipped — words not approved yet`, {
        description: 'Approve that story’s words on its Story page, then try again.',
      })
    }
    if (fail) toast.error(`${fail} couldn’t be queued`, { description: 'Open them individually to retry.' })
    clearSel()
  }

  if (isLoading) return <LoadingState />

  const total = needsReview.length + readyToSchedule.length
  const allChecked = allIds.length > 0 && allIds.every((id) => selected.has(id))

  return (
    <div className="space-y-5 py-6">
      {/* Header — matches Overview's clinic-wide producer chrome */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Inbox className="h-5 w-5 text-primary" aria-hidden="true" />
            Review Inbox
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One queue for everything waiting on you — review the words, then approve and schedule.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PageHelp pageKey="review-inbox" variant="default" />
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-2xs font-medium text-muted-foreground">
            <Shield className="h-3 w-3" aria-hidden="true" />
            Producer view
          </span>
        </div>
      </div>

      {total === 0 ? (
        <div className="rounded-lg border bg-muted/20 py-12 text-center">
          <Check className="mx-auto h-8 w-8 text-success" />
          <p className="mt-2 text-sm font-medium text-foreground">Your inbox is clear 🎉</p>
          <p className="text-xs text-muted-foreground">
            New pieces show up here when they’re sent for review or approved.
          </p>
        </div>
      ) : (
        <>
          {/* Bulk action bar — appears once anything is selected. Warm-orange
              "act now" treatment matching the publisher-inbox surfaces. */}
          {selected.size > 0 && (
            <div className="sticky top-14 z-30 rounded-xl border border-primary/40 bg-gradient-to-b from-white to-[hsl(var(--primary)/0.05)] shadow-[0_8px_24px_-18px_rgba(12,117,128,0.5)] px-4 py-2.5 flex items-center gap-3">
              <span className="inline-block w-1 h-6 rounded-full bg-primary shrink-0" aria-hidden="true" />
              <span className="text-sm font-bold">{selected.size} selected</span>
              <button
                type="button"
                onClick={bulkApprove}
                disabled={selectedReviewable.length === 0 || updateStatus.isPending}
                className="inline-flex items-center gap-1.5 bg-action text-action-foreground text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updateStatus.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCheck className="h-3.5 w-3.5" />
                )}
                Approve{selectedReviewable.length > 0 ? ` ${selectedReviewable.length}` : ''}
              </button>
              {/* Bulk schedule → Buffer queue. Real outbound, so it opens a
                  confirm first. Only counts the schedulable selection (approved
                  + Buffer-eligible + has media). */}
              {selectedSchedulable.length > 0 && (
                <button
                  type="button"
                  onClick={() => setScheduleConfirmOpen(true)}
                  disabled={scheduling}
                  className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  Add {selectedSchedulable.length} to queue
                </button>
              )}
              <button
                type="button"
                onClick={clearSel}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
          )}

          {/* Select-all */}
          <label className="flex items-center gap-2 text-xs cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(e) => toggleAll(e.target.checked)}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            <span className="font-medium text-foreground">Select all</span>
          </label>

          {/* Needs review — clinician sign-off that it sounds like them */}
          {needsReview.length > 0 && (
            <section className="space-y-2">
              <p className="text-2xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" /> Needs review · {needsReview.length}
                <span className="font-normal normal-case tracking-normal text-muted-foreground">
                  — sign-off that it sounds like them
                </span>
              </p>
              {needsReview.map((piece) => (
                <InboxRow
                  key={piece.id}
                  piece={piece}
                  group="review"
                  checked={selected.has(piece.id)}
                  onToggle={() => toggle(piece.id)}
                  onApprove={() => quickApprove(piece)}
                  busy={updateStatus.isPending}
                />
              ))}
            </section>
          )}

          {/* Approved · ready to schedule */}
          {readyToSchedule.length > 0 && (
            <section className="space-y-2">
              <p className="text-2xs font-bold uppercase tracking-wide text-action flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5" /> Approved · ready to schedule · {readyToSchedule.length}
                <span className="font-normal normal-case tracking-normal text-muted-foreground">
                  — words signed off; give it a go-live time
                </span>
              </p>
              {readyToSchedule.map((piece) => (
                <InboxRow
                  key={piece.id}
                  piece={piece}
                  group="ready"
                  checked={selected.has(piece.id)}
                  onToggle={() => toggle(piece.id)}
                />
              ))}
            </section>
          )}
        </>
      )}

      <ConfirmDialog
        open={scheduleConfirmOpen}
        onOpenChange={setScheduleConfirmOpen}
        title={`Add ${selectedSchedulable.length} post${selectedSchedulable.length === 1 ? '' : 's'} to the queue?`}
        description="Each goes into its channel’s queue — the slot is picked from your posting schedule. You can still reschedule or cancel afterward. This schedules straight from here, without previewing each post individually — if that matters for one of these, open it in the editor instead."
        confirmLabel="Add to queue"
        destructive={false}
        loading={scheduling}
        onConfirm={bulkSchedule}
      />

      {/* Pipeline — full kanban below the action queue so producers see
          where every piece stands without leaving the inbox. */}
      <div className="pt-4 border-t">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
          <LayoutGrid className="h-4 w-4 text-primary" aria-hidden="true" />
          Pipeline
        </h2>
        <StoriesPipelineView stories={stories} isLoading={storiesLoading} />
      </div>
    </div>
  )
}

// One queue row. "review" rows carry a quick Approve; "ready" rows link to the
// existing publish flow (Storyboard Publish if media is attached, else the
// media picker). Open always routes somewhere real so the surface is useful now.
function InboxRow({ piece, group, checked, onToggle, onApprove, busy }) {
  const meta = PLATFORM_META[piece.platform] || { label: piece.platform, icon: null }
  const Icon = meta.icon
  const title = piece.topic || firstHeading(piece.content) || 'Untitled draft'
  const days = daysSince(piece.created_at)
  const age = ageLabel(days)
  const stale = days != null && days >= STALE_DAYS
  const hasMedia = HAS_MEDIA(piece)
  const mediaCount = Array.isArray(piece.media_urls) ? piece.media_urls.length : 0

  // Where "Open" goes: words awaiting review → the story words view (where the
  // clinician/producer reads + approves); an approved piece → Publish if it has
  // media, else the Storyboard media picker.
  const openTo =
    group === 'review'
      ? piece.interview_id
        ? `/stories/${piece.interview_id}?piece=${piece.id}`
        : `/publish/${piece.id}`
      : hasMedia
        ? `/publish/${piece.id}/schedule`
        : `/publish/${piece.id}`

  const meta2 =
    group === 'review'
      ? `Awaiting clinician sign-off${age ? ` · ${age}` : ''}`
      : hasMedia
        ? `${mediaCount} media attached`
        : 'Needs media'

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3 transition-colors hover:border-primary/40 ${
        checked ? 'ring-1 ring-primary/40 bg-accent/20' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-4 w-4 accent-[hsl(var(--primary))] shrink-0"
        aria-label={`Select ${title}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-2xs font-semibold rounded-full border px-2 py-0.5">
            {Icon && <Icon className="h-3 w-3" />}
            {meta.label}
          </span>
          <span className="text-sm font-semibold truncate" title={title}>{title}</span>
        </div>
        <p className="text-2xs text-muted-foreground mt-0.5">
          {piece.staff_name ? `${piece.staff_name} · ` : ''}
          <span className={stale ? 'text-warning font-medium' : ''}>{meta2}</span>
        </p>
      </div>

      {group === 'review' && (
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="inline-flex items-center gap-1 text-xs font-semibold text-success hover:text-success/80 disabled:opacity-50 shrink-0"
        >
          <Check className="h-3.5 w-3.5" /> Approve
        </button>
      )}
      {group === 'ready' && (
        <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground shrink-0">
          <ImageIcon className="h-3 w-3" /> {mediaCount}
        </span>
      )}

      <Link
        to={openTo}
        className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-primary shrink-0"
      >
        Open <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}
