import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarRange, Sparkles, Archive, Mail, Moon, ChevronRight, Shield, Plus,
} from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { PLATFORM_META } from '@/lib/contentMeta'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import LoadingState from '@/components/LoadingState'
import PageHelp from '@/components/PageHelp'

// F2.3 — "Your week": the producer's plan/review hub. The Strategist composes
// the week into content_plan_atoms (plan_week); this surface shows it as a
// calendar, with the backlog and the trust ladder. Supersedes the Review Inbox.
// Phase 1 = view + drill-in; approve/schedule + the Stage 2 auto-clear land next.

const DAYS = [
  ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun'],
]
const DOW_TO_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] // getUTCDay index → key

const LADDER = [
  ['approve_all', 'Approve everything'],
  ['approve_exception', 'Approve by exception'],
  ['manage_by_goals', 'Manage by goals'],
]

function timeLabel(iso) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

// Where a card drills in: a drafted piece → its publish/review detail; an
// undrafted slot → the source story where it gets drafted on demand.
function drillTo(item) {
  if (item.contentPieceId) return `/publish/${item.contentPieceId}`
  if (item.interviewId) return `/stories/${item.interviewId}`
  return '/stories'
}

function PlanCard({ item }) {
  const meta = PLATFORM_META[item.platform] || { label: item.platform, icon: null }
  const Icon = meta.icon
  const drafted = !!item.contentPieceId
  return (
    <Link
      to={drillTo(item)}
      className="block rounded-lg border border-l-[3px] border-l-primary bg-card p-2 transition-all hover:border-primary/60 hover:shadow-sm"
    >
      <div className="mb-1 flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
        <span className="text-3xs font-bold uppercase tracking-wide text-muted-foreground">
          {meta.label}{item.scheduled_at ? ` · ${timeLabel(item.scheduled_at)}` : ''}
        </span>
      </div>
      <div className="text-2xs font-semibold leading-snug text-foreground line-clamp-3">{item.brief || item.label}</div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-3xs font-semibold ${drafted ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
          {drafted ? 'drafted' : 'review'}
        </span>
        <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      </div>
    </Link>
  )
}

export default function YourWeek() {
  useDocumentTitle('Your week')
  const { isEditor, isLoading: roleLoading } = useUserRole()

  const { data, isLoading } = useQuery({
    queryKey: ['week-summary'],
    queryFn: () => apiFetch('/api/content-plan/week-summary'),
    enabled: !roleLoading && isEditor,
    refetchOnWindowFocus: false,
  })

  if (roleLoading || isLoading) return <LoadingState />

  const quiet = new Set((data?.quietDays || ['sat', 'sun']).map((q) => q.toLowerCase()))
  const cadence = data?.cadence || {}
  const scheduled = data?.scheduled || []

  // Group scheduled atoms into day columns.
  const byDay = {}
  for (const [k] of DAYS) byDay[k] = []
  for (const item of scheduled) {
    const k = DOW_TO_KEY[new Date(item.scheduled_at).getUTCDay()]
    if (byDay[k]) byDay[k].push(item)
  }

  const stageIdx = Math.max(0, LADDER.findIndex(([s]) => s === (data?.trustStage || 'approve_all')))

  return (
    <div className="space-y-5 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <CalendarRange className="h-5 w-5 text-primary" aria-hidden="true" />
            Your week
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The week I’d run for you, built from your captures. Open anything to review it. <b>Nothing publishes without your yes.</b>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PageHelp pageKey="your-week" variant="default" />
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-2xs font-medium text-muted-foreground">
            <Shield className="h-3 w-3" aria-hidden="true" /> Producer view
          </span>
        </div>
      </div>

      {/* Trust ladder */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
        <span className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">You’re here</span>
        <div className="flex items-center gap-2 text-xs">
          {LADDER.map(([s, lbl], i) => (
            <span key={s} className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${i <= stageIdx ? 'bg-primary' : 'bg-border'}`} />
              <span className={i === stageIdx ? 'font-bold' : 'text-muted-foreground'}>{lbl}</span>
              {i < LADDER.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
            </span>
          ))}
        </div>
        <span className="ml-auto text-2xs text-muted-foreground">I take more off your plate as I learn what you greenlight</span>
      </div>

      {!data?.hasPlan ? (
        <div className="rounded-lg border bg-muted/20 py-12 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-primary/60" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-foreground">No plan for this week yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Complete an interview and I’ll compose your week — paced across your channels, with the rest banked as backlog.
          </p>
          <Link to="/new" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90">
            <Plus className="h-4 w-4" aria-hidden="true" /> Start a capture
          </Link>
        </div>
      ) : (
        <>
          {/* Cadence strip */}
          {Object.keys(cadence).length > 0 && (
            <div className="rounded-xl border bg-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">Filled to your cadence</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-3xs font-semibold text-success">
                  <Sparkles className="h-3 w-3" aria-hidden="true" /> {data.scheduledTotal} scheduled
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
                          items.map((item) => <PlanCard key={item.id} item={item} />)
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
                <div className="rounded-xl border border-action/30 bg-gradient-to-b from-card to-action/5 p-3.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Mail className="h-4 w-4 text-action" aria-hidden="true" />
                    <span className="text-sm font-bold">Newsletter — assembling</span>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    Highlights feed your {data.digest.frequency || ''} <span className="font-semibold text-action">{data.digest.label}</span> digest{data.digest.next_send ? ` · sends ${data.digest.next_send}` : ''} — assembled, not per-capture.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
