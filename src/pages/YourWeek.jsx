import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUser } from '@clerk/react'
import {
  CalendarRange, Sparkles, Archive, Mail, Moon, ChevronRight, ChevronLeft, Shield, Plus,
  Check, Loader2, Clock, Eye, Send, BookOpen, ChevronDown, AlertTriangle, Pencil,
  History, CalendarPlus,
} from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { PLATFORM_META } from '@/lib/contentMeta'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useUpdateContentItemStatus, useUpdateContentItem, useCarouselThemes } from '@/lib/queries'
import { BUFFER_DISPATCH_PLATFORMS } from '@/lib/publish'
import { publishPieceToBuffer } from '@/lib/publishPiece'
import { toast } from '@/lib/toast'
import PageHelp from '@/components/PageHelp'
import PageSkeleton from '@/components/PageSkeleton'
import { ConfirmDialog } from '@/components/ui/alert-dialog'

// F2.3 — "Your week": the producer's plan/review hub (Phase 2).
// 2b: workspace-tz time display.
// 2c: draft on demand, per-card approve+schedule, batch schedule.
// 2d: clinician "yours to review" slice.

const DAYS = [
  ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun'],
]
const LADDER = [
  ['approve_all', 'Approve everything'],
  ['approve_exception', 'Approve by exception'],
  ['manage_by_goals', 'Manage by goals'],
]

// Week navigation (F2): page back through finished weeks (read-only, up to 8) or
// forward to plan ahead (up to 4). Must mirror the server's bounds in week-summary.js
// + plan-week.js.
const NAV_BACK = 8
const NAV_FWD = 4

// UTC-Monday for an offset from this week — mirrors strategist mondayOf() exactly,
// so the Monday/range the server validates is the same value we compute & send.
function weekMondayDate(offset) {
  const d = new Date()
  const dow = (d.getUTCDay() + 6) % 7 // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow + offset * 7)
  d.setUTCHours(0, 0, 0, 0)
  return d
}
function weekMondayISO(offset) {
  return weekMondayDate(offset).toISOString().slice(0, 10)
}
function weekRangeLabel(offset) {
  const mon = weekMondayDate(offset)
  const sun = new Date(mon)
  sun.setUTCDate(sun.getUTCDate() + 6)
  const f = (dt, withMonth) => dt.toLocaleDateString('en-US', { month: withMonth ? 'short' : undefined, day: 'numeric', timeZone: 'UTC' })
  return mon.getUTCMonth() === sun.getUTCMonth()
    ? `${f(mon, true)} – ${f(sun, false)}`
    : `${f(mon, true)} – ${f(sun, true)}`
}
function weekRelative(offset) {
  if (offset === 0) return 'This week'
  if (offset === 1) return 'Next week'
  if (offset === -1) return 'Last week'
  return offset > 0 ? `In ${offset} weeks` : `${-offset} weeks ago`
}

