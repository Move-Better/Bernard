import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays, Users, Receipt, Mic, Sparkles,
  Video, Volume2, Presentation, X, Image, Play, Flame, Infinity as InfinityIcon,
  ChevronLeft, ChevronRight, Award, AlertTriangle, Clock,
} from 'lucide-react'
import { getInitials } from '@/lib/utils'
import { useWorkspaceRecap, useWorkspaceWeekRecap } from '@/lib/queries'
import {
  deriveNowQueues, computeStreak, classifyMember, sortTeam, platformLabels,
  fmtWeekRange, weekRelative, floorWeekOffset,
} from '@/lib/recapDerive'
import { buildCostView, estimateWindow, fmtUsd, fmtMinutes } from '@/lib/costEstimate'
import { NumberTicker } from '@/components/ui/number-ticker'
import { Skeleton } from '@/components/ui/skeleton'

// The Overview recap — a workspace-wide snapshot built to be screen-shared in
// the weekly all-staff meeting, now navigable by calendar week (Mon–Sun, the
// same week definition as Insights and the capture streaks). Blocks:
//   • the week recap (published / captured / drafted / est. cost, with
//     vs-last-week deltas + the week's item lists + top post) — server-computed
//     by workspace_week_recap() so there's exactly one source of truth
//   • "Right now" queues (scheduled next / in review) — pinned to the present,
//     they don't move when you step between weeks
//   • team cadence (all-time counts + consistency streaks + gentle "due" nudges)
//   • an estimated cost-to-run tile
// "Present mode" blows the whole thing up fullscreen, showing the selected
// week — step back to last week before Monday's meeting and present that.

