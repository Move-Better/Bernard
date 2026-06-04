import { useState, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader2, CalendarDays, CalendarPlus, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/EmptyState'
import { PLATFORM_META } from '@/lib/contentMeta'
import { isOptimalSlot, isOptimalDay } from '@/lib/scheduleHeuristics'
import { useWorkspace } from '@/lib/WorkspaceContext'

// A piece "has media" when at least one entry is attached — drives the
// unscheduled rail's "Schedule" target (Publish if media is on, else the
// media picker). Mirrors the Storyboard / Review Inbox predicate.
const HAS_MEDIA = (p) => Array.isArray(p?.media_urls) && p.media_urls.length > 0

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(date) { return date.toISOString().slice(0, 10) }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1) }
function daysInMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() }
function startOfWeek(date) {
  const d = new Date(date)
  const dow = d.getDay()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - dow)
  return d
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

/**
 * StoriesCalendarView — calendar grid driven by stories prop.
 *
 * Extracts all pieces that have a scheduled_at and lays them on the
 * month / week grid. Read-only — reschedule lives on the full ContentCalendar
 * page (accessible via the legacy /calendar redirect).
 */
export default function StoriesCalendarView({ stories, isLoading }) {
  const [today]       = useState(new Date())
  const [view, setView]          = useState('plan')
  const [current, setCurrent]    = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [weekAnchor, setWeekAnchor] = useState(startOfWeek(today))

  // Flatten all scheduled pieces across stories, annotated with topic + story id
  // + staff name (so chips can attribute the post to who it's from).
  const scheduledPieces = useMemo(() => {
    if (!Array.isArray(stories)) return []
    return stories.flatMap((story) =>
      (story.pieces ?? [])
        .filter((p) => p.scheduled_at)
        .map((p) => ({
          ...p,
          topic: story.topic,
          storyId: story.id,
          staffName: p.staff_name || story.staff_name,
        })),
    )
  }, [stories])

  // Approved but NOT yet scheduled — the producer's "still needs a go-live time"
  // list. Surfaced beside the grid so an approved piece never falls through the
  // gap between "approved" and "on the calendar." Newest first.
  const unscheduledApproved = useMemo(() => {
    if (!Array.isArray(stories)) return []
    return stories
      .flatMap((story) =>
        (story.pieces ?? [])
          .filter((p) => p.status === 'approved' && !p.scheduled_at)
          .map((p) => ({
            ...p,
            topic: story.topic,
            storyId: story.id,
            staffName: p.staff_name || story.staff_name,
          })),
      )
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
  }, [stories])

  // Distinct channels present across the board — drives the colour legend so the
  // chips' per-platform tints are decodable at a glance.
  const channelsPresent = useMemo(() => {
    const seen = new Set()
    for (const p of [...scheduledPieces, ...unscheduledApproved]) {
      if (p.platform && PLATFORM_META[p.platform]) seen.add(p.platform)
    }
    return [...seen]
  }, [scheduledPieces, unscheduledApproved])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Two-column layout once there's an unscheduled-approved backlog: the grid on
  // the left, the "needs a slot" rail on the right. Falls back to full width
  // (the original layout) when the backlog is empty so nothing shifts for the
  // common case.
  const hasRail = unscheduledApproved.length > 0

  return (
    <div className={hasRail ? 'grid gap-5 lg:grid-cols-[1fr_280px]' : ''}>
      <div className="space-y-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center bg-muted rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setView('plan')}
              className={`px-2 py-1 text-xs rounded ${view === 'plan' ? 'bg-background shadow' : 'text-muted-foreground'}`}
            >
              Plan
            </button>
            <button
              type="button"
              onClick={() => setView('month')}
              className={`px-2 py-1 text-xs rounded ${view === 'month' ? 'bg-background shadow' : 'text-muted-foreground'}`}
            >
              Month
            </button>
            <button
              type="button"
              onClick={() => setView('week')}
              className={`px-2 py-1 text-xs rounded ${view === 'week' ? 'bg-background shadow' : 'text-muted-foreground'}`}
            >
              Week
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {view === 'plan' ? 'Content trickles out across the next 4 weeks' : 'Tinted cells = high-engagement windows'}
          </p>
        </div>

        {/* Channel legend — decode the per-platform chip tints. */}
        {channelsPresent.length > 0 && <ChannelLegend channels={channelsPresent} />}

        {view === 'plan' ? (
          <PlanView today={today} items={scheduledPieces} />
        ) : view === 'month' ? (
          <MonthView
            current={current}
            today={today}
            items={scheduledPieces}
            onPrev={() => setCurrent(new Date(current.getFullYear(), current.getMonth() - 1, 1))}
            onNext={() => setCurrent(new Date(current.getFullYear(), current.getMonth() + 1, 1))}
          />
        ) : (
          <WeekView
            anchor={weekAnchor}
            today={today}
            items={scheduledPieces}
            onPrev={() => setWeekAnchor(new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate() - 7))}
            onNext={() => setWeekAnchor(new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate() + 7))}
          />
        )}

        {view !== 'plan' && scheduledPieces.length === 0 && (
          <EmptyState
            icon={<CalendarDays className="h-5 w-5" />}
            title="Nothing scheduled yet"
            description="Schedule an approved piece from the list on the right to see it land here."
            size="sm"
          />
        )}
      </div>

      {hasRail && <UnscheduledRail items={unscheduledApproved} />}
    </div>
  )
}

