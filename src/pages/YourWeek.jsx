import { useState } from 'react'
import NeedsYouStrip from '@/components/producer/NeedsYouStrip'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUser } from '@clerk/react'
import {
  CalendarRange, Sparkles, Archive, Mail, Moon, ChevronRight, ChevronLeft, Shield, Plus,
  Check, Loader2, Clock, Eye, Send, BookOpen, AlertTriangle, Pencil,
  History, CalendarPlus, Bot, Image as ImageIcon, Play, Film, CircleDot, FlaskConical, BellOff, Bell,
} from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { PLATFORM_META } from '@/lib/contentMeta'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useUpdateContentItemStatus, useUpdateContentItem, useCarouselThemes, queryKeys } from '@/lib/queries'
import { BUFFER_DISPATCH_PLATFORMS } from '@/lib/publish'
import { publishPieceToBuffer } from '@/lib/publishPiece'
import { computeEmptySlots, localSlotParts } from '@/lib/postingSlots'
import { toast } from '@/lib/toast'
import PageHelp from '@/components/PageHelp'
import PageSkeleton from '@/components/PageSkeleton'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/Drawer'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'

// T3 — format badges shown on cards/slots and in the legend. Mirrors the
// atom.format vocabulary (api/_lib/atomPlan.js ATOM_FORMATS): post/reel/story.
const FORMAT_META = {
  post: { icon: ImageIcon, label: 'Post' },
  reel: { icon: Film, label: 'Reel' },
  story: { icon: CircleDot, label: 'Story' },
}

// F2.3 — "Your week": the producer's plan/review hub (Phase 2).
// 2b: workspace-tz time display.
// 2c: draft on demand, per-card approve+schedule, batch schedule.
// 2d: clinician "yours to review" slice.

const DAYS = [
  ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun'],
]
const DAY_FULL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
// Trust modes, in ladder order. This is a rung you REACH, never a mode you
// pick: trust_stage is written once at onboarding ('approve_all') and advances
// only when Bernard earns it and asks (the graduation model in
// .claude/f1-f2-cadence-spec.md) — there is no setter anywhere in the app.
// Rendered as a read-out + progress meter for that reason; see the render site.
// Keys are the stored cadence_policy.trust_stage values; labels + helper are
// user-facing.
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

