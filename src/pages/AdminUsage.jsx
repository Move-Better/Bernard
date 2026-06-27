import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Globe, Lock } from 'lucide-react'
import { usePlatformUsage } from '@/lib/queries'
import { usePlatformAdmin } from '@/lib/usePlatformAdmin'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

function relTime(iso) {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return 'never'
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${Math.max(m, 1)}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

// status → semantic token. active=success, at-risk=warning, idle=destructive.
const STATUS = {
  active:    { cls: 'bg-success/15 text-success',         dot: 'bg-success' },
  'at-risk': { cls: 'bg-warning/15 text-warning-foreground', dot: 'bg-warning' },
  idle:      { cls: 'bg-destructive/12 text-destructive',  dot: 'bg-destructive' },
}

function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.idle
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ${s.cls}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />{status}
    </span>
  )
}

function Trend({ trend }) {
  const max = Math.max(1, ...(trend || []))
  return (
    <span className="inline-flex items-end gap-0.5">
      {(trend || []).map((v, i) => (
        <span key={i} className={v ? 'bg-primary' : 'bg-border'}
          style={{ display: 'inline-block', width: 4, height: Math.max((v / max) * 20, 2), borderRadius: 2 }} />
      ))}
    </span>
  )
}

function TopStat({ label, value, sub, danger }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${danger ? 'text-destructive' : ''}`}>{value}</div>
      {sub && <div className="mt-1 text-2xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

function WsRow({ w }) {
  return (
    <tr className="border-t">
      <td className="py-2 font-medium">{w.display_name}<span className="ml-1 text-2xs text-muted-foreground">{w.slug}</span></td>
      <td className="py-2 capitalize text-muted-foreground">{w.plan}</td>
      <td className="py-2"><StatusPill status={w.activity_status} /></td>
      <td className={`py-2 ${w.activity_status === 'active' ? 'text-muted-foreground' : 'text-destructive'}`}>{relTime(w.last_active_at)}</td>
      <td className="py-2 text-right tabular-nums">{w.active_days_28d}</td>
      <td className="py-2 text-right tabular-nums">{w.captures_week}</td>
      <td className="py-2 text-right tabular-nums">{w.published_week}</td>
      <td className="py-2"><Trend trend={w.trend} /></td>
    </tr>
  )
}

export default function AdminUsage() {
  useDocumentTitle('Platform usage')
  const { isPlatformAdmin, isLoading: gateLoading } = usePlatformAdmin()
  const { data = {}, isLoading } = usePlatformUsage({ enabled: isPlatformAdmin })
  const [onlyAtRisk, setOnlyAtRisk] = useState(false)

  if (!gateLoading && !isPlatformAdmin) return <Navigate to="/" replace />

  const t = data.topline || {}
  let rows = data.workspaces || []
  if (onlyAtRisk) rows = rows.filter((w) => w.activity_status !== 'active')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Globe className="h-5 w-5 text-primary" aria-hidden="true" />
            All tenants — Usage
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Platform-wide adoption across every workspace</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/12 px-2.5 py-1 text-2xs font-semibold text-destructive">
          <Lock className="h-3 w-3" aria-hidden="true" />Super-admin only
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <TopStat label="Workspaces" value={t.workspaces ?? 0} />
        <TopStat label="Active this wk" value={t.active_this_week ?? 0} sub={t.workspaces ? `${Math.round((t.active_this_week / t.workspaces) * 100)}%` : null} />
        <TopStat label="Captures (wk)" value={t.captures_week ?? 0} />
        <TopStat label="Published (wk)" value={t.published_week ?? 0} />
        <TopStat label="At-risk / idle" value={t.at_risk ?? 0} sub="no activity 14d+" danger />
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Workspaces</h3>
          <button
            onClick={() => setOnlyAtRisk((v) => !v)}
            className={`rounded-full px-2.5 py-1 text-2xs font-semibold ${onlyAtRisk ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
            Only at-risk
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 font-medium">Workspace</th>
                <th className="pb-2 font-medium">Plan</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Last active</th>
                <th className="pb-2 text-right font-medium">Active days (28d)</th>
                <th className="pb-2 text-right font-medium">Captures</th>
                <th className="pb-2 text-right font-medium">Published</th>
                <th className="pb-2 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !isLoading && (
                <tr><td colSpan={8} className="py-6 text-center text-sm text-muted-foreground">No workspaces.</td></tr>
              )}
              {rows.map((w) => <WsRow key={w.id} w={w} />)}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-2xs text-muted-foreground">Active-days proxy from existing timestamps. Upgrade path: read true logins/feature-touch from PostHog (already workspace-grouped).</p>
      </div>
    </div>
  )
}
