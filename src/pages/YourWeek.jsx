import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUser } from '@clerk/react'
import {
  CalendarRange, Sparkles, Archive, Mail, Moon, ChevronRight, ChevronLeft, Shield, Plus,
  Check, Loader2, Clock, Eye, Send, BookOpen, ChevronDown, AlertTriangle, Pencil,
  History, CalendarPlus, Bot, Image as ImageIcon, Play,
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
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/Drawer'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

// F2.3 — "Your week": the producer's plan/review hub (Phase 2).
// 2b: workspace-tz time display.
// 2c: draft on demand, per-card approve+schedule, batch schedule.
// 2d: clinician "yours to review" slice.

const DAYS = [
  ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun'],
]
const DAY_FULL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
// Trust modes, shown as a segmented control (not a breadcrumb — it displays
// which mode you're currently in, it isn't a step-by-step trail). Keys are the
// stored cadence_policy.trust_stage values; labels + helper are user-facing.
const LADDER = [
  ['approve_all', 'Approve each post', 'You approve every post before it publishes. Bernard takes more off your plate as you greenlight more.'],
  ['approve_exception', 'Auto-approve routine', 'Bernard auto-approves routine posts and only asks you about the exceptions — taking on more as you greenlight more.'],
  ['manage_by_goals', 'Run by goals', 'Bernard runs to your goals and publishes on its own, surfacing only the posts that need your eyes.'],
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

// What the post is actually about: a real drafting brief beats the source
// interview's topic, which beats the generic angle category (e.g. "The
// Hook") — most atoms never get a per-atom brief, so without the interview
// topic every card/row in a given angle looks identical regardless of what
// interview it came from.
function contentLabel(item) {
  return item.brief || item.interviewTopic || item.label
}
// The angle category, shown as a secondary tag only when something more
// specific is already carrying the primary label.
function categoryTag(item) {
  const primary = contentLabel(item)
  return primary && primary !== item.label ? item.label : null
}

// A single backlog ("banked") item — links through to its source draft/interview.
function BacklogRow({ item, onNavigate }) {
  const meta = PLATFORM_META[item.platform] || { label: item.platform, icon: null }
  const Icon = meta.icon
  const tag = categoryTag(item)
  return (
    <Link
      to={drillTo(item)}
      onClick={onNavigate}
      className="flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      {Icon && <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-2xs font-medium">{contentLabel(item)}</span>
        {tag && <span className="block truncate text-3xs text-muted-foreground">{tag}</span>}
      </span>
      <span className="shrink-0 text-3xs text-muted-foreground">held</span>
      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}

// Resolve the pill appearance for a card based on atom + content_item state.
// The `rail` is the status-colored bar down the card's left edge that gives the
// week board its at-a-glance differentiation (amber = needs you, spruce =
// approved, green = live, faint = drafting) — same status language as the
// Stories rails, rendered as a solid bar (bg-*) for weight.
function cardState(item) {
  const cis = item.contentItemStatus
  if (!item.contentPieceId || item.status === 'pending') {
    return { label: 'needs draft', cls: 'bg-action/10 text-action', action: 'draft', rail: 'bg-action' }
  }
  if (item.status === 'drafting') {
    return { label: 'drafting…', cls: 'bg-muted text-muted-foreground', action: 'none', rail: 'bg-muted-foreground/40' }
  }
  if (cis === 'scheduled' || cis === 'published') {
    return { label: cis === 'published' ? 'Live' : 'Scheduled', cls: 'bg-success/10 text-success', action: 'open', rail: 'bg-success' }
  }
  if (cis === 'approved') {
    return { label: 'approved', cls: 'bg-primary/10 text-primary', action: 'schedule', rail: 'bg-primary' }
  }
  // drafted / in_review / draft — the one state where an inline human "yes"
  // is the meaningful action (reviewable: true gates the D4 approve affordance).
  // Amber pill+rail so "needs your yes" reads as attention, not inert muted.
  return { label: 'in review', cls: 'bg-warning/10 text-warning', action: 'open', reviewable: true, rail: 'bg-warning' }
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
    <div className="relative overflow-hidden rounded-lg border border-border bg-card p-2 pl-3 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_18px_-11px_rgba(15,23,42,0.3)] transition-shadow hover:shadow-md">
      {/* Solid status rail down the left edge — carries the card's status color
          with real weight (amber = needs you, green = live, spruce = approved). */}
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1.5 ${state.rail}`} />
      {/* Brand-colored platform icon chip identifies the channel on its own (no
          redundant label); the scheduled time rides to the right of the row. */}
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-md shrink-0 ${meta.bg || 'bg-muted'} ${meta.color || 'text-muted-foreground'}`}
          title={time ? `${meta.label} · scheduled ${time}` : meta.label}
        >
          {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
        </span>
        {time && <span className="ml-auto shrink-0 text-2xs font-semibold text-muted-foreground">{time}</span>}
      </div>
      <div className="text-2xs font-semibold leading-snug text-foreground line-clamp-3 mb-1.5">
        {contentLabel(item)}
      </div>
      {categoryTag(item) && (
        <div className="-mt-1 mb-1.5 truncate text-3xs text-muted-foreground">{categoryTag(item)}</div>
      )}
      {/* Pill and action stack on separate lines — side-by-side overflowed the
          button out of a narrow day column. */}
      <div className="flex flex-col items-start gap-1.5">
        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-3xs font-semibold ${state.cls}`}>
          {state.label}
        </span>
        {item.predrafted && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-3xs font-semibold text-muted-foreground" title="Bernard drafted this ahead of the week">
            <Bot className="h-2.5 w-2.5" aria-hidden="true" /> drafted ahead
          </span>
        )}
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
      {/* Voice drift flag — only when the gate HELD (a short caption below the
          bar). Long-form scores 'soft' (rubric isn't calibrated there) and
          pre-P2A drafts have no gate, so neither shows a false drift flag. */}
      {item.voiceGate === 'held' && (
        <div className="mt-1 flex items-center gap-1">
          <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-action" aria-hidden="true" />
          <span className="text-3xs text-action">voice — open draft to review</span>
        </div>
      )}
      {canReviewInline && expanded && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          {item.voiceFlag && item.voiceGate === 'held' && (
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
              Approve
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

// DayPlanCard — the roomy, full-width variant of PlanCard used in Day view.
// Same status language (rail + chip + pill) and the SAME handlers as the week
// card, but with space to show the draft excerpt inline and lay the working
// actions out in a row — the "sit down and clear this day" surface.
function DayPlanCard({ item, tz, onDraft, drafting, onApprove, approving, readOnly }) {
  const meta = PLATFORM_META[item.platform] || { label: item.platform, icon: null }
  const Icon = meta.icon
  const state = cardState(item)
  const time = item.scheduled_at ? timeLabel(item.scheduled_at, tz) : null
  const tag = categoryTag(item)
  const showExcerpt = !!item.excerpt && (state.reviewable || state.action === 'schedule')
  const canApprove = !readOnly && state.reviewable && !!item.contentPieceId && !!item.excerpt
  const showOpen = readOnly
    ? (!!item.contentPieceId || !!item.interviewId)
    : (state.action === 'open' || state.action === 'schedule')

  return (
    <div className="relative flex gap-3.5 overflow-hidden rounded-xl border border-border bg-card p-4 pl-5 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_18px_-12px_rgba(15,23,42,0.24)] transition-shadow hover:shadow-md">
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1.5 ${state.rail}`} />
      {/* Media thumbnail — the drafted post's first image (a video shows its
          poster + play badge); a muted placeholder when there's no media yet. */}
      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-5 w-5 text-muted-foreground/40" aria-hidden="true" />
        )}
        {item.mediaKind === 'video' && item.thumbnailUrl && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/25">
            <Play className="h-4 w-4 text-white" fill="currentColor" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md shrink-0 ${meta.bg || 'bg-muted'} ${meta.color || 'text-muted-foreground'}`}
          title={meta.label}
        >
          {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
        </span>
        <span className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">{meta.label}</span>
        {time && <span className="text-2xs font-semibold text-muted-foreground/70">· {time}</span>}
        <span className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-3xs font-semibold ${state.cls}`}>
          {state.label}
        </span>
        {item.predrafted && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-3xs font-semibold text-muted-foreground" title="Bernard drafted this ahead of the week">
            <Bot className="h-2.5 w-2.5" aria-hidden="true" /> drafted ahead
          </span>
        )}
      </div>
      <h3 className="text-sm font-bold leading-snug text-foreground">{contentLabel(item)}</h3>
      {tag && <p className="mt-0.5 text-xs text-muted-foreground">{tag}</p>}
      {showExcerpt && (
        <p className="mt-2 rounded-lg border-l-2 border-border bg-muted/40 px-3 py-2 text-xs italic leading-relaxed text-muted-foreground line-clamp-4">
          &ldquo;{item.excerpt}&rdquo;
        </p>
      )}
      {item.voiceGate === 'held' && (
        <div className="mt-2 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0 text-action" aria-hidden="true" />
          <span className="text-2xs text-action">{item.voiceFlag ? `Voice flag: ${item.voiceFlag}` : 'Voice — open draft to review'}</span>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!readOnly && state.action === 'draft' && (
          <button
            type="button"
            disabled={drafting}
            onClick={() => onDraft(item)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-action px-3 py-2 text-xs font-semibold text-action-foreground hover:opacity-90 disabled:opacity-50"
          >
            {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            Draft this
          </button>
        )}
        {canApprove && (
          <button
            type="button"
            disabled={approving}
            onClick={() => onApprove(item)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            Approve
          </button>
        )}
        {(canApprove || showOpen) && (
          <Link
            to={drillTo(item)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
          >
            {canApprove ? <><Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Open to change</> : <><Eye className="h-3.5 w-3.5" aria-hidden="true" /> Open</>}
          </Link>
        )}
      </div>
      </div>
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
  const [backlogOpen, setBacklogOpen] = useState(false)
  const [viewMode, setViewMode] = useState('week')   // 'week' board | 'day' focused work surface
  const [selectedDay, setSelectedDay] = useState(null) // day key ('mon'..'sun'); null = auto (today/first)
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

  // Inline approve from the week view. Phase 2B: approving now ALSO dispatches
  // server-side (one action = approve + schedule), so it no longer depends on
  // this tab staying open. The server handles text-only + video pieces directly;
  // for a carousel that needs a fresh client bake (or a Buffer-provider
  // workspace) it returns fallback and we run the proven client dispatch here.
  async function handleApprove(item) {
    if (approvingAtom || !item.contentPieceId) return
    setApprovingAtom(item.id)
    try {
      const resp = await apiFetch('/api/content-plan/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ piece_id: item.contentPieceId }),
      })
      if (resp?.dispatched) {
        toast.success('Approved & scheduled')
      } else if (resp?.fallback === 'client' || resp?.needs_client_bake) {
        // Server approved it but can't dispatch (carousel bake / Buffer provider)
        // — finish on the client via the proven publish path.
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
          id: piece.id, status: 'scheduled', approvedBy: userEmail,
          approvedAt: new Date().toISOString(), scheduledAt,
        })
        toast.success('Approved & scheduled')
      } else if (resp?.reason === 'in_progress') {
        // Another approve (another tab/teammate) is already dispatching this piece.
        toast.info('Already being scheduled…')
      } else if (resp?.error === 'words_not_approved') {
        // Same words-approval gate as every other publish path (Phase 3,
        // story-monitor redesign) — the piece stayed approved server-side;
        // it'll dispatch on the next "Schedule approved" retry once the
        // story's words are approved.
        toast.warning('Approved — but words aren’t approved yet', {
          description: 'Approve that story’s words on its Story page, then use “Schedule approved” to retry.',
        })
      } else if (resp?.error) {
        // Approved but dispatch failed on the server — leave it approved (the
        // "Schedule approved" button can retry); surface the reason.
        toast.warning('Approved — but scheduling failed', { description: 'Use “Schedule approved” to retry.' })
      } else {
        toast.success('Approved')
      }
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

  // Today's column key — only on the current week (a past/future week has no
  // "today" to anchor). Resolved in the workspace tz so it matches byDay above.
  const todayKey = weekOffset === 0
    ? new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(new Date()).toLowerCase().slice(0, 3)
    : null

  // Day view: per-day calendar dates for the strip, and the resolved active day.
  const weekMondayForStrip = weekMondayDate(weekOffset)
  const dayDates = DAYS.map(([, ], i) => new Date(weekMondayForStrip.getTime() + i * 86400000).getUTCDate())
  const firstDayWithItems = DAYS.find(([k]) => (byDay[k] || []).length > 0)?.[0]
  // Auto-pick: today if it has posts, else the first populated day, else today/Mon.
  const autoDay = (todayKey && (byDay[todayKey] || []).length > 0) ? todayKey : (firstDayWithItems || todayKey || 'mon')
  const activeDay = selectedDay || autoDay

  // Stage breakdown of the visible week — computed from the SAME cardState() the
  // day-column cards render, so the banner's numbers reconcile with what's on
  // screen (the old "N of M ready to review" headline conflated the pre-drafted
  // count with the review count and contradicted the ~handful of review cards).
  const weekStages = scheduled.reduce(
    (acc, item) => {
      const st = cardState(item)
      if (st.reviewable) acc.review += 1
      else if (st.label === 'Scheduled' || st.label === 'Live' || st.label === 'approved') acc.scheduled += 1
      return acc
    },
    { review: 0, scheduled: 0 },
  )

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
    // Distinguished from a generic failure — same words-approval gate as
    // every other publish path (Phase 3, story-monitor redesign).
    let wordsBlockedCount = 0
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
        } catch (e) {
          if (e?.payload?.error === 'words_not_approved') wordsBlockedCount++
          else failCount++
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
      if (!outerError && wordsBlockedCount) {
        toast.warning(`${wordsBlockedCount} skipped — words not approved yet`, {
          description: 'Approve that story’s words on its Story page, then try again.',
        })
      }
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

  // Week selector — rendered once, placed below the posting schedule (above the
  // board) when there's a plan, and above the empty state otherwise so you can
  // always page between weeks.
  const weekNavEl = (
    <WeekNav
      offset={weekOffset}
      onPrev={() => setWeekOffset((o) => Math.max(-NAV_BACK, o - 1))}
      onNext={() => setWeekOffset((o) => Math.min(NAV_FWD, o + 1))}
      onToday={() => setWeekOffset(0)}
    />
  )

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
          {/* Week / Day view toggle — Day is a focused per-day work surface. */}
          {data?.hasPlan && (
            <div role="group" aria-label="View" className="inline-flex items-center rounded-lg border bg-card p-0.5 text-xs">
              {['week', 'day'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setViewMode(m)}
                  aria-pressed={viewMode === m}
                  className={`rounded-md px-3 py-1 font-semibold capitalize transition-colors ${
                    viewMode === m ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
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

      {/* Mode + pre-draft summary — compacted into one row so the controls take
          less vertical space above the week itself. Trust mode is display-only
          (set in Auto-publish settings); the pre-draft banner frames /week as a
          review session when Bernard drafted ahead. */}
      {(isEditor || data?.predraftSummary?.predrafted > 0) && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
          {isEditor && (
            <div className="rounded-xl border bg-card p-3 lg:shrink-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">Your mode</span>
                <div
                  role="group"
                  aria-label="Current automation mode"
                  className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs"
                >
                  {LADDER.map(([s, lbl], i) => (
                    <span
                      key={s}
                      aria-current={i === stageIdx ? 'true' : undefined}
                      className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                        i === stageIdx ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
                      }`}
                    >
                      {lbl}
                    </span>
                  ))}
                </div>
              </div>
              <p className="mt-1.5 text-2xs text-muted-foreground">{LADDER[stageIdx]?.[2]}</p>
            </div>
          )}

          {data?.predraftSummary?.predrafted > 0 && (
            <div className="flex flex-1 items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.04] p-3.5">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <Bot className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  Bernard pre-drafted your week — {data.predraftSummary.predrafted} of {data.predraftSummary.total} planned posts
                </div>
                <div className="text-xs text-muted-foreground">
                  {weekStages.review} ready to review · {weekStages.scheduled} scheduled · {data.heldCount} in backlog
                  {data.predraftSummary.needsYou > 0 ? ` · ${data.predraftSummary.needsYou} flagged for a closer look` : ''}
                  {' · '}nothing publishes without your yes.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* On an empty week the nav sits above the empty state so you can still
          page between weeks; on a planned week it moves below the schedule. */}
      {!data?.hasPlan && weekNavEl}

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
                <span className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">Posting schedule</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-3xs font-semibold text-primary">
                  <Sparkles className="h-3 w-3" aria-hidden="true" /> {data.scheduledTotal} scheduled
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-2xs text-muted-foreground">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {tzLabel(tz)}
                </span>
              </div>
              <p className="mb-2 text-3xs text-muted-foreground">
                Each channel shows posts <b className="font-semibold text-foreground">scheduled this week</b> / your <b className="font-semibold text-foreground">weekly target</b>.
              </p>
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
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-muted-foreground cursor-help"><b className="text-foreground">{got}</b>/{target}</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {got} scheduled this week · target {target}/week
                          </TooltipContent>
                        </Tooltip>
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

          {/* Week selector — directly below the posting schedule, above the board. */}
          {weekNavEl}

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            {/* Calendar */}
            <div className="min-w-0 flex-1">
              {viewMode === 'day' ? (
                <div>
                  {/* Day strip — pick a day; shows date + post count. */}
                  <div className="mb-4 grid grid-cols-7 gap-1.5 sm:gap-2">
                    {DAYS.map(([key, label], i) => {
                      const count = (byDay[key] || []).length
                      const isSel = key === activeDay
                      const isTod = key === todayKey
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setSelectedDay(key)}
                          aria-pressed={isSel}
                          className={`rounded-xl border px-1 py-2 text-center transition-colors ${
                            isSel ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                                  : `bg-card hover:border-primary/40 ${isTod ? 'border-primary/40' : 'border-border'}`
                          }`}
                        >
                          <div className={`text-2xs font-bold uppercase tracking-wide ${isSel ? '' : isTod ? 'text-primary' : 'text-muted-foreground'}`}>{label}</div>
                          <div className={`text-lg font-extrabold tabular-nums leading-tight ${isSel ? '' : count ? 'text-foreground' : 'text-muted-foreground/40'}`}>{dayDates[i]}</div>
                          <div className={`text-3xs font-semibold ${isSel ? 'text-primary-foreground/80' : count ? 'text-muted-foreground/70' : 'text-muted-foreground/40'}`}>
                            {count ? `${count} post${count === 1 ? '' : 's'}` : '—'}{isTod ? ' · today' : ''}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  {/* Selected day's posts as roomy working cards. */}
                  {(() => {
                    const dayItems = byDay[activeDay] || []
                    if (dayItems.length === 0) {
                      return (
                        <div className="rounded-xl border border-dashed border-border bg-card py-14 text-center">
                          <Moon className="mx-auto h-7 w-7 text-muted-foreground/50" aria-hidden="true" />
                          <p className="mt-2 text-sm font-medium text-foreground">Nothing planned {DAY_FULL[activeDay]}</p>
                          {!isPast && data.heldCount > 0 && (
                            <button type="button" onClick={() => setBacklogOpen(true)} className="mt-1 text-xs font-semibold text-primary hover:underline">
                              Pull from backlog
                            </button>
                          )}
                        </div>
                      )
                    }
                    const needDraft = dayItems.filter((it) => cardState(it).action === 'draft').length
                    const inReview = dayItems.filter((it) => cardState(it).reviewable).length
                    return (
                      <div>
                        <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <h2 className="text-base font-bold tracking-tight">{DAY_FULL[activeDay]}</h2>
                          <span className="text-xs text-muted-foreground">
                            {dayItems.length} post{dayItems.length === 1 ? '' : 's'}
                            {needDraft ? ` · ${needDraft} need drafting` : ''}
                            {inReview ? ` · ${inReview} in review` : ''}
                          </span>
                        </div>
                        <div className="space-y-2.5">
                          {dayItems.map((item) => (
                            <DayPlanCard
                              key={item.id}
                              item={item}
                              tz={tz}
                              onDraft={handleDraft}
                              drafting={draftingAtom === item.id}
                              onApprove={handleApprove}
                              approving={approvingAtom === item.id}
                              readOnly={isPast}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {DAYS.map(([key, label]) => {
                  const isQuiet = quiet.has(key)
                  const items = byDay[key] || []
                  const isToday = key === todayKey
                  return (
                    <div key={key} className={`flex min-h-[160px] flex-col rounded-xl border bg-card shadow-sm transition-shadow ${isToday ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'}`}>
                      <div className="flex items-center justify-between px-2.5 pt-2.5 pb-1.5">
                        <span className={`text-2xs font-bold ${isToday ? 'text-primary' : ''}`}>
                          {label}{isToday && ' · Today'}
                        </span>
                        {items.length > 0 && (
                          <span className="text-3xs font-semibold text-muted-foreground/60 tabular-nums">{items.length}</span>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                        {items.length === 0 ? (
                          isQuiet ? (
                            <div className="flex flex-1 flex-col items-center justify-center gap-1 text-muted-foreground">
                              <Moon className="h-4 w-4" aria-hidden="true" />
                              <span className="text-3xs font-semibold">Quiet</span>
                            </div>
                          ) : (
                            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 py-4">
                              <span className="text-3xs font-medium text-muted-foreground/70">Nothing planned</span>
                              {!isPast && data.heldCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setBacklogOpen(true)}
                                  className="text-3xs font-semibold text-primary hover:underline focus:outline-none focus-visible:underline"
                                >
                                  View backlog
                                </button>
                              )}
                            </div>
                          )
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
              )}
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
                    {(data.held || []).slice(0, 6).map((item) => (
                      <BacklogRow key={item.id} item={item} />
                    ))}
                    {data.heldCount > 6 && (
                      <button
                        type="button"
                        onClick={() => setBacklogOpen(true)}
                        className="w-full rounded-lg px-2 py-1.5 text-2xs font-semibold text-primary hover:underline"
                      >
                        View all {data.heldCount}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <Drawer open={backlogOpen} onOpenChange={setBacklogOpen}>
                <DrawerContent side="right">
                  <DrawerHeader>
                    <DrawerTitle>Backlog — {data.heldCount} banked</DrawerTitle>
                  </DrawerHeader>
                  <div className="flex-1 space-y-1.5 overflow-y-auto p-4">
                    {(data.held || []).map((item) => (
                      <BacklogRow key={item.id} item={item} onNavigate={() => setBacklogOpen(false)} />
                    ))}
                  </div>
                </DrawerContent>
              </Drawer>

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
        description="Bernard will add these to your scheduling queue at their planned times. You can still hold or delete them before they publish. This schedules straight from here, without previewing each post individually — if that matters for one of these, open it in the editor instead."
        confirmLabel={scheduling ? 'Scheduling…' : 'Schedule all'}
        loading={scheduling}
        onConfirm={batchSchedule}
      />
    </div>
  )
}