function dayLabel(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' })
}
function dateTimeLabel(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' }) + ' ' +
    new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// ── Stat tile + delta chip ──────────────────────────────────────────────────
function DeltaChip({ cur, prev, money = false, invert = false }) {
  if (prev == null) return null
  const d = cur - prev
  if (d === 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-px text-2xs font-semibold text-muted-foreground">
        — same as last wk
      </span>
    )
  }
  const up = d > 0
  const good = invert ? !up : up
  const cls = good
    ? 'bg-success/10 text-success'
    : 'bg-muted text-muted-foreground'
  const mag = money ? fmtUsd(Math.abs(d)) : Math.abs(d)
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-px text-2xs font-semibold ${cls}`}>
      {up ? '▲' : '▼'} {mag} vs last wk
    </span>
  )
}

function Stat({ value, label, color, format, delta }) {
  return (
    <div className="p-4 text-center">
      <p className="text-3xl font-extrabold" style={{ color }}>
        <NumberTicker value={value} format={format} />
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      {delta ? <p className="mt-1.5">{delta}</p> : null}
    </div>
  )
}

// ── Top post highlight ──────────────────────────────────────────────────────
function topPostMetricLine(tp) {
  if (tp.source === 'ga4') return <><b className="text-foreground">{tp.pageviews.toLocaleString()}</b> pageviews · Website</>
  const platform = platformLabels([tp.platform])[0] || tp.platform
  return (
    <>
      <b className="text-foreground">{tp.reach.toLocaleString()}</b> people reached
      {tp.engagement > 0 ? <> · <b className="text-foreground">{tp.engagement.toLocaleString()}</b> reactions</> : null}
      {' '}· {platform}
    </>
  )
}

function TopPostCard({ topPost, isCurrentWeek }) {
  return (
    <div className="mt-4 rounded-xl border border-success/30 bg-success/5 p-4">
      <div className="flex items-center gap-1.5 text-2xs font-extrabold uppercase tracking-wide text-success mb-1.5">
        <Award className="h-3.5 w-3.5" aria-hidden="true" />
        Top post {isCurrentWeek ? 'this week' : 'that week'}
      </div>
      <p className="text-sm font-bold">{topPost.topic}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{topPostMetricLine(topPost)}</p>
      <Link to="/analytics" className="inline-block text-xs font-bold text-primary mt-1.5 hover:underline">
        All performance → Insights
      </Link>
    </div>
  )
}

// ── Block 1: the navigable week recap ───────────────────────────────────────
function WeekNavButton({ onClick, disabled, label, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="h-8 w-8 rounded-lg border border-white/30 bg-white/10 text-primary-foreground flex items-center justify-center hover:bg-white/25 transition-colors disabled:opacity-35 disabled:cursor-default disabled:hover:bg-white/10"
    >
      {children}
    </button>
  )
}

function RecapBlock({ week, weekOffset, canPrev, onPrev, onNext, onToday, onPresent, dimmed }) {
  const isCurrent = weekOffset === 0
  const range = fmtWeekRange(week.week_start, week.week_end)
  const title = isCurrent ? 'This week at the clinic'
    : weekOffset === -1 ? 'Last week at the clinic' : 'Week at the clinic'
  const sub = isCurrent ? `${range} · for your all-staff meeting` : `${range} · completed week`

  const cost = estimateWindow(week.cost).total
  const prevCost = week.prev?.cost ? estimateWindow(week.prev.cost).total : null
  const published = week.published_items || []
  const captured = week.captured_items || []

  return (
    <div className="rounded-2xl overflow-hidden border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-22px_rgba(15,23,42,0.3)]">
      <div
        className="px-6 py-4 flex items-center gap-3 flex-wrap text-primary-foreground"
        style={{ background: 'linear-gradient(100deg,hsl(var(--primary)) 0%,hsl(var(--primary)/0.75) 100%)' }}
      >
        <div className="text-2xl" aria-hidden="true">🎉</div>
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold leading-tight">{title}</h2>
          <p className="text-xs opacity-90">{sub}</p>
        </div>
        {isCurrent ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/15 px-2.5 py-0.5 text-3xs font-extrabold uppercase tracking-wide">
            <Clock className="h-3 w-3" aria-hidden="true" /> Week in progress
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <WeekNavButton onClick={onPrev} disabled={!canPrev} label="Previous week">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </WeekNavButton>
          <div className="text-center min-w-[7.5rem]">
            <p className="text-3xs font-extrabold uppercase tracking-wide opacity-85">{weekRelative(weekOffset)}</p>
            <p className="text-sm font-extrabold leading-tight">{range}</p>
          </div>
          <WeekNavButton onClick={onNext} disabled={isCurrent} label="Next week">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </WeekNavButton>
          {!isCurrent ? (
            <button
              onClick={onToday}
              className="rounded-lg border border-white/30 px-2.5 py-1.5 text-xs font-bold hover:bg-white/15 transition-colors"
            >
              Back to this week
            </button>
          ) : null}
          <button
            onClick={onPresent}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/30 px-2.5 py-1.5 text-xs font-bold hover:bg-white/15 transition-colors"
          >
            <Presentation className="h-3.5 w-3.5" aria-hidden="true" /> Present
          </button>
        </div>
      </div>

      <div className={`transition-opacity ${dimmed ? 'opacity-60' : ''}`}>
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border border-b border-border">
          <Stat
            value={week.published} label="published" color="hsl(var(--success))"
            delta={<DeltaChip cur={week.published} prev={week.prev?.published ?? null} />}
          />
          <Stat
            value={week.captured} label="captured by the team" color="hsl(var(--primary))"
            delta={<DeltaChip cur={week.captured} prev={week.prev?.captured ?? null} />}
          />
          <Stat
            value={week.drafted} label="pieces drafted" color="hsl(var(--scheduled))"
            delta={<DeltaChip cur={week.drafted} prev={week.prev?.drafted ?? null} />}
          />
          <Stat
            value={cost} label="est. run cost" color="hsl(var(--foreground))" format={fmtUsd}
            delta={<DeltaChip cur={cost} prev={prevCost} money invert />}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
          {/* published */}
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="nx-pill nx-pill-emerald">🎉 Published</span>
              <h3 className="text-sm font-bold">{week.published} {week.published === 1 ? 'post' : 'posts'} out in the world</h3>
            </div>
            {published.length === 0 ? (
              <>
                <p className="text-xs text-muted-foreground">Nothing published this week.</p>
                {week.drafted > 0 ? (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-action shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{week.drafted} piece{week.drafted === 1 ? ' was' : 's were'} drafted this week but nothing shipped — drafts piled up in review.</span>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="space-y-2.5">
                {published.slice(0, 5).map((item) => {
                  const Icon = item.has_video ? Play : Image
                  const labels = platformLabels(item.platforms || [])
                  const inner = (
                    <>
                      <span className="h-7 w-7 rounded-full bg-muted text-muted-foreground text-2xs font-bold flex items-center justify-center shrink-0">
                        {getInitials(item.staff_name)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{item.topic}</p>
                        <p className="text-2xs text-muted-foreground truncate">
                          {item.staff_name || 'Team'}{labels.length ? ` · ${labels.join(', ')}` : ''} · {dayLabel(item.published_at)}
                        </p>
                      </div>
                      <Icon className="h-4 w-4 text-muted-foreground/40 shrink-0" aria-hidden="true" />
                    </>
                  )
                  const cls = 'flex items-center gap-3 group border-l-2 border-l-success pl-2.5'
                  return item.interview_id ? (
                    <Link key={item.interview_id} to={`/stories/${item.interview_id}`} className={cls}>{inner}</Link>
                  ) : (
                    <div key={`${item.topic}-${item.published_at}`} className={cls}>{inner}</div>
                  )
                })}
                {published.length > 5 ? <p className="text-2xs text-muted-foreground pt-1">+ {published.length - 5} more</p> : null}
              </div>
            )}
          </div>

          {/* captured + top post */}
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="nx-pill nx-pill-sky">Captured</span>
              <h3 className="text-sm font-bold">{week.captured} {week.captured === 1 ? 'story' : 'stories'} captured</h3>
            </div>
            {captured.length === 0 ? (
              <p className="text-xs text-muted-foreground">No new stories captured this week.</p>
            ) : (
              <div className="space-y-2">
                {captured.slice(0, 4).map((c) => (
                  <Link key={c.interview_id} to={`/stories/${c.interview_id}`} className="flex items-center gap-2.5 text-sm group border-l-2 border-l-info pl-2.5">
                    <span className="h-6 w-6 rounded-full bg-muted text-muted-foreground text-3xs font-bold flex items-center justify-center shrink-0">
                      {getInitials(c.staff_name)}
                    </span>
                    <span className="font-semibold truncate flex-1 group-hover:text-primary transition-colors">
                      {c.staff_name || 'Team'}
                    </span>
                    <span className="text-2xs text-muted-foreground shrink-0">{dayLabel(c.created_at)}</span>
                  </Link>
                ))}
                {captured.length > 4 ? <p className="text-2xs text-muted-foreground">+ {captured.length - 4} more</p> : null}
              </div>
            )}
            {week.top_post ? (
              <TopPostCard topPost={week.top_post} isCurrentWeek={isCurrent} />
            ) : week.published > 0 ? (
              <p className="mt-4 text-2xs text-muted-foreground">No measured reach yet for this week&rsquo;s posts.</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── "Right now" queues ──────────────────────────────────────────────────────
function NowRow({ scheduled, waiting }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="nx-pill nx-pill-sky">Going out next</span>
          <h3 className="text-sm font-bold">Scheduled</h3>
        </div>
        {scheduled.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing scheduled yet.</p>
        ) : (
          <div className="space-y-2">
            {scheduled.slice(0, 4).map((s, i) => (
              <Link key={`${s.storyId}-${i}`} to={`/stories/${s.storyId}`} className="flex items-center gap-2 text-sm group border-l-2 border-l-info pl-2.5">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                <span className="font-semibold truncate flex-1 group-hover:text-primary transition-colors">{s.topic}</span>
                <span className="text-2xs text-muted-foreground shrink-0">{dateTimeLabel(s.scheduledAt)}</span>
              </Link>
            ))}
            {scheduled.length > 4 ? <p className="text-2xs text-muted-foreground">+ {scheduled.length - 4} more scheduled</p> : null}
          </div>
        )}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="nx-pill nx-pill-tint">Needs the team</span>
          <h3 className="text-sm font-bold">In review</h3>
        </div>
        {waiting.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing waiting — inbox clear.</p>
        ) : (
          <div className="space-y-2">
            {waiting.slice(0, 4).map((w) => (
              <Link key={w.storyId} to={`/stories/${w.storyId}`} className="flex items-center gap-2 text-sm group border-l-2 border-l-warning pl-2.5">
                <span className="font-semibold truncate flex-1 group-hover:text-primary transition-colors">{w.topic}</span>
                <span className="text-2xs text-muted-foreground shrink-0">{w.staffName}</span>
              </Link>
            ))}
            {waiting.length > 4 ? <p className="text-2xs text-muted-foreground">+ {waiting.length - 4} more</p> : null}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Block 2: team cadence ────────────────────────────────────────────────────
function MemberCard({ m }) {
  const kind = classifyMember(m)
  const streak = computeStreak(m.capture_weeks)
  const due = kind === 'due' || kind === 'new'
  return (
    <div className="bg-card p-4">
      <div className="flex items-center gap-3">
        <span className={`h-11 w-11 rounded-full text-sm font-bold flex items-center justify-center shrink-0 ${due ? 'bg-muted text-muted-foreground' : 'bg-secondary text-secondary-foreground'}`}>
          {getInitials(m.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`font-bold text-sm ${due ? 'text-muted-foreground' : ''}`}>{m.name}</p>
            {m.week_published > 0 ? (
              <span className="nx-pill nx-pill-emerald">{m.week_published} this week</span>
            ) : due ? (
              <span className="nx-pill nx-pill-tint">let&rsquo;s grab 10 min</span>
            ) : null}
          </div>
          <p className="text-2xs text-muted-foreground mt-0.5">
            {m.last_capture_at
              ? `Last captured ${new Date(m.last_capture_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
              : kind === 'new' ? 'No capture yet — let’s get their first' : 'No recent capture'}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
        {streak > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-action">
            <Flame className="h-3.5 w-3.5" aria-hidden="true" />{streak}-week streak
          </span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">no streak yet</span>
        )}
        <span className="text-xs text-muted-foreground"><b className="text-foreground text-sm">{m.all_time_published}</b> all-time</span>
      </div>
    </div>
  )
}

