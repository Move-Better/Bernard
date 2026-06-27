import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { BarChart3, ArrowUp, ArrowDown, Flame, Users, Shield } from 'lucide-react'
import { useWorkspaceUsage } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import PageHelp from '@/components/PageHelp'

// ── helpers ──────────────────────────────────────────────────────────────────
function relTime(iso) {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return 'never'
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

function isIdle(iso) {
  if (!iso) return true
  return Date.now() - new Date(iso).getTime() > 14 * 86400_000
}

function pct(num, den) {
  if (!den) return 0
  return Math.round((num / den) * 100)
}

// ── delta chip ───────────────────────────────────────────────────────────────
function Delta({ now, prev, unit = '' }) {
  const d = (now ?? 0) - (prev ?? 0)
  if (d === 0) return <span className="text-2xs text-muted-foreground">— same as last week</span>
  const up = d > 0
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span className={`inline-flex items-center gap-0.5 text-2xs font-medium ${up ? 'text-success' : 'text-destructive'}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {up ? '+' : ''}{d}{unit} vs last week
    </span>
  )
}

function StatCard({ label, value, suffix, now, prev, unit }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums">
        {value}{suffix && <span className="text-base font-medium text-muted-foreground">{suffix}</span>}
      </div>
      <div className="mt-1"><Delta now={now} prev={prev} unit={unit} /></div>
    </div>
  )
}

// ── activity chart — content (captures+published) stacked, media independent ──
function ActivityChart({ activity }) {
  const fmt = (wk) => {
    const dt = new Date(wk + 'T00:00:00Z')
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  const maxContent = Math.max(1, ...activity.map((w) => (w.captures || 0) + (w.published || 0)))
  const maxMedia = Math.max(1, ...activity.map((w) => w.media || 0))
  return (
    <div>
      <div className="flex h-40 items-end gap-2">
        {activity.map((w) => {
          const content = (w.captures || 0) + (w.published || 0)
          const ch = (content / maxContent) * 100
          const capH = content ? (w.captures / content) * ch : 0
          const pubH = content ? (w.published / content) * ch : 0
          const mediaH = ((w.media || 0) / maxMedia) * 100
          return (
            <div key={w.week} className="flex flex-1 items-end gap-1" title={`Week of ${fmt(w.week)} · ${w.captures} captures · ${w.published} published · ${w.media} media`}>
              <div className="flex h-full flex-1 flex-col justify-end">
                <div className="rounded-t-sm bg-primary/45" style={{ height: `${pubH}%` }} />
                <div className="bg-primary" style={{ height: `${capH}%`, borderRadius: pubH ? 0 : '3px 3px 0 0' }} />
              </div>
              <div className="flex h-full flex-1 flex-col justify-end">
                <div className="rounded-t-sm bg-action/70" style={{ height: `${mediaH}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-2">
        {activity.map((w) => (
          <div key={w.week} className="flex-1 text-center text-3xs text-muted-foreground">{fmt(w.week)}</div>
        ))}
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-2xs text-muted-foreground">
      <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-primary" />Captures</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-primary/45" />Published</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-action/70" />Media</span>
    </div>
  )
}

function FunnelStage({ count, label, conv }) {
  return (
    <div className="rounded-lg bg-primary/10 p-3">
      <div className="text-2xl font-bold tabular-nums">{count}</div>
      <div className="text-2xs text-muted-foreground">
        {label}{conv != null && <span className="ml-1 font-medium text-success">{conv}%</span>}
      </div>
    </div>
  )
}

function StaffRow({ s }) {
  const idle = isIdle(s.last_active_at)
  return (
    <tr className="border-t">
      <td className="py-2 font-medium">{s.name}</td>
      <td className={`py-2 ${idle ? 'text-destructive' : 'text-muted-foreground'}`}>{relTime(s.last_active_at)}</td>
      <td className="py-2 text-right tabular-nums">{s.captures_4wk}</td>
      <td className="py-2 text-right tabular-nums">{s.published_4wk}</td>
      <td className="py-2">
        <span className="inline-flex items-end gap-0.5">
          {(s.weeks || []).map((a, i) => (
            <span
              key={i}
              className={a ? 'bg-primary' : 'bg-border'}
              style={{ display: 'inline-block', width: 5, height: a ? 18 : 4, borderRadius: 2 }}
            />
          ))}
        </span>
      </td>
    </tr>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function Usage() {
  useDocumentTitle('Usage')
  const ws = useWorkspace()
  const { role, isLoading: roleLoading } = useUserRole()
  const [weeks] = useState(12)
  const { data = {}, isLoading } = useWorkspaceUsage(weeks)

  // Admin/owner only — the per-staff breakdown is mildly sensitive.
  if (!roleLoading && role !== 'admin') return <Navigate to="/" replace />

  const stats = data.stats || {}
  const activity = data.activity || []
  const stick = data.stickiness || {}
  const funnel = data.funnel || {}
  const staff = data.staff || []
  const lastActive = staff.map((s) => s.last_active_at).filter(Boolean).sort().pop()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
            Usage
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How much {ws?.display_name || 'your clinic'} is putting Bernard to work
            {lastActive && <> · last active <span className="font-medium text-foreground">{relTime(lastActive)}</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PageHelp pageKey="usage" variant="default" />
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-2xs font-medium text-muted-foreground">
            <Shield className="h-3 w-3" aria-hidden="true" />
            Admin view
          </span>
        </div>
      </div>

      {/* top stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Active days" value={stats.active_days?.this_week ?? 0} suffix="/7"
          now={stats.active_days?.this_week} prev={stats.active_days?.prev_week} />
        <StatCard label="Captures" value={stats.captures?.this_week ?? 0}
          now={stats.captures?.this_week} prev={stats.captures?.prev_week} />
        <StatCard label="Published" value={stats.published?.this_week ?? 0}
          now={stats.published?.this_week} prev={stats.published?.prev_week} />
        <StatCard label="Media added" value={stats.media?.this_week ?? 0}
          now={stats.media?.this_week} prev={stats.media?.prev_week} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* activity over time */}
        <div className="rounded-xl border bg-card p-4 md:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Activity over time</h3>
            <Legend />
          </div>
          {isLoading
            ? <div className="h-40 animate-pulse rounded bg-muted/40" />
            : <ActivityChart activity={activity} />}
        </div>

        {/* stickiness */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-1.5 font-semibold"><Flame className="h-4 w-4 text-action" aria-hidden="true" />Stickiness</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Active days / wk (avg)</span><b className="tabular-nums">{stick.avg_active_days_per_week ?? 0}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Weekly active staff</span><b className="tabular-nums">{stick.weekly_active_staff ?? 0} / {stick.total_staff ?? 0}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Current active-week streak</span><b className="tabular-nums">{stick.current_streak ?? 0} wks</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Longest streak</span><b className="tabular-nums">{stick.longest_streak ?? 0} wks</b></div>
          </div>
          <div className="mt-3 border-t pt-3">
            <div className="mb-1 text-2xs text-muted-foreground">Active days, last {weeks} weeks</div>
            <div className="flex h-10 items-end gap-1">
              {(stick.active_days_by_week || []).map((w) => (
                <div key={w.week} className="flex-1 rounded-t-sm bg-primary" title={`${w.days} active days`}
                  style={{ height: `${Math.max((w.days / 7) * 100, 3)}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* funnel */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-semibold">Capture → publish funnel <span className="text-2xs font-normal text-muted-foreground">(last {weeks} weeks)</span></h3>
          {funnel.avg_days_to_publish != null && (
            <span className="text-2xs text-muted-foreground">Avg time capture→publish: <b className="text-foreground">{funnel.avg_days_to_publish} days</b></span>
          )}
        </div>
        <p className="mb-3 text-2xs text-muted-foreground">Each capture fans out into multiple drafts, so drafts can exceed captures — the % shows how far drafts make it down the pipeline.</p>
        <div className="grid grid-cols-4 gap-2">
          <FunnelStage count={funnel.captured ?? 0} label="Captured (input)" />
          <FunnelStage count={funnel.drafted ?? 0} label="Drafted" />
          <FunnelStage count={funnel.scheduled ?? 0} label="Scheduled" conv={pct(funnel.scheduled, funnel.drafted)} />
          <FunnelStage count={funnel.published ?? 0} label="Published" conv={pct(funnel.published, funnel.drafted)} />
        </div>
      </div>

      {/* per staff */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 flex items-center gap-1.5 font-semibold"><Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />By team member</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 font-medium">Staff</th>
                <th className="pb-2 font-medium">Last active</th>
                <th className="pb-2 text-right font-medium">Captures (4wk)</th>
                <th className="pb-2 text-right font-medium">Published (4wk)</th>
                <th className="pb-2 font-medium">Consistency ({weeks} wk)</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 && !isLoading && (
                <tr><td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No team activity yet.</td></tr>
              )}
              {staff.map((s) => <StaffRow key={s.id} s={s} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
