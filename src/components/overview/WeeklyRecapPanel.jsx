import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays, Users, Receipt, Mic, Sparkles,
  Video, Volume2, Presentation, X, Image, Play, Flame,
} from 'lucide-react'
import { getInitials } from '@/lib/utils'
import { useWorkspaceRecap } from '@/lib/queries'
import {
  deriveWeekRecap, computeStreak, classifyMember, sortTeam, platformLabels,
} from '@/lib/recapDerive'
import { buildCostView, estimateWindow, fmtUsd, fmtMinutes } from '@/lib/costEstimate'

// The Overview "This week" recap — a workspace-wide snapshot pinned above the
// lens toggle, built to be screen-shared in the weekly all-staff meeting.
// Three blocks: the recap (went live / scheduled / waiting / captured), team
// cadence (all-time counts + consistency streaks + gentle "due" nudges), and
// an estimated cost-to-run tile. "Present mode" blows it up fullscreen.

function weekRangeLabel() {
  const now = new Date()
  const start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)
  const f = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${f(start)} – ${f(now)}`
}
function dayLabel(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' })
}
function dateTimeLabel(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' }) + ' ' +
    new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function Stat({ value, label, color }) {
  return (
    <div className="p-4 text-center">
      <p className="text-3xl font-extrabold" style={{ color }}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}

// ── Block 1: the recap ──────────────────────────────────────────────────────
function RecapBlock({ recap }) {
  const { stats, wentLive, scheduled, waiting } = recap
  return (
    <div className="rounded-2xl overflow-hidden border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-22px_rgba(15,23,42,0.3)]">
      <div
        className="px-6 py-4 flex items-center gap-3 text-white"
        style={{ background: 'linear-gradient(100deg,#e36525 0%,#f0883e 60%,#f6a96b 100%)' }}
      >
        <div className="text-2xl" aria-hidden="true">🎉</div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-extrabold leading-tight">This week at the clinic</h2>
          <p className="text-xs opacity-90">{weekRangeLabel()} · for your all-staff meeting</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100 border-b border-slate-100">
        <Stat value={stats.wentLive} label="went live" color="#059669" />
        <Stat value={stats.scheduled} label="scheduled to go out" color="#0284c7" />
        <Stat value={stats.waiting} label="waiting on review" color="hsl(var(--primary))" />
        <Stat value={stats.captured} label="new stories captured" color="#334155" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
        {/* went live */}
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="nx-pill nx-pill-emerald">🎉 Went live</span>
            <h3 className="text-sm font-bold">{stats.wentLive} {stats.wentLive === 1 ? 'post' : 'posts'} out in the world</h3>
          </div>
          {wentLive.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing published yet this week.</p>
          ) : (
            <div className="space-y-2.5">
              {wentLive.slice(0, 5).map((item) => {
                const Icon = item.hasVideo ? Play : Image
                const labels = platformLabels(item.platforms)
                return (
                  <Link key={item.storyId} to={`/stories/${item.storyId}`} className="flex items-center gap-3 group">
                    <span className="h-7 w-7 rounded-full bg-slate-100 text-slate-500 text-2xs font-bold flex items-center justify-center shrink-0">
                      {getInitials(item.staffName)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{item.topic}</p>
                      <p className="text-2xs text-muted-foreground truncate">
                        {item.staffName}{labels.length ? ` · ${labels.join(', ')}` : ''} · {dayLabel(item.publishedAt)}
                      </p>
                    </div>
                    <Icon className="h-4 w-4 text-slate-300 shrink-0" aria-hidden="true" />
                  </Link>
                )
              })}
              {wentLive.length > 5 ? <p className="text-2xs text-muted-foreground pt-1">+ {wentLive.length - 5} more</p> : null}
            </div>
          )}
        </div>

        {/* scheduled + waiting */}
        <div className="p-5 space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="nx-pill nx-pill-sky">Going out next</span>
              <h3 className="text-sm font-bold">Scheduled</h3>
            </div>
            {scheduled.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing scheduled yet.</p>
            ) : (
              <div className="space-y-2">
                {scheduled.slice(0, 4).map((s, i) => (
                  <Link key={`${s.storyId}-${i}`} to={`/stories/${s.storyId}`} className="flex items-center gap-2 text-sm group">
                    <CalendarDays className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                    <span className="font-semibold truncate flex-1 group-hover:text-primary transition-colors">{s.topic}</span>
                    <span className="text-2xs text-muted-foreground shrink-0">{dateTimeLabel(s.scheduledAt)}</span>
                  </Link>
                ))}
                {scheduled.length > 4 ? <p className="text-2xs text-muted-foreground">+ {scheduled.length - 4} more scheduled</p> : null}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="nx-pill nx-pill-tint">Needs the team</span>
              <h3 className="text-sm font-bold">Waiting on review</h3>
            </div>
            {waiting.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing waiting — inbox clear.</p>
            ) : (
              <div className="space-y-2">
                {waiting.slice(0, 4).map((w) => (
                  <Link key={w.storyId} to={`/stories/${w.storyId}`} className="flex items-center gap-2 text-sm group">
                    <span className="font-semibold truncate flex-1 group-hover:text-primary transition-colors">{w.topic}</span>
                    <span className="text-2xs text-muted-foreground shrink-0">{w.staffName}</span>
                  </Link>
                ))}
                {waiting.length > 4 ? <p className="text-2xs text-muted-foreground">+ {waiting.length - 4} more</p> : null}
              </div>
            )}
          </div>
        </div>
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
    <div className="bg-white p-4">
      <div className="flex items-center gap-3">
        <span className={`h-11 w-11 rounded-full text-sm font-bold flex items-center justify-center shrink-0 ${due ? 'bg-slate-100 text-slate-400' : 'bg-slate-200 text-slate-600'}`}>
          {getInitials(m.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`font-bold text-sm ${due ? 'text-slate-500' : ''}`}>{m.name}</p>
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
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
        {streak > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-orange-600">
            <Flame className="h-3.5 w-3.5" aria-hidden="true" />{streak}-week streak
          </span>
        ) : (
          <span className="text-xs font-medium text-slate-400">no streak yet</span>
        )}
        <span className="text-xs text-muted-foreground"><b className="text-foreground text-sm">{m.all_time_published}</b> all-time</span>
      </div>
    </div>
  )
}

function TeamBlock({ team, total }) {
  const sorted = sortTeam(team)
  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
        <Users className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-base font-bold">The team</h3>
        <span className="nx-pill nx-pill-ink">streaks reward showing up, not posting most</span>
        <div className="ml-auto flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-1.5">
          <span className="text-2xl font-extrabold text-emerald-700 leading-none">{total.toLocaleString()}</span>
          <div className="leading-tight">
            <p className="text-2xs font-bold uppercase tracking-wide text-emerald-700">stories shared</p>
            <p className="text-2xs text-emerald-600">all time · as a team</p>
          </div>
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">No team members yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-100">
          {sorted.map((m) => <MemberCard key={m.id} m={m} />)}
        </div>
      )}
      <div className="px-5 py-2.5 bg-slate-50/70 border-t border-slate-100 text-2xs text-muted-foreground">
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
    <div className="rounded-2xl border border-border bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 flex-wrap">
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
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100">
        <CostLine icon={Mic} label="Transcription" units={`${fmtMinutes(u.transcribe_sec)} of audio · Whisper`} value={lines.transcription} />
        <CostLine icon={Sparkles} label="AI writing" units={`${u.pieces} pieces · Claude`} value={lines.writing} />
        <CostLine icon={Video} label="Video / audio" units={`${fmtMinutes(u.video_sec)} encoded · Mux + ffmpeg`} value={lines.video} />
        <CostLine icon={Volume2} label="Voice (TTS)" units={`${fmtMinutes(u.voice_sec)} narration · ElevenLabs`} value={lines.voice} />
      </div>
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/40">
        <div className="p-3 text-center"><p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">This week</p><p className="text-base font-extrabold mt-0.5">{fmtUsd(view.weekTotal)}</p></div>
        <div className="p-3 text-center"><p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Month to date</p><p className="text-base font-extrabold mt-0.5">{fmtUsd(view.mtdTotal)}</p></div>
        <div className="p-3 text-center"><p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Year to date</p><p className="text-base font-extrabold mt-0.5">{fmtUsd(view.ytdTotal)}</p></div>
      </div>
      <div className="px-5 py-2.5 bg-slate-50/70 border-t border-slate-100 text-2xs text-muted-foreground">
        Estimated from counted usage × provider rate card (not exact billed cost). Excludes flat subscriptions (Buffer, hosting).
        {view.perPost != null ? ` ~${fmtUsd(view.perPost)} per published post this week.` : ''}
      </div>
    </div>
  )
}

export default function WeeklyRecapPanel({ stories = [] }) {
  const [present, setPresent] = useState(false)
  const { data } = useWorkspaceRecap()
  const recap = deriveWeekRecap(stories)
  const team = data?.team || []
  const total = data?.team_all_time_total || 0
  const cost = data?.cost || {}

  const blocks = (
    <div className="space-y-6">
      <RecapBlock recap={recap} />
      <TeamBlock team={team} total={total} />
      <CostBlock cost={cost} />
    </div>
  )

  if (present) {
    return (
      <div className="fixed inset-0 z-50 bg-background overflow-auto">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-6 py-3 flex items-center gap-3">
          <Presentation className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-bold">All-staff recap</h2>
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

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={() => setPresent(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Presentation className="h-3.5 w-3.5" aria-hidden="true" /> Present mode
        </button>
      </div>
      {blocks}
    </div>
  )
}