// ── Block 1.5: all-time summary — the lifetime counterpart to "this week" ─────
function AllTimeStat({ value, label, color, format }) {
  return (
    <div className="p-4 text-center">
      <p className="text-3xl font-extrabold" style={{ color }}>
        <NumberTicker value={value} format={format} />
      </p>
      <p className="text-xs opacity-70 mt-0.5">{label}</p>
    </div>
  )
}

function AllTimeBlock({ published, captured, contributors, costTotal }) {
  return (
    <div
      className="rounded-2xl overflow-hidden border border-white/10 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-22px_rgba(15,23,42,0.4)]"
      style={{ background: 'linear-gradient(120deg, hsl(222 47% 12%) 0%, hsl(215 28% 22%) 100%)' }}
    >
      <div className="px-6 py-3.5 flex items-center gap-3 text-white border-b border-white/10">
        <InfinityIcon className="h-5 w-5 opacity-90" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-extrabold leading-tight">All time</h2>
          <p className="text-2xs opacity-70">the whole story so far</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-white/10 text-white">
        <AllTimeStat value={published} label="posts published" color="hsl(var(--success))" />
        <AllTimeStat value={captured} label="stories captured" color="hsl(var(--info))" />
        <AllTimeStat value={contributors} label="teammates contributing" color="hsl(var(--info))" />
        <AllTimeStat value={costTotal} format={(v) => `≈ ${fmtUsd(v)}`} label="total run cost · est." color="#ffffff" />
      </div>
    </div>
  )
}