// Module-scope per the react-hooks/static-components rule.
function WeekNav({ offset, onPrev, onNext, onToday }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-2.5">
      <button
        type="button"
        onClick={onPrev}
        disabled={offset <= -NAV_BACK}
        className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Prev
      </button>
      <div className="flex items-center gap-2 text-center">
        <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <div className="text-sm font-bold leading-tight">{weekRangeLabel(offset)}</div>
          <div className="text-3xs font-semibold uppercase tracking-wide text-primary">{weekRelative(offset)}</div>
        </div>
        {offset !== 0 && (
          <button
            type="button"
            onClick={onToday}
            className="ml-1 rounded-md border px-2 py-0.5 text-3xs font-semibold text-muted-foreground hover:bg-muted"
          >
            Back to this week
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onNext}
        disabled={offset >= NAV_FWD}
        className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

// Friendly zone label so the cadence footer reads "Pacific time", not the raw
// IANA city ("Los Angeles times" — which also read like the newspaper).
const TZ_LABELS = {
  'America/Los_Angeles': 'Pacific time',
  'America/Tijuana': 'Pacific time',
  'America/Denver': 'Mountain time',
  'America/Phoenix': 'Mountain time',
  'America/Chicago': 'Central time',
  'America/New_York': 'Eastern time',
  'America/Anchorage': 'Alaska time',
  'Pacific/Honolulu': 'Hawaii time',
}
function tzLabel(tz) {
  if (!tz) return 'local time'
  return TZ_LABELS[tz] || `${tz.split('/').pop().replace(/_/g, ' ')} time`
}

function timeLabel(iso, tz) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: tz || undefined,
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function drillTo(item) {
  if (item.contentPieceId) return `/publish/${item.contentPieceId}`
  if (item.interviewId) return `/stories/${item.interviewId}`
  return '/stories'
}

// Resolve the pill appearance for a card based on atom + content_item state.
function cardState(item) {
  const cis = item.contentItemStatus
  if (!item.contentPieceId || item.status === 'pending') {
    return { label: 'needs draft', cls: 'bg-action/10 text-action', action: 'draft' }
  }
  if (item.status === 'drafting') {
    return { label: 'drafting…', cls: 'bg-muted text-muted-foreground', action: 'none' }
  }
  if (cis === 'scheduled' || cis === 'published') {
    return { label: cis === 'published' ? 'Live' : 'Scheduled', cls: 'bg-success/10 text-success', action: 'open' }
  }
  if (cis === 'approved') {
    return { label: 'approved', cls: 'bg-primary/10 text-primary', action: 'schedule' }
  }
  // drafted / in_review / draft — the one state where an inline human "yes"
  // is the meaningful action (reviewable: true gates the D4 approve affordance).
  return { label: 'in review', cls: 'bg-muted text-muted-foreground', action: 'open', reviewable: true }
}

function PlanCard({ item, tz, onDraft, drafting, onApprove, approving, readOnly }) {
  const meta = PLATFORM_META[item.platform] || { label: item.platform, icon: null }
  const Icon = meta.icon
  const state = cardState(item)
  const time = item.scheduled_at ? timeLabel(item.scheduled_at, tz) : null
  const [expanded, setExpanded] = useState(false)
  // The week is reviewable in place: a piece that's "open to review" with a
  // drafted excerpt can be approved here — the "this sounds like me" decision
  // happens with the evidence visible, without leaving the week view (D4).
  // Past weeks are read-only: no draft/approve affordances, just view.
  const canReviewInline = !readOnly && state.reviewable && !!item.contentPieceId && !!item.excerpt
  const showOpen = readOnly
    ? (!!item.contentPieceId || !!item.interviewId)
    : (state.action === 'open' || state.action === 'schedule')

  return (
    <div className="rounded-lg border border-l-[3px] border-l-primary bg-card p-2 transition-all hover:border-primary/60 hover:shadow-sm">
      {/* Platform label at text-2xs (legibility, esp. on the narrow mobile day
          columns); the scheduled time moves to a hover/title so the always-on
          label row stays uncluttered. The state pill below carries status. */}
      <div className="mb-1 flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span
          className="text-2xs font-bold uppercase tracking-wide text-muted-foreground"
          title={time ? `${meta.label} · scheduled ${time}` : meta.label}
        >
          {meta.label}
        </span>
      </div>
      <div className="text-2xs font-semibold leading-snug text-foreground line-clamp-3 mb-1.5">
        {item.brief || item.label}
      </div>
      {/* Pill and action stack on separate lines — side-by-side overflowed the
          button out of a narrow day column. */}
      <div className="flex flex-col items-start gap-1.5">
        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-3xs font-semibold ${state.cls}`}>
          {state.label}
        </span>
        {!readOnly && state.action === 'draft' && (
          <button
            type="button"
            disabled={drafting}
            onClick={() => onDraft(item)}
            className="inline-flex w-full items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-3xs font-semibold hover:bg-muted disabled:opacity-50"
          >
            {drafting ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3 w-3" aria-hidden="true" />}
            Draft
          </button>
        )}
        {canReviewInline ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex w-full items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-3xs font-semibold hover:bg-muted"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} /> Review
          </button>
        ) : (showOpen && (
          <Link
            to={drillTo(item)}
            className="inline-flex w-full items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-3xs font-semibold hover:bg-muted"
          >
            <Eye className="h-3 w-3" /> Open
          </Link>
        ))}
      </div>
      {item.voiceFidelityScore !== null && item.voiceFidelityScore !== undefined && item.voiceFidelityScore < 65 && (
        <div className="mt-1 flex items-center gap-1">
          <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-action" aria-hidden="true" />
          <span className="text-3xs text-action">voice — open draft to review</span>
        </div>
      )}
      {canReviewInline && expanded && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          {item.voiceFlag && item.voiceFidelityScore !== null && item.voiceFidelityScore < 65 && (
            <p className="mb-1.5 text-3xs italic text-action">Flagged: {item.voiceFlag}</p>
          )}
          <p className="text-2xs italic leading-snug text-muted-foreground line-clamp-4">
            &ldquo;{item.excerpt}&rdquo;
          </p>
          {/* Stacked full-width actions: side-by-side overflowed/wrapped in a
              narrow day column (the label cramped onto two lines). */}
          <div className="mt-1.5 flex flex-col gap-1">
            <button
              type="button"
              disabled={approving}
              onClick={() => onApprove(item)}
              className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-primary px-2 py-1.5 text-3xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {approving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Check className="h-3 w-3" aria-hidden="true" />}
              Sounds like me
            </button>
            <Link
              to={drillTo(item)}
              className="inline-flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-3xs font-semibold text-muted-foreground hover:bg-muted"
            >
              <Pencil className="h-3 w-3" /> Open to change
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

export default function YourWeek() {
  useDocumentTitle('Your week')
  const { user } = useUser()
  const { isEditor, isLoading: roleLoading } = useUserRole()
  const workspace = useWorkspace()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const updateStatus = useUpdateContentItemStatus()
  const updateItem = useUpdateContentItem()
  const { data: allThemes = [] } = useCarouselThemes()

  const [draftingAtom, setDraftingAtom] = useState(null) // atom id being drafted
  const [approvingAtom, setApprovingAtom] = useState(null) // atom id being approved inline
  const [scheduleConfirmOpen, setScheduleConfirmOpen] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [weekOffset, setWeekOffset] = useState(0) // 0 = this week; <0 past (read-only); >0 future (plannable)
  const [planningWeek, setPlanningWeek] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['week-summary', weekOffset],
    queryFn: () => apiFetch(`/api/content-plan/week-summary${weekOffset ? `?week=${weekMondayISO(weekOffset)}` : ''}`),
    enabled: !roleLoading,
    refetchOnWindowFocus: false,
  })

  const isPast = weekOffset < 0
  const isFuture = weekOffset > 0

  const userEmail = user?.primaryEmailAddress?.emailAddress || user?.id || ''

  // Draft an undrafted atom on demand (2c).
  async function handleDraft(item) {
    if (draftingAtom) return
    setDraftingAtom(item.id)
    try {
      const result = await apiFetch('/api/content-plan/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atom_id: item.id }),
      })
      toast.success('Draft ready — in review')
      qc.invalidateQueries({ queryKey: ['week-summary'] })
      if (result?.content_piece?.id) navigate(`/publish/${result.content_piece.id}`)
    } catch (e) {
      toast.error('Draft failed', { description: e?.message })
    } finally {
      setDraftingAtom(null)
    }
  }

  // Inline approve from the week view (D4): mark the drafted piece approved so
  // it joins the batch-schedulable set — no navigation away from /week.
  async function handleApprove(item) {
    if (approvingAtom || !item.contentPieceId) return
    setApprovingAtom(item.id)
    try {
      await updateStatus.mutateAsync({
        id: item.contentPieceId,
        status: 'approved',
        approvedBy: userEmail,
        approvedAt: new Date().toISOString(),
      })
      toast.success('Approved — ready to schedule')
      qc.invalidateQueries({ queryKey: ['week-summary'] })
    } catch (e) {
      toast.error('Approve failed', { description: e?.message })
    } finally {
      setApprovingAtom(null)
    }
  }

  // Generate-ahead: compose the viewed FUTURE week from backlog + captures so it
  // can be reviewed/approved early. The endpoint gates to future weeks (+1..+4).
  async function handlePlanAhead() {
    if (planningWeek || weekOffset <= 0) return
    setPlanningWeek(true)
    try {
      const r = await apiFetch('/api/content-plan/plan-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week: weekMondayISO(weekOffset) }),
      })
      if (r?.skipped === 'no-inputs') {
        toast.info('Nothing to plan ahead yet', {
          description: 'This week fills as you capture more or your backlog builds up.',
        })
      } else {
        toast.success('Planned ahead — review when ready')
      }
      qc.invalidateQueries({ queryKey: ['week-summary'] })
    } catch (e) {
      toast.error('Plan failed', { description: e?.message })
    } finally {
      setPlanningWeek(false)
    }
  }

  if (roleLoading || isLoading) return <PageSkeleton variant="dashboard" />

  const quiet = new Set((data?.quietDays || ['sat', 'sun']).map((q) => q.toLowerCase()))
  const cadence = data?.cadence || {}
  const scheduled = data?.scheduled || []
  const tz = data?.timezone || workspace?.cadence_policy?.timezone || 'America/Los_Angeles'

  // Group scheduled atoms into day columns.
  const byDay = {}
  for (const [k] of DAYS) byDay[k] = []
  for (const item of scheduled) {
    const k = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(new Date(item.scheduled_at)).toLowerCase().slice(0, 3)
    if (byDay[k]) byDay[k].push(item)
  }

  // Approved pieces ready to batch-schedule (social platforms with a piece).
  const approvedSchedulable = scheduled.filter(
    (item) =>
      item.contentPieceId &&
      item.contentItemStatus === 'approved' &&
      BUFFER_DISPATCH_PLATFORMS.includes(item.platform),
  )

  const stageIdx = Math.max(0, LADDER.findIndex(([s]) => s === (data?.trustStage || 'approve_all')))

  // Batch schedule: fetch piece details then publishPieceToBuffer for each approved piece.
  async function batchSchedule() {
    if (!approvedSchedulable.length || scheduling) return
    setScheduling(true)
    let okCount = 0
    let failCount = 0
    let outerError = false
    try {
      for (const item of approvedSchedulable) {
        try {
          // Fetch full piece data (needed for slide-baking, media_urls, etc.)
          const piece = await apiFetch(`/api/db/content?id=${encodeURIComponent(item.contentPieceId)}`)
          const { scheduledAt, renderedSlides } = await publishPieceToBuffer(piece, {
            scheduledAt: item.scheduled_at || null,
            useQueue: !item.scheduled_at,
            userEmail,
            workspace,
            themes: allThemes,
          })
          if (renderedSlides) {
            try { await updateItem.mutateAsync({ id: piece.id, patch: { slides: renderedSlides } }) } catch { /* non-fatal */ }
          }
          await updateStatus.mutateAsync({
            id: piece.id,
            status: 'scheduled',
            approvedBy: userEmail,
            approvedAt: new Date().toISOString(),
            scheduledAt,
          })
          okCount++
        } catch {
          failCount++
        }
      }
    } catch (e) {
      outerError = true
      toast.error('Scheduling failed', { description: e?.message || 'Something went wrong.' })
    } finally {
      setScheduling(false)
      setScheduleConfirmOpen(false)
      qc.invalidateQueries({ queryKey: ['week-summary'] })
      if (!outerError && okCount) toast.success(`Scheduled ${okCount} post${okCount === 1 ? '' : 's'}`)
      if (!outerError && failCount) toast.error(`${failCount} couldn't be scheduled`, { description: 'Open them individually to retry.' })
    }
  }

  // Clinician "yours to review" — blog content_items in in_review (2d).
  // Only rendered for non-editors (clinicians). Editors see the full calendar.
  const YourReviewSlice = !isEditor && data?.yourReview?.length ? (
    <div className="rounded-xl border border-border bg-muted/40 p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-bold">Your blog drafts to review</span>
        <span className="ml-auto inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-2xs font-semibold text-muted-foreground">
          {data.yourReview.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {data.yourReview.map((item) => (
          <Link
            key={item.id}
            to={`/publish/${item.id}`}
            className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 hover:border-primary/50"
          >
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="flex-1 truncate text-2xs font-medium">{item.topic || 'Blog draft'}</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </div>
  ) : null

  return (
    <div className="space-y-5 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <CalendarRange className="h-5 w-5 text-primary" aria-hidden="true" />
            Your week
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The week I&apos;d run for you, built from your captures. Open anything to review it. <b>Nothing publishes without your yes.</b>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isPast && approvedSchedulable.length > 0 && (
            <button
              type="button"
              onClick={() => setScheduleConfirmOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              Schedule {approvedSchedulable.length} approved
            </button>
          )}
          <PageHelp pageKey="your-week" variant="default" />
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-2xs font-medium text-muted-foreground">
            <Shield className="h-3 w-3" aria-hidden="true" /> {isEditor ? 'Producer' : 'Clinician'} view
          </span>
        </div>
      </div>

      {/* Clinician review slice (2d) */}
      {YourReviewSlice}

      {/* Trust ladder */}
      {isEditor && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
          <span className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">You&apos;re here</span>
          <div className="flex items-center gap-2 text-xs">
            {LADDER.map(([s, lbl], i) => (
              <span key={s} className="flex items-center gap-2">
                {i === stageIdx ? (
                  <span className="rounded-md bg-primary/10 text-primary px-2 py-0.5 font-semibold">{lbl}</span>
                ) : (
                  <span className="text-muted-foreground/60">{lbl}</span>
                )}
                {i < LADDER.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
              </span>
            ))}
          </div>
          <span className="ml-auto text-2xs text-muted-foreground">I take more off your plate as I learn what you greenlight</span>
        </div>
      )}

      {/* Week navigation (F2): page back through finished weeks or forward to plan ahead */}
      <WeekNav
        offset={weekOffset}
        onPrev={() => setWeekOffset((o) => Math.max(-NAV_BACK, o - 1))}
        onNext={() => setWeekOffset((o) => Math.min(NAV_FWD, o + 1))}
        onToday={() => setWeekOffset(0)}
      />

      {/* Per-week context banner */}
      {isPast && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-2xs text-muted-foreground">
          <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span><b className="text-foreground">Past week — read-only.</b> What ran the week of {weekRangeLabel(weekOffset)}. Open any piece to view it; finished weeks can&apos;t be re-planned.</span>
        </div>
      )}
      {isFuture && data?.hasPlan && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-2xs text-primary">
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span><b>Planned ahead.</b> Review &amp; approve these now — they sit ready until {weekRangeLabel(weekOffset)}. Nothing publishes without your yes.</span>
        </div>
      )}

      {!data?.hasPlan ? (
        isFuture ? (
          <div className="rounded-lg border border-dashed bg-muted/20 py-12 text-center">
            <CalendarPlus className="mx-auto h-8 w-8 text-primary/60" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-foreground">Nothing planned for {weekRangeLabel(weekOffset)} yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              I&apos;ll compose this week from your backlog and any captures in its window — paced across your channels. You review and approve before anything schedules.
            </p>
            <button
              type="button"
              disabled={planningWeek}
              onClick={handlePlanAhead}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {planningWeek ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
              {planningWeek ? 'Planning…' : 'Plan this week'}
            </button>
          </div>
        ) : isPast ? (
          <div className="rounded-lg border bg-muted/20 py-12 text-center">
            <Moon className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-foreground">Nothing ran the week of {weekRangeLabel(weekOffset)}</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              No content was planned for this past week.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/20 py-12 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-primary/60" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-foreground">No plan for this week yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Complete an interview and I&apos;ll compose your week — paced across your channels, with the rest banked as backlog.
            </p>
            <Link to="/new" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" aria-hidden="true" /> Start a capture
            </Link>
          </div>
        )
      ) : (
        <>
          {/* Cadence strip */}
          {Object.keys(cadence).length > 0 && (
            <div className="rounded-xl border bg-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">Filled to your cadence</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-3xs font-semibold text-primary">
                  <Sparkles className="h-3 w-3" aria-hidden="true" /> {data.scheduledTotal} scheduled
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-2xs text-muted-foreground">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {tzLabel(tz)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(cadence).filter(([, c]) => c?.enabled).map(([platform, cfg]) => {
                  const meta = PLATFORM_META[platform] || { label: platform, icon: null }
                  const Icon = meta.icon
                  const got = data.byPlatform?.[platform] || 0
                  const target = cfg.target_per_week || 0
                  return (
                    <div key={platform}>
                      <div className="mb-1 flex items-center justify-between text-2xs">
                        <span className="flex items-center gap-1.5 font-semibold">
                          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />} {meta.label}
                        </span>
                        <span className="text-muted-foreground"><b className="text-foreground">{got}</b>/{target}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${target ? Math.min(100, (got / target) * 100) : 0}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            {/* Calendar */}
            <div className="min-w-0 flex-1">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {DAYS.map(([key, label]) => {
                  const isQuiet = quiet.has(key)
                  const items = byDay[key] || []
                  return (
                    <div key={key} className={`flex min-h-[160px] flex-col rounded-xl border ${isQuiet ? 'bg-muted/30' : 'bg-card'}`}>
                      <div className="px-2.5 pt-2.5 pb-1.5 text-2xs font-bold">{label}</div>
                      <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                        {isQuiet && items.length === 0 ? (
                          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-muted-foreground">
                            <Moon className="h-4 w-4" aria-hidden="true" />
                            <span className="text-3xs font-semibold">Quiet</span>
                          </div>
                        ) : (
                          items.map((item) => (
                            <PlanCard
                              key={item.id}
                              item={item}
                              tz={tz}
                              onDraft={handleDraft}
                              drafting={draftingAtom === item.id}
                              onApprove={handleApprove}
                              approving={approvingAtom === item.id}
                              readOnly={isPast}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Right rail: backlog + digest */}
            <div className="w-full shrink-0 space-y-3 lg:w-72">
              <div className="rounded-xl border bg-card p-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <Archive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-bold">Backlog</span>
                  <span className="ml-auto inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-2xs font-semibold text-muted-foreground">
                    {data.heldCount} banked
                  </span>
                </div>
                {data.heldCount === 0 ? (
                  <p className="text-2xs text-muted-foreground">Surplus pieces get banked here and pulled in to fill thin weeks.</p>
                ) : (
                  <div className="space-y-1.5">
                    {(data.held || []).slice(0, 6).map((item) => {
                      const meta = PLATFORM_META[item.platform] || { label: item.platform, icon: null }
                      const Icon = meta.icon
                      return (
                        <div key={item.id} className="flex items-center gap-2 rounded-lg border px-2 py-1.5">
                          {Icon && <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
                          <span className="flex-1 truncate text-2xs font-medium">{item.brief || item.label}</span>
                          <span className="text-3xs text-muted-foreground">held</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {data.digest && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
                    <span className="text-sm font-bold">Newsletter — assembling</span>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    Highlights feed your {data.digest.frequency || ''} <span className="font-semibold text-primary lowercase">{data.digest.label}</span> digest{data.digest.next_send ? ` · sends ${data.digest.next_send}` : ''} — assembled, not per-capture.
                  </p>
                </div>
              )}

              {/* Batch schedule status summary */}
              {!isPast && approvedSchedulable.length > 0 && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                    <span className="text-sm font-bold">{approvedSchedulable.length} ready to schedule</span>
                  </div>
                  <p className="text-2xs text-muted-foreground mb-2">
                    These pieces have been approved and are waiting for their slots.
                  </p>
                  <button
                    type="button"
                    onClick={() => setScheduleConfirmOpen(true)}
                    className="w-full rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    <Send className="inline h-3.5 w-3.5 mr-1" aria-hidden="true" />
                    Schedule all
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={scheduleConfirmOpen}
        onOpenChange={(v) => { if (!scheduling) setScheduleConfirmOpen(v) }}
        title={`Schedule ${approvedSchedulable.length} approved post${approvedSchedulable.length === 1 ? '' : 's'}?`}
        description="Bernard will add these to your Buffer queue at their planned times. You can still hold or delete them from Buffer before they publish."
        confirmLabel={scheduling ? 'Scheduling…' : 'Schedule all'}
        loading={scheduling}
        onConfirm={batchSchedule}
      />
    </div>
  )
}