// Per-channel colour legend. Reuses each platform's icon + brand text colour so
// the swatch matches the EventChip tint exactly.
function ChannelLegend({ channels }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {channels.map((p) => {
        const pm = PLATFORM_META[p]
        const Icon = pm?.icon
        return (
          <span key={p} className="inline-flex items-center gap-1 text-3xs text-muted-foreground">
            {Icon && <Icon className={`h-3 w-3 ${pm?.color || ''}`} />}
            {pm?.label || p}
          </span>
        )
      })}
    </div>
  )
}

// "Approved · unscheduled" rail — the producer's backlog of pieces that have
// been signed off but have no go-live time yet. Each links to the schedule flow
// (Publish if media is attached, else the media picker). Read-only here; the
// bulk auto-space scheduler is the paired follow-up.
function UnscheduledRail({ items }) {
  return (
    <aside className="space-y-2 lg:border-l lg:pl-5">
      <div className="flex items-center gap-1.5">
        <CalendarPlus className="h-3.5 w-3.5 text-primary" />
        <p className="text-2xs font-bold uppercase tracking-wide text-primary">
          Approved · unscheduled · {items.length}
        </p>
      </div>
      <p className="text-3xs text-muted-foreground">Signed off, waiting on a go-live time.</p>
      <div className="space-y-2 pt-1">
        {items.map((item) => {
          const pm = PLATFORM_META[item.platform]
          const Icon = pm?.icon
          const to = HAS_MEDIA(item)
            ? `/storyboard/${item.id}/publish`
            : `/storyboard/${item.id}`
          return (
            <Link
              key={item.id}
              to={to}
              className="group block rounded-lg border bg-card px-3 py-2 transition-colors hover:border-primary/40"
            >
              <span className="inline-flex items-center gap-1 text-3xs font-semibold">
                {Icon && <Icon className={`h-3 w-3 ${pm?.color || ''}`} />}
                {pm?.label || item.platform}
              </span>
              <p className="mt-1 truncate text-2xs font-medium text-foreground">{item.topic}</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                {item.staffName ? (
                  <span className="truncate text-3xs text-muted-foreground">{item.staffName}</span>
                ) : <span />}
                <span className="inline-flex shrink-0 items-center gap-0.5 text-3xs font-medium text-primary">
                  Schedule <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </aside>
  )
}

// PlanView — the "by ship date" trickle view: the current week plus the next
// three, each a card. Empty weeks read "thin week" so the surface never looks
// barren the way a mostly-empty month grid does. Matches the portfolio mockup.
function PlanView({ today, items }) {
  const weekStart = startOfWeek(today)
  const weeks = Array.from({ length: 4 }, (_, w) => {
    const start = new Date(weekStart)
    start.setDate(weekStart.getDate() + w * 7)
    const end = new Date(start)
    end.setDate(start.getDate() + 7)
    const wkItems = items
      .filter((it) => {
        const t = new Date(it.scheduled_at)
        return t >= start && t < end
      })
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    return { start, items: wkItems }
  })

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {weeks.map((wk, i) => (
        <div key={i} className="rounded-xl border bg-card p-3">
          <div className="mb-2 flex items-baseline gap-1.5">
            <span className="text-xs font-semibold">Week {i + 1}</span>
            <span className="text-3xs text-muted-foreground">
              {wk.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {wk.items.length}
            </span>
          </div>
          <div className="space-y-1.5">
            {wk.items.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">thin week</p>
            ) : (
              wk.items.map((item) => <PlanRow key={item.id} item={item} />)
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function PlanRow({ item }) {
  const pm = PLATFORM_META[item.platform]
  const Icon = pm?.icon
  const t = new Date(item.scheduled_at)
  return (
    <Link
      to={`/stories/${item.storyId}`}
      title={`${pm?.label || item.platform} · ${item.topic}${item.staffName ? ` · ${item.staffName}` : ''}`}
      className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors hover:border-primary"
    >
      {Icon && <Icon className={`h-3 w-3 shrink-0 ${pm?.color || 'text-muted-foreground'}`} />}
      <span className="flex-1 truncate">
        {item.topic}
        {item.staffName ? <span className="text-muted-foreground"> · {item.staffName}</span> : null}
      </span>
      <span className="shrink-0 text-3xs text-muted-foreground">{DAY_NAMES[t.getDay()]} {t.getDate()}</span>
    </Link>
  )
}

function MonthView({ current, today, items, onPrev, onNext }) {
  const workspace = useWorkspace()
  const prefsOverride = workspace?.schedule_prefs
  const byDate = useMemo(() => {
    const map = {}
    items.forEach((item) => {
      const date = item.scheduled_at?.slice(0, 10)
      if (!date) return
      if (!map[date]) map[date] = []
      map[date].push(item)
    })
    return map
  }, [items])

  const firstDow  = startOfMonth(current).getDay()
  const totalDays = daysInMonth(current)
  const cells     = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30">
        <Button variant="ghost" size="icon" onClick={onPrev}><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="font-semibold">{MONTH_NAMES[current.getMonth()]} {current.getFullYear()}</h2>
        <Button variant="ghost" size="icon" onClick={onNext}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-7 border-b">
        {DAY_NAMES.map((d, i) => (
          <div key={d} className={`py-2 text-center text-xs font-medium ${isOptimalDay(i, prefsOverride) ? 'text-success' : 'text-muted-foreground'}`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="min-h-[100px] border-b border-r bg-muted/20" />
          const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const dayItems = byDate[dateStr] || []
          const dow = new Date(current.getFullYear(), current.getMonth(), day).getDay()
          const isToday = dateStr === isoDate(today)
          const optimal = isOptimalDay(dow, prefsOverride)
          return (
            <div
              key={day}
              className={`min-h-[100px] border-b p-1.5 ${i % 7 !== 6 ? 'border-r' : ''} ${optimal ? 'bg-success/10' : ''}`}
            >
              <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{day}</div>
              <div className="space-y-0.5">
                {dayItems.slice(0, 3).map((item) => <EventChip key={item.id} item={item} />)}
                {dayItems.length > 3 && (
                  <p className="text-3xs text-muted-foreground pl-1">+{dayItems.length - 3} more</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekView({ anchor, today, items, onPrev, onNext }) {
  const workspace = useWorkspace()
  const prefsOverride = workspace?.schedule_prefs
  const HOURS = Array.from({ length: 15 }, (_, i) => 7 + i)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anchor)
    d.setDate(anchor.getDate() + i)
    return d
  })
  const byDayHour = useMemo(() => {
    const map = {}
    items.forEach((item) => {
      if (!item.scheduled_at) return
      const t = new Date(item.scheduled_at)
      const key = `${isoDate(t)}|${t.getHours()}`
      if (!map[key]) map[key] = []
      map[key].push(item)
    })
    return map
  }, [items])

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30">
        <Button variant="ghost" size="icon" onClick={onPrev}><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="font-semibold">
          Week of {days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </h2>
        <Button variant="ghost" size="icon" onClick={onNext}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b">
        <div />
        {days.map((d) => (
          <div key={d.toISOString()} className={`py-2 text-center text-xs ${isoDate(d) === isoDate(today) ? 'font-bold text-primary' : 'text-muted-foreground'}`}>
            {DAY_NAMES[d.getDay()]} <span className="font-medium">{d.getDate()}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[60px_repeat(7,1fr)]">
        {HOURS.map((h) => (
          <Fragment key={h}>
            <div className="border-b border-r text-3xs text-muted-foreground py-2 px-2">{h}:00</div>
            {days.map((d, di) => {
              const optimal = isOptimalSlot(d.getDay(), h, prefsOverride)
              const slotItems = byDayHour[`${isoDate(d)}|${h}`] || []
              return (
                <div
                  key={`${h}-${di}`}
                  className={`min-h-[44px] border-b p-0.5 ${di < 6 ? 'border-r' : ''} ${optimal ? 'bg-success/10' : ''}`}
                >
                  <div className="space-y-0.5">
                    {slotItems.map((item) => <EventChip key={item.id} item={item} />)}
                  </div>
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function EventChip({ item }) {
  const pm = PLATFORM_META[item.platform]
  return (
    <Link
      to={`/stories/${item.storyId}`}
      title={`${pm?.label || item.platform} · ${item.topic}${item.staffName ? ` · ${item.staffName}` : ''}`}
      className={`block text-3xs px-1.5 py-0.5 rounded truncate ${pm?.bg || 'bg-muted'} ${pm?.color || ''} hover:opacity-80 transition-opacity`}
    >
      {pm?.label || item.platform} · {item.topic}
    </Link>
  )
}