function TeamBlock({ team }) {
  const sorted = sortTeam(team)
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-3 flex-wrap">
        <Users className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-base font-bold">The team</h3>
        <span className="nx-pill nx-pill-ink">streaks reward showing up, not posting most</span>
        <span className="ml-auto text-2xs text-muted-foreground">who&rsquo;s been captured recently · who&rsquo;s due</span>
      </div>
      {sorted.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">No team members yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
          {sorted.map((m) => <MemberCard key={m.id} m={m} />)}
        </div>
      )}
      <div className="px-5 py-2.5 bg-muted/40 border-t border-border text-2xs text-muted-foreground">
        The streak rewards consistency (a capture every week) and all-time only grows — it celebrates showing up, not cramming volume. Due flags are a nudge, never a ranking.
      </div>
    </div>
  )
}

// ── Block 3: cost ────────────────────────────────────────────────────────────
function CostLine({ icon: Icon, label, units, value }) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-2xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-lg font-bold">{fmtUsd(value)}</p>
      <p className="text-2xs text-muted-foreground">{units}</p>
    </div>
  )
}

function CostBlock({ cost }) {
  const view = buildCostView(cost)
  const lines = estimateWindow(view.units).lines
  const u = view.units
  const wow = view.wowPct
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2 flex-wrap">
        <Receipt className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-base font-bold">What this week cost to run</h3>
        <span className="nx-pill nx-pill-ink">estimate</span>
        <span className="ml-auto inline-flex items-center gap-2">
          {wow != null ? (
            <span className={`nx-pill ${wow <= 0 ? 'nx-pill-emerald' : 'nx-pill-tint'}`}>
              {wow <= 0 ? '↓' : '↑'} {Math.abs(wow)}% vs last week
            </span>
          ) : null}
          <span className="text-lg font-extrabold">≈ {fmtUsd(view.weekTotal)}</span>
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border">
        <CostLine icon={Mic} label="Transcription" units={`${fmtMinutes(u.transcribe_sec)} of audio · Whisper`} value={lines.transcription} />
        <CostLine icon={Sparkles} label="AI writing" units={`${u.pieces} pieces · Claude`} value={lines.writing} />
        <CostLine icon={Video} label="Video / audio" units={`${fmtMinutes(u.video_sec)} encoded · Mux + ffmpeg`} value={lines.video} />
        <CostLine icon={Volume2} label="Voice (TTS)" units={`${fmtMinutes(u.voice_sec)} narration · ElevenLabs`} value={lines.voice} />
      </div>
      <div className="grid grid-cols-3 divide-x divide-border border-t border-border bg-muted/30">
        <div className="p-3 text-center"><p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">This week</p><p className="text-base font-extrabold mt-0.5">{fmtUsd(view.weekTotal)}</p></div>
        <div className="p-3 text-center"><p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Month to date</p><p className="text-base font-extrabold mt-0.5">{fmtUsd(view.mtdTotal)}</p></div>
        <div className="p-3 text-center"><p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Year to date</p><p className="text-base font-extrabold mt-0.5">{fmtUsd(view.ytdTotal)}</p></div>
      </div>
      <div className="px-5 py-2.5 bg-muted/40 border-t border-border text-2xs text-muted-foreground">
        Estimated from counted usage × provider rate card (not exact billed cost). Excludes flat subscriptions (Buffer, hosting).
        {view.perPost != null ? ` ~${fmtUsd(view.perPost)} per published post this week.` : ''}
      </div>
    </div>
  )
}