// The workspace-tz Monday for an offset from the current week, returned as a Date
// anchored at UTC-midnight of that Monday (so callers can read getUTCDate() /
// toISOString() off it and format in UTC). Mirrors the server's mondayOf(now, tz)
// EXACTLY: derive the workspace-LOCAL calendar date for "now" first, THEN take its
// ISO-Monday — so the week flips at local midnight, not UTC midnight. Pre-fix this
// used getUTCDay() on `new Date()`, so a Pacific workspace jumped to next week from
// ~5pm Sunday local (once UTC had ticked over to Monday), hiding the running week's
// earlier posts and labeling the board a day early. `tz` is IANA.
function localYMD(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant)
  const part = (t) => Number(parts.find((p) => p.type === t).value)
  return [part('year'), part('month'), part('day')]
}
function weekMondayDate(offset, tz) {
  const [y, m, d] = localYMD(new Date(), tz || 'America/Los_Angeles')
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0))
  const dow = (anchor.getUTCDay() + 6) % 7 // 0 = Monday
  anchor.setUTCDate(anchor.getUTCDate() - dow + offset * 7)
  anchor.setUTCHours(0, 0, 0, 0)
  return anchor
}
function weekMondayISO(offset, tz) {
  return weekMondayDate(offset, tz).toISOString().slice(0, 10)
}
// T3 — Month overview: convert a clicked calendar date into the weekOffset
// units Week view already navigates by (weeks from the current week).
function weekOffsetForDate(dateISO, tz) {
  const [y, m, d] = dateISO.split('-').map(Number)
  const targetMonday = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0))
  const dow = (targetMonday.getUTCDay() + 6) % 7
  targetMonday.setUTCDate(targetMonday.getUTCDate() - dow)
  const thisMonday = weekMondayDate(0, tz)
  return Math.round((targetMonday.getTime() - thisMonday.getTime()) / (7 * 86_400_000))
}
function weekRangeLabel(offset, tz) {
  const mon = weekMondayDate(offset, tz)
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
// week board its at-a-glance differentiation. Amber is reserved for the ONE
// state that needs a human decision ("in review"); "needs draft" is a quiet
// dashed neutral (a to-do the system fills, not an alert), spruce =
// approved, green = live, faint = drafting — same status language as the
// Stories rails, rendered as a solid bar (bg-*) for weight.
function cardState(item) {
  const cis = item.contentItemStatus
  if (!item.contentPieceId || item.status === 'pending') {
    return { label: 'needs draft', cls: 'border border-dashed border-muted-foreground/40 text-muted-foreground', action: 'draft', rail: 'bg-muted-foreground/25' }
  }
  if (item.status === 'drafting') {
    return { label: 'drafting…', cls: 'bg-muted text-muted-foreground', action: 'none', rail: 'bg-muted-foreground/40' }
  }
  if (cis === 'scheduled' || cis === 'published') {
    return { label: cis === 'published' ? 'Live' : 'Scheduled', cls: 'bg-success text-success-foreground', action: 'open', rail: 'bg-success' }
  }
  if (cis === 'approved') {
    return { label: 'approved', cls: 'bg-primary text-primary-foreground', action: 'schedule', rail: 'bg-primary' }
  }
  // drafted / in_review / draft — the one state where an inline human "yes"
  // is the meaningful action (reviewable: true gates the D4 approve affordance).
  // Amber pill+rail so "needs your yes" reads as attention, not inert muted.
  return { label: 'in review', cls: 'bg-warning text-warning-foreground', action: 'open', reviewable: true, rail: 'bg-warning' }
}

// T3 — the whole tile routes to the full review screen (words + all media +
// approve/reject, /publish/:pieceId) instead of the old hidden "Review"
// expander that showed a 4-line excerpt with zero media. "Draft" stays a
// separate, non-navigating action (there's nothing to review yet). Past weeks
// are read-only: the card still opens for viewing, just no Draft affordance.
function PlanCard({ item, tz, onDraft, drafting, draftBusy, readOnly }) {
  const meta = PLATFORM_META[item.platform] || { label: item.platform, icon: null }
  const Icon = meta.icon
  const formatMeta = FORMAT_META[item.format] || FORMAT_META.post
  const FormatIcon = formatMeta.icon
  const state = cardState(item)
  const time = item.scheduled_at ? timeLabel(item.scheduled_at, tz) : null
  const needsDraft = !readOnly && state.action === 'draft'

  const body = (
    <>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1.5 ${state.rail}`} />
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-md shrink-0 ${meta.bg || 'bg-muted'} ${meta.color || 'text-muted-foreground'}`}
          title={time ? `${meta.label} · scheduled ${time}` : meta.label}
        >
          {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
        </span>
        <FormatIcon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" title={formatMeta.label} />
        {time && <span className="ml-auto shrink-0 text-2xs font-semibold text-muted-foreground">{time}</span>}
      </div>
      <div className="text-2xs font-semibold leading-snug text-foreground line-clamp-3 mb-1.5">
        {contentLabel(item)}
      </div>
      {categoryTag(item) && (
        <div className="-mt-1 mb-1.5 truncate text-3xs text-muted-foreground">{categoryTag(item)}</div>
      )}
      <div className="flex flex-col items-start gap-1.5">
        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-3xs font-bold ${state.cls}`}>
          {state.label}
        </span>
        {item.predrafted && (
          <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-3xs font-bold text-foreground" title="Bernard drafted this ahead of the week">
            <Bot className="h-2.5 w-2.5" aria-hidden="true" /> drafted ahead
          </span>
        )}
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
    </>
  )

  const cardCls = 'relative overflow-hidden rounded-lg border border-border bg-card p-2 pl-3 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_18px_-11px_rgba(15,23,42,0.3)] transition-shadow hover:shadow-md'

  // A "needs draft" atom has nothing to review yet — Draft is the only
  // action, not a navigation. drillTo() would just fall back to the source
  // interview, which isn't useful here.
  if (needsDraft) {
    return (
      <div className={cardCls}>
        {body}
        <button
          type="button"
          disabled={drafting || draftBusy}
          title={!drafting && draftBusy ? 'Already drafting another post — please wait' : undefined}
          onClick={() => onDraft(item)}
          className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-3xs font-semibold hover:bg-muted disabled:opacity-50"
        >
          {drafting ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3 w-3" aria-hidden="true" />}
          Draft
        </button>
      </div>
    )
  }

  return (
    <Link to={drillTo(item)} className={`${cardCls} block hover:border-primary/30`}>
      {body}
    </Link>
  )
}

// T3 — a pinned posting slot with no atom scheduled into it yet. Replaces the
// old dead "Nothing planned" filler: each defined slot (weekday+hour+format
// per channel, see api/_lib/cadenceSlots.js) is now visible on the board
// whether or not it's filled. Clicking opens the Add-to-day picker (PR4) —
// for now, opens the existing backlog drawer as the interim action.
// `exploring` (T4 tie-in) gets the primary/dashed treatment + a note instead
// of the pink "open slot" styling, matching the signed-off mockup.
function EmptySlotTile({ slot, onClick }) {
  const meta = PLATFORM_META[slot.platform] || { label: slot.platform, icon: null }
  const Icon = meta.icon
  const formatMeta = FORMAT_META[slot.format] || FORMAT_META.post
  const FormatIcon = formatMeta.icon
  const label = new Date(2026, 0, 1, slot.hour).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  if (slot.exploring) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex flex-col gap-1 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-2 text-left text-3xs text-primary transition-colors hover:bg-primary/10"
      >
        <span className="flex items-center gap-1 font-semibold"><FlaskConical className="h-3 w-3" aria-hidden="true" /> Trying this day</span>
        <span className="text-primary/80">Bernard is testing {label} {formatMeta.label.toLowerCase()}s for {meta.label} — no data yet on this window.</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-pink-300 bg-pink-50/60 p-2 text-3xs font-medium text-pink-700 transition-colors hover:bg-pink-50"
    >
      <span className="flex items-center gap-1">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
        <FormatIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span>{label} · {formatMeta.label}</span>
      <span className="flex items-center gap-1"><Plus className="h-3 w-3" aria-hidden="true" />Open slot</span>
    </button>
  )
}

// T3 — the Add-to-day picker (mockup screen 2). Opened by clicking an empty
// pinned slot; scoped to that slot's platform+format+weekday+hour. Two paths:
// draft a fresh piece from a recent, not-yet-covered interview
// (create-slot-atom + the existing /api/content-plan/draft, unchanged), or
// place an already-banked backlog item straight into the slot
// (/api/content-plan/assign-slot).
function AddToDayModal({ slot, weekMonday, heldItems, onClose }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [drafting, setDrafting] = useState(false)
  const [placingId, setPlacingId] = useState(null)

  const meta = PLATFORM_META[slot.platform] || { label: slot.platform, icon: null }
  const Icon = meta.icon
  const formatMeta = FORMAT_META[slot.format] || FORMAT_META.post
  const timeStr = new Date(2026, 0, 1, slot.hour).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  // Backlog items eligible for this exact slot — same platform, and either a
  // matching format or no format set yet (undrafted atoms rarely carry one).
  const eligible = (heldItems || []).filter(
    (item) => item.platform === slot.platform && (!item.format || item.format === slot.format),
  )

  async function handleDraftNew() {
    if (drafting) return
    setDrafting(true)
    try {
      const created = await apiFetch('/api/content-plan/create-slot-atom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: slot.platform, format: slot.format, weekday: slot.weekday, hour: slot.hour, weekMonday }),
      })
      const result = await apiFetch('/api/content-plan/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atom_id: created.atom.id }),
      })
      toast.success('Draft ready — in review')
      qc.invalidateQueries({ queryKey: ['week-summary'] })
      onClose()
      if (result?.content_piece?.id) navigate(`/publish/${result.content_piece.id}`)
    } catch (e) {
      if (e?.payload?.error === 'no_eligible_interview') {
        toast.info('Nothing new to draft from', {
          description: 'Every recent capture already has a piece on this channel. Start a new capture to add fresh material.',
        })
      } else {
        toast.error('Draft failed', { description: e?.message })
      }
    } finally {
      setDrafting(false)
    }
  }

  async function handlePlaceHere(item) {
    if (placingId) return
    setPlacingId(item.id)
    try {
      await apiFetch('/api/content-plan/assign-slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atomId: item.id, weekday: slot.weekday, hour: slot.hour, weekMonday }),
      })
      toast.success('Placed on the board')
      qc.invalidateQueries({ queryKey: ['week-summary'] })
      onClose()
    } catch (e) {
      toast.error('Could not place', { description: e?.message })
    } finally {
      setPlacingId(null)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add to {slot.dayLabel}{slot.dateLabel ? `, ${slot.dateLabel}` : ''}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />} {meta.label} {formatMeta.label.toLowerCase()} slot · {timeStr}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={drafting}
            onClick={handleDraftNew}
            className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 text-left transition-colors hover:border-primary disabled:opacity-50"
          >
            {drafting ? <Loader2 className="mb-2 h-5 w-5 animate-spin text-primary" aria-hidden="true" /> : <Sparkles className="mb-2 h-5 w-5 text-primary" aria-hidden="true" />}
            <div className="text-sm font-medium">Draft something new</div>
            <div className="mt-1 text-2xs text-muted-foreground">Bernard writes a caption for this slot from your recent interviews.</div>
          </button>
          <div className="rounded-lg border-2 border-border p-4 text-left">
            <Archive className="mb-2 h-5 w-5 text-primary" aria-hidden="true" />
            <div className="text-sm font-medium">Pull from backlog</div>
            <div className="mt-1 text-2xs text-muted-foreground">
              {eligible.length} {eligible.length === 1 ? 'piece' : 'pieces'} waiting.
            </div>
          </div>
        </div>
        {eligible.length > 0 && (
          <div>
            <div className="mb-2 text-2xs font-medium text-muted-foreground">
              Backlog — {meta.label}-eligible
            </div>
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {eligible.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-muted">
                    {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{contentLabel(item)}</div>
                    <div className="text-3xs text-muted-foreground">{categoryTag(item) || meta.label}</div>
                  </div>
                  <button
                    type="button"
                    disabled={placingId === item.id}
                    onClick={() => handlePlaceHere(item)}
                    className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-2xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {placingId === item.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : 'Place here'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// T3 — Month overview (mockup screen 3): a light density chip per day
// (filled/needs-review/open counts from api/_routes/content-plan/month-
// summary.js), not per-post detail — Week view stays the source of truth for
// anything more specific. Click a day jumps into Week view on that date.
const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function MonthView({ monthData, monthDate, loading, onSelectDay }) {
  const year = monthDate.getUTCFullYear()
  const month = monthDate.getUTCMonth() // 0-indexed
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const startWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay() // 0 = Sun
  const days = monthData?.days || {}

  const cells = Array.from({ length: startWeekday }, () => null)
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ d, iso, ...(days[iso] || { live: 0, review: 0, open: 0, quiet: false }) })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-1.5 grid grid-cols-7 gap-1.5 text-center text-3xs font-semibold text-muted-foreground">
        {WEEKDAY_HEADERS.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} aria-hidden="true" />
          let chip = null
          let cellCls = 'border-border bg-card hover:bg-muted/50'
          if (cell.review > 0) {
            chip = <span className="text-3xs font-semibold text-action">{cell.review} review</span>
            cellCls = 'border-action/30 bg-action/10 hover:bg-action/15'
          } else if (cell.open > 0) {
            chip = <span className="text-3xs font-semibold text-pink-600">{cell.open} open</span>
            cellCls = 'border-pink-200 bg-pink-50 hover:bg-pink-100'
          } else if (cell.live > 0) {
            chip = <span className="text-3xs font-semibold text-success">{cell.live} live</span>
            cellCls = 'border-success/30 bg-success/10 hover:bg-success/15'
          } else if (cell.quiet) {
            chip = <span className="text-3xs text-muted-foreground/60">quiet</span>
            cellCls = 'border-border bg-muted/40 hover:bg-muted/60'
          }
          return (
            <button
              key={cell.iso}
              type="button"
              onClick={() => onSelectDay(cell.iso)}
              className={`flex h-14 flex-col justify-between rounded-lg border p-1.5 text-left transition-colors sm:h-16 sm:p-2 ${cellCls}`}
            >
              <span className="text-2xs font-medium sm:text-xs">{cell.d}</span>
              {chip}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// DayPlanCard — the roomy, full-width variant of PlanCard used in Day view.
// Same status language (rail + chip + pill) and the SAME handlers as the week
// card, but with space to show the draft excerpt inline and lay the working
// actions out in a row — the "sit down and clear this day" surface.
function DayPlanCard({ item, tz, onDraft, drafting, draftBusy, onApprove, approving, readOnly }) {
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
  // Same rule as PlanCard: the body goes where this card's own "Open" goes.
  const drillHref = showOpen ? drillTo(item) : null

  return (
    <div className={`relative flex gap-3.5 overflow-hidden rounded-xl border border-border bg-card p-4 pl-5 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_18px_-12px_rgba(15,23,42,0.24)] ${drillHref ? 'transition-shadow hover:shadow-md' : ''}`}>
      {/* Stretched card link — see PlanCard for why an overlay and not a wrapper. */}
      {drillHref && (
        <Link
          to={drillHref}
          aria-label={`Open ${contentLabel(item)}`}
          className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        />
      )}
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
        <span className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-3xs font-bold ${state.cls}`}>
          {state.label}
        </span>
        {item.predrafted && (
          <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-3xs font-bold text-foreground" title="Bernard drafted this ahead of the week">
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
      <div className="relative z-20 mt-3 flex flex-wrap items-center gap-2">
        {!readOnly && state.action === 'draft' && (
          <button
            type="button"
            disabled={drafting || draftBusy}
            title={!drafting && draftBusy ? 'Already drafting another post — please wait' : undefined}
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
  // Week boundaries flip at the workspace's LOCAL midnight, not the browser's or
  // UTC's (see weekMondayDate). Available here pre-query; the server mirrors it
  // from ws.cadence_policy.timezone so the ?week= it receives matches.
  const wsTz = workspace?.cadence_policy?.timezone || 'America/Los_Angeles'
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
  const [viewMode, setViewMode] = useState('week')   // 'week' board | 'day' focused work surface | 'month' light overview
  const [selectedDay, setSelectedDay] = useState(null) // day key ('mon'..'sun'); null = auto (today/first)
  const [togglingQuietDay, setTogglingQuietDay] = useState(null) // day key being toggled, for the inline spinner
  const [addToDaySlot, setAddToDaySlot] = useState(null) // {platform, weekday, hour, format, dayLabel, dateLabel} | null
  const [monthOffset, setMonthOffset] = useState(0) // T3 — months from the current calendar month; independent of weekOffset
  const { data, isLoading } = useQuery({
    queryKey: ['week-summary', weekOffset],
    queryFn: () => apiFetch(`/api/content-plan/week-summary${weekOffset ? `?week=${weekMondayISO(weekOffset, wsTz)}` : ''}`),
    enabled: !roleLoading,
    refetchOnWindowFocus: false,
  })
  // T3 — Month overview data, fetched only while that view is active (a
  // separate lightweight endpoint, not a fan-out over week-summary — see
  // api/_routes/content-plan/month-summary.js for why).
  const monthDate = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + monthOffset, 1))
  const monthKey = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, '0')}`
  const { data: monthData, isLoading: monthLoading } = useQuery({
    queryKey: ['month-summary', monthKey],
    queryFn: () => apiFetch(`/api/content-plan/month-summary?month=${monthKey}`),
    enabled: !roleLoading && viewMode === 'month',
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
      // Over the platform's hard character ceiling. The piece was left alone and
      // is still a draft, so name the exact overage and what to do about it.
      if (e?.payload?.error === 'caption_too_long') {
        const { cap, over } = e.payload
        toast.error(`Too long for ${PLATFORM_META[item.platform]?.label || item.platform}`, {
          description: `The caption is ${over} character${over === 1 ? '' : 's'} over the ${cap} limit. Open it and shorten it, then approve.`,
        })
      } else {
        toast.error('Approve failed', { description: e?.message })
      }
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
        body: JSON.stringify({ week: weekMondayISO(weekOffset, wsTz) }),
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

  // T3 — quiet-day toggle, inline on the board. Q flagged this repeatedly:
  // quiet days were only editable at Settings → Channels → Cadence, and only
  // after flipping Auto→Manual — effectively undiscoverable (D3 in the T3
  // brief). PATCHes cadence_policy.quiet_days directly against the CURRENT
  // policy (spread, not replaced) so target_per_week/slots/etc. survive —
  // same field this endpoint already accepts, same provenance:'user' side
  // effect the Settings toggle uses (hand-editing quiet days is a manual
  // cadence decision). Invalidates both the workspace row (so the toggle
  // persists across a reload) and week-summary (so the board reflects it now).
  async function handleToggleQuietDay(day) {
    if (togglingQuietDay) return
    setTogglingQuietDay(day)
    const current = workspace?.cadence_policy || {}
    const currentQuiet = Array.isArray(current.quiet_days) ? current.quiet_days : ['sat', 'sun']
    const nextQuiet = currentQuiet.includes(day) ? currentQuiet.filter((d) => d !== day) : [...currentQuiet, day]
    try {
      await apiFetch('/api/workspace/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadence_policy: { ...current, quiet_days: nextQuiet, provenance: 'user' } }),
      })
      qc.invalidateQueries({ queryKey: queryKeys.workspace.me })
      qc.invalidateQueries({ queryKey: ['week-summary'] })
      toast.success(nextQuiet.includes(day) ? `${DAY_FULL[day]} is now quiet` : `${DAY_FULL[day]} is open for posting`)
    } catch (e) {
      toast.error('Could not update quiet days', { description: e?.message })
    } finally {
      setTogglingQuietDay(null)
    }
  }

  if (roleLoading || isLoading) return <PageSkeleton variant="dashboard" />

  const quiet = new Set((data?.quietDays || ['sat', 'sun']).map((q) => q.toLowerCase()))
  const cadence = data?.cadence || {}
  const scheduled = data?.scheduled || []
  const tz = data?.timezone || wsTz

  // Group scheduled atoms into day columns.
  const byDay = {}
  for (const [k] of DAYS) byDay[k] = []
  for (const item of scheduled) {
    const k = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(new Date(item.scheduled_at)).toLowerCase().slice(0, 3)
    if (byDay[k]) byDay[k].push(item)
  }

  // T3 — pinned slots with no matching atom this week ("+ open slot" tiles).
  // Only meaningful for the current/future week — a past week is read-only,
  // so there's nothing left to invite placing into it.
  const emptySlots = isPast ? [] : computeEmptySlots(cadence, scheduled, tz)
  const emptyByDay = {}
  for (const [k] of DAYS) emptyByDay[k] = []
  for (const slot of emptySlots) {
    if (emptyByDay[slot.weekday]) emptyByDay[slot.weekday].push(slot)
  }
  // Real cards + open-slot tiles interleaved by local hour, so the day column
  // reads chronologically top-to-bottom regardless of which is which.
  function dayColumnEntries(dayKey) {
    const items = (byDay[dayKey] || []).map((item) => ({
      kind: 'item', hour: localSlotParts(item.scheduled_at, tz).hour, item,
    }))
    const slots = (emptyByDay[dayKey] || []).map((slot) => ({ kind: 'empty', hour: slot.hour, slot }))
    return [...items, ...slots].sort((a, b) => a.hour - b.hour)
  }

  // Today's column key — only on the current week (a past/future week has no
  // "today" to anchor). Resolved in the workspace tz so it matches byDay above.
  const todayKey = weekOffset === 0
    ? new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(new Date()).toLowerCase().slice(0, 3)
    : null

  // Day view: per-day calendar dates for the strip, and the resolved active day.
  const weekMondayForStrip = weekMondayDate(weekOffset, wsTz)
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
  const nextStage = LADDER[stageIdx + 1] || null

  // Whole days of this week already behind you, in the workspace tz — Monday
  // is 0, so nothing is "late" on a Monday. A future week is 0 (planning ahead
  // is never behind); a past week never reaches the amber test at all.
  const weekElapsedDays = weekOffset === 0 && todayKey
    ? Math.max(0, DAYS.findIndex(([k]) => k === todayKey))
    : 0

  // Flat chip list for the schedule strip. Instagram is the one channel that
  // spans multiple formats (post/reel/story all key under `instagram`), so it
  // contributes one chip per format — otherwise a full Instagram bar hides an
  // empty Reel target.
  //
  // `short` drives the amber treatment, and it is PACE-aware rather than a
  // flat got < target. Flat comparison lit up three of five chips on a normal
  // Wednesday — at which point amber is just the strip's colour and stops
  // meaning "act now". A channel is only short if it is behind where it should
  // be by this day of the week, so a 2/3 on Wednesday reads as on-pace while a
  // 0/3 does not. Over target is not a warning, and a finished week can't be
  // acted on, so neither goes amber.
  const cadenceChips = Object.entries(cadence)
    .filter(([, c]) => c?.enabled)
    .flatMap(([platform, cfg]) => {
      const meta = PLATFORM_META[platform] || { label: platform, icon: null }
      if (platform === 'instagram') {
        return ['post', 'reel', 'story']
          .map((format) => ({
            key: `${platform}-${format}`,
            platform,
            label: `IG ${FORMAT_META[format].label}`,
            icon: FORMAT_META[format].icon,
            target: (cfg.slots || []).filter((s) => (s.format || 'post') === format && s.enabled !== false).length,
            got: scheduled.filter((it) => it.platform === platform && (it.format || 'post') === format).length,
          }))
          .filter((c) => c.target > 0 || c.got > 0)
      }
      return [{
        key: platform,
        platform,
        label: meta.label,
        icon: meta.icon,
        target: cfg.target_per_week || 0,
        got: data?.byPlatform?.[platform] || 0,
      }]
    })
    .map((c) => ({ ...c, short: !isPast && c.got < (c.target * weekElapsedDays) / 7 }))

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

  // Unified control bar (Option B) — one compact row: Week/Day toggle · ‹ prev
  // week · the center (day chips in Day view, the week range in Week view) ·
  // next week ›. Rendered once, below the posting schedule when there's a plan,
  // and above the empty state otherwise so you can always page between weeks.
  const controlBarEl = (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 px-0.5">
        <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">{weekRangeLabel(weekOffset, wsTz)}</span>
        <span className="text-2xs font-bold uppercase tracking-wide text-primary">· {weekRelative(weekOffset)}</span>
      </div>
      <div className="flex items-stretch gap-2">
        {/* T3 — always reachable (not gated on this week having a plan): Month
            is a workspace-wide overview, independent of any single week. */}
        <div role="group" aria-label="View" className="inline-flex shrink-0 items-center rounded-lg border bg-card p-0.5 text-xs">
          {['week', 'day', 'month'].map((m) => (
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
        <button
          type="button"
          onClick={() => setWeekOffset((o) => Math.max(-NAV_BACK, o - 1))}
          disabled={weekOffset <= -NAV_BACK}
          aria-label="Previous week"
          className="flex w-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        {viewMode === 'day' && data?.hasPlan ? (
          <div className="flex min-w-0 flex-1 gap-1.5">
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
                  className={`min-w-0 flex-1 rounded-lg border px-1 py-1.5 text-center leading-tight transition-colors ${
                    isSel ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                          : `bg-card hover:border-primary/40 ${isTod ? 'border-primary/40' : 'border-border'}`
                  }`}
                >
                  <div className={`text-3xs font-bold uppercase tracking-wide ${isSel ? '' : isTod ? 'text-primary' : 'text-muted-foreground'}`}>{label}</div>
                  <div className="leading-none">
                    <span className={`text-sm font-extrabold tabular-nums ${isSel ? '' : count ? 'text-foreground' : 'text-muted-foreground/40'}`}>{dayDates[i]}</span>
                    {count > 0 && <span className={`ml-0.5 text-3xs font-bold ${isSel ? 'text-primary-foreground/75' : 'text-muted-foreground/60'}`}>{count}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-lg border bg-card px-3">
            <span className="text-sm font-bold text-foreground">{weekRangeLabel(weekOffset, wsTz)}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setWeekOffset((o) => Math.min(NAV_FWD, o + 1))}
          disabled={weekOffset >= NAV_FWD}
          aria-label="Next week"
          className="flex w-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        {weekOffset !== 0 && (
          <button
            type="button"
            onClick={() => setWeekOffset(0)}
            className="shrink-0 rounded-lg border bg-card px-2.5 text-2xs font-semibold text-muted-foreground hover:bg-muted"
          >
            Today
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-5 py-6">
      {/* Dead-ends Bernard can't clear on its own. Chief among them on this page:
          the footage-ask — the week wants Reels and there's nothing left worth
          cutting. Self-gating (renders null when the producer is off or nothing
          is outstanding) and shares the /producer query by react-query key, so
          mounting it here costs no extra fetch. */}
      <NeedsYouStrip />
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
          {/* Backlog moved out of the right rail and into the header: the rail
              was a 6-row preview of the drawer below, and cost the board 288px
              of width on every week. The button opens that same drawer. */}
          {data?.heldCount > 0 && (
            <button
              type="button"
              onClick={() => setBacklogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-2xs font-semibold text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Archive className="h-3 w-3" aria-hidden="true" /> Backlog · {data.heldCount}
            </button>
          )}
          {/* Trust mode is display-only (see LADDER) and changes at most a few
              times a year, so it reads as a status pill rather than a card
              above the week. The detail lives one click away. */}
          {isEditor && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-2xs font-semibold text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  Stage {stageIdx + 1} of {LADDER.length}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <div className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">Your mode</div>
                <div className="mt-1 text-sm font-bold">{LADDER[stageIdx]?.[1]}</div>
                <div className="mt-2 flex gap-1" aria-hidden="true">
                  {LADDER.map(([s], i) => (
                    <span key={s} className={`h-1 flex-1 rounded-full ${i <= stageIdx ? 'bg-primary' : 'bg-muted-foreground/20'}`} />
                  ))}
                </div>
                <p className="mt-2 text-2xs text-muted-foreground">{LADDER[stageIdx]?.[2]}</p>
                {nextStage && (
                  <p className="mt-1.5 text-3xs text-muted-foreground/85">
                    Next rung: {nextStage[1]} — Bernard asks once you&apos;ve greenlit enough.
                  </p>
                )}
              </PopoverContent>
            </Popover>
          )}
          <PageHelp pageKey="your-week" variant="default" />
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-2xs font-medium text-muted-foreground">
            <Shield className="h-3 w-3" aria-hidden="true" /> {isEditor ? 'Producer' : 'Clinician'} view
          </span>
        </div>
      </div>

      {/* Clinician review slice (2d) */}
      {YourReviewSlice}

      {/* T3 — Month overview bypasses the rest of the Week/Day tree entirely
          (mode banner, cadence strip, board, backlog rail all belong to a
          single week; Month is a workspace-wide, week-independent view). */}
      {viewMode === 'month' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-lg font-bold">
                {monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div role="group" aria-label="View" className="inline-flex shrink-0 items-center rounded-lg border bg-card p-0.5 text-xs">
                {['week', 'day', 'month'].map((m) => (
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
              <button
                type="button"
                onClick={() => setMonthOffset((o) => o - 1)}
                aria-label="Previous month"
                className="flex w-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:bg-muted"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setMonthOffset((o) => o + 1)}
                aria-label="Next month"
                className="flex w-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:bg-muted"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
              {monthOffset !== 0 && (
                <button
                  type="button"
                  onClick={() => setMonthOffset(0)}
                  className="shrink-0 rounded-lg border bg-card px-2.5 text-2xs font-semibold text-muted-foreground hover:bg-muted"
                >
                  Today
                </button>
              )}
            </div>
          </div>
          <MonthView
            monthData={monthData}
            monthDate={monthDate}
            loading={monthLoading}
            onSelectDay={(iso) => {
              setWeekOffset(Math.max(-NAV_BACK, Math.min(NAV_FWD, weekOffsetForDate(iso, wsTz))))
              setViewMode('week')
            }}
          />
        </div>
      ) : (
      <>
      {/* Pre-draft summary. Unlike the trust mode (now a header pill — it is
          standing furniture that changes a few times a year), this is a real
          per-week event: it frames /week as a review session on the weeks
          Bernard actually drafted ahead, and renders on no other week. */}
      {data?.predraftSummary?.predrafted > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.04] p-3.5">
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

      {/* Per-week context banner */}
      {isPast && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-2xs text-muted-foreground">
          <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span><b className="text-foreground">Past week — read-only.</b> What ran the week of {weekRangeLabel(weekOffset, wsTz)}. Open any piece to view it; finished weeks can&apos;t be re-planned.</span>
        </div>
      )}
      {isFuture && data?.hasPlan && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-2xs text-primary">
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span><b>Planned ahead.</b> Review &amp; approve these now — they sit ready until {weekRangeLabel(weekOffset, wsTz)}. Nothing publishes without your yes.</span>
        </div>
      )}

      {/* On an empty week the controls sit above the empty state so you can still
          page between weeks; on a planned week they move below the schedule. */}
      {!data?.hasPlan && controlBarEl}

      {!data?.hasPlan ? (
        isFuture ? (
          <div className="rounded-lg border border-dashed bg-muted/20 py-12 text-center">
            <CalendarPlus className="mx-auto h-8 w-8 text-primary/60" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-foreground">Nothing planned for {weekRangeLabel(weekOffset, wsTz)} yet</p>
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
            <p className="mt-2 text-sm font-medium text-foreground">Nothing ran the week of {weekRangeLabel(weekOffset, wsTz)}</p>
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
          {/* Cadence strip — one line of channel chips rather than a 4-column
              card. This is the one signal the board itself cannot show: an
              unfilled target and a genuinely quiet week look identical on a
              calendar, so it stays visible instead of moving behind a click
              like the mode and backlog did. Each chip still links to that
              channel's posts (2026-07-22 UX pain check: 3 dead clicks on the
              old counts) and still carries the scheduled/target tooltip that
              the removed explainer sentence used to spell out. */}
          {cadenceChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border bg-card px-3 py-2">
              <span className="mr-1 text-2xs font-bold uppercase tracking-wide text-muted-foreground">Schedule</span>
              {cadenceChips.map((chip) => (
                <Tooltip key={chip.key}>
                  <TooltipTrigger asChild>
                    <Link
                      to={`/stories?platform=${encodeURIComponent(chip.platform)}`}
                      aria-label={`${chip.label} — ${chip.got} scheduled this week, target ${chip.target} per week. View posts.`}
                      className={`inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-2xs font-semibold transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                        chip.short ? 'bg-action/10 text-action' : 'bg-muted/50 text-muted-foreground'
                      }`}
                    >
                      {chip.icon && <chip.icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
                      <span>{chip.label}</span>
                      <span className="h-1 w-6 shrink-0 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                        <span
                          className={`block h-full rounded-full ${chip.short ? 'bg-action' : 'bg-primary'}`}
                          style={{ width: `${chip.target ? Math.min(100, (chip.got / chip.target) * 100) : 0}%` }}
                        />
                      </span>
                      <span className={chip.short ? '' : 'text-foreground'}>
                        <b>{chip.got}</b>/{chip.target}
                      </span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                    {chip.got} scheduled this week · target {chip.target}/week
                    {chip.short ? ' · behind pace for this point in the week' : ''}
                  </TooltipContent>
                </Tooltip>
              ))}
              <span className="ml-auto inline-flex items-center gap-2 pl-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-3xs font-semibold text-primary">
                  <Sparkles className="h-3 w-3" aria-hidden="true" /> {data.scheduledTotal} scheduled
                </span>
                <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {tzLabel(tz)}
                </span>
              </span>
            </div>
          )}

          {/* Control bar — directly below the posting schedule, above the board. */}
          {controlBarEl}

          <div className="flex flex-col gap-4">
            {/* Calendar — full width. The backlog rail that used to sit beside
                it moved to a header button (it was a 6-row preview of the
                drawer below, for 288px of board width every week). */}
            <div className="min-w-0">
              {viewMode === 'day' ? (
                <div>
                  {/* Selected day's posts as roomy working cards (the day picker
                      lives in the control bar above). */}
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
                              draftBusy={!!draftingAtom}
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
                  // Quiet days never show "open slot" invitations, even if a
                  // stale pinned slot references that weekday — but a real,
                  // already-scheduled item (a human override) still shows.
                  const entries = dayColumnEntries(key).filter((e) => e.kind === 'item' || !isQuiet)
                  const itemCount = entries.filter((e) => e.kind === 'item').length
                  const isToday = key === todayKey
                  return (
                    <div key={key} className={`flex min-h-[160px] flex-col rounded-xl border bg-card shadow-sm transition-shadow ${isToday ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'}`}>
                      <div className="flex items-center justify-between px-2.5 pt-2.5 pb-1.5">
                        <span className={`text-2xs font-bold ${isToday ? 'text-primary' : ''}`}>
                          {label}{isToday && ' · Today'}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {itemCount > 0 && (
                            <span className="text-3xs font-semibold text-muted-foreground/60 tabular-nums">{itemCount}</span>
                          )}
                          {/* T3 — quiet day toggle lives on the board now, not
                              buried in Settings → Auto/Manual. */}
                          {!isPast && (
                            <button
                              type="button"
                              onClick={() => handleToggleQuietDay(key)}
                              disabled={togglingQuietDay === key}
                              title={isQuiet ? 'Turn on posting for this day' : 'Mark this day quiet'}
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
                                isQuiet ? 'text-muted-foreground hover:bg-muted' : 'text-primary hover:bg-primary/10'
                              }`}
                            >
                              {togglingQuietDay === key ? (
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                              ) : isQuiet ? (
                                <BellOff className="h-3 w-3" aria-hidden="true" />
                              ) : (
                                <Bell className="h-3 w-3" aria-hidden="true" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                        {entries.length === 0 ? (
                          isQuiet ? (
                            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-muted-foreground">
                              <Moon className="h-4 w-4" aria-hidden="true" />
                              <span className="text-3xs font-semibold">Quiet day</span>
                              {!isPast && (
                                <button
                                  type="button"
                                  onClick={() => handleToggleQuietDay(key)}
                                  disabled={togglingQuietDay === key}
                                  className="text-3xs font-semibold text-primary hover:underline disabled:opacity-50"
                                >
                                  Turn on posting
                                </button>
                              )}
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
                          entries.map((entry) => (
                            entry.kind === 'item' ? (
                              <PlanCard
                                key={entry.item.id}
                                item={entry.item}
                                tz={tz}
                                onDraft={handleDraft}
                                drafting={draftingAtom === entry.item.id}
                                draftBusy={!!draftingAtom}
                                readOnly={isPast}
                              />
                            ) : (
                              <EmptySlotTile
                                key={`${entry.slot.platform}-${entry.slot.weekday}-${entry.slot.hour}-${entry.slot.format}`}
                                slot={entry.slot}
                                onClick={() => setAddToDaySlot({ ...entry.slot, dayLabel: DAY_FULL[key], dateLabel: dayDates[DAYS.findIndex(([k]) => k === key)] })}
                              />
                            )
                          ))
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              )}
            </div>

            {/* Opened from the header button — the rail was only ever a
                preview of this list. Unchanged. */}
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

            {/* Below the board: the two cards that outlived the rail. Both are
                per-week status, not standing navigation, so they read fine
                after the week rather than beside it. */}
            {(data.digest || (!isPast && approvedSchedulable.length > 0)) && (
            <div className="grid gap-3 sm:grid-cols-2">
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
            )}
          </div>
        </>
      )}
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

      {/* T3 — Add-to-day picker, opened from an empty pinned slot tile. */}
      {addToDaySlot && (
        <AddToDayModal
          slot={addToDaySlot}
          weekMonday={data.weekMonday}
          heldItems={data.held}
          onClose={() => setAddToDaySlot(null)}
        />
      )}
    </div>
  )
}