export default function WeeklyRecapPanel({ stories = [] }) {
  const [present, setPresent] = useState(false)
  const [weekOffset, setWeekOffset] = useState(0)
  const { data } = useWorkspaceRecap()
  const {
    data: week,
    isError: weekError,
    isPlaceholderData: weekSwapping,
    refetch: refetchWeek,
  } = useWorkspaceWeekRecap(weekOffset)

  const { scheduled, waiting } = deriveNowQueues(stories)
  const team = data?.team || []
  const total = data?.team_all_time_total || 0
  const cost = data?.cost || {}
  const allTime = data?.all_time || {}
  const costView = buildCostView(cost)

  const floor = floorWeekOffset(data?.first_week)
  const canPrev = weekOffset > floor

  const recap = weekError ? (
    <div className="rounded-2xl border border-border bg-card p-6 text-center">
      <p className="text-sm text-muted-foreground">Couldn&rsquo;t load the week recap.</p>
      <button
        onClick={() => refetchWeek()}
        className="mt-3 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-accent transition-colors"
      >
        Try again
      </button>
    </div>
  ) : !week ? (
    <Skeleton className="h-80 w-full rounded-2xl" />
  ) : (
    <RecapBlock
      week={week}
      weekOffset={weekOffset}
      canPrev={canPrev}
      onPrev={() => canPrev && setWeekOffset((o) => o - 1)}
      onNext={() => setWeekOffset((o) => Math.min(0, o + 1))}
      onToday={() => setWeekOffset(0)}
      onPresent={() => setPresent(true)}
      dimmed={weekSwapping}
    />
  )

  const blocks = (
    <div className="space-y-6">
      {recap}
      <NowRow scheduled={scheduled} waiting={waiting} />
      <AllTimeBlock
        published={total}
        captured={allTime.captured || 0}
        contributors={allTime.contributors || 0}
        costTotal={costView.allTotal || 0}
      />
      <TeamBlock team={team} />
      <CostBlock cost={cost} />
    </div>
  )

  if (present) {
    return (
      <div role="dialog" aria-modal="true" aria-label="All-staff recap presentation" className="fixed inset-0 z-50 bg-background overflow-auto">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-6 py-3 flex items-center gap-3">
          <Presentation className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-bold">All-staff recap</h2>
          <span className="text-sm text-muted-foreground">{week ? `${weekRelative(weekOffset)} · ${fmtWeekRange(week.week_start, week.week_end)}` : ''}</span>
          <button
            onClick={() => setPresent(false)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" /> Exit present mode
          </button>
        </div>
        <div className="max-w-5xl mx-auto px-6 py-8 text-[1.06rem]">{blocks}</div>
      </div>
    )
  }

  return blocks
}
