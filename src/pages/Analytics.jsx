import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  Sparkles, MessageSquareText, TrendingUp, CalendarClock, Activity,
  Award, Globe, GitBranch, CheckCircle2, Mic, RefreshCw,
  Search, LogIn, TimerOff, PenLine, AlertTriangle, ExternalLink, MapPin,
  ArrowUp, ArrowDown, HelpCircle, X, Smartphone, Info, ChevronLeft,
  ChevronRight, CalendarRange, LayoutGrid,
} from 'lucide-react'
import { useWorkspace } from '@/lib/WorkspaceContext'
import {
  useStories, useTopPerformers, useWorkspaceRecap, useTopicSuggestions,
  useWebsiteHealth, useWebsiteGA4, useSearchQueries, useGbpPerformance,
  useApplePerformance, useSocialByPeriod, useWebsiteByPeriod, useSearchByPeriod,
} from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { deriveInsights } from '@/lib/insightsReads'
import { buildCostView, fmtUsd } from '@/lib/costEstimate'
import PageSkeleton from '@/components/PageSkeleton'
import { GRANULARITIES, MAX_OFFSET, periodLabel, periodRelative } from '@/lib/periodMath'

// ── Insights advisor ──────────────────────────────────────────────────────────
//
// Bernard reading the workspace's performance like a content expert: plain-
// language "reads" + a next action, a small legible "receipts" summary, the
// content-aiming loop that already runs (topic suggestions), and a website
// tune-up section (GA4 / Search Console reads light up as those inputs connect).
//
// Phase 1: everything that works on data we already have — content + Buffer/GA4
// engagement snapshots. No fabricated numbers; when signal is thin the reads say
// so. The page-by-page website scan + GA4 landing reads land as those connect.

const PLATFORM_LABELS = {
  facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn',
  twitter: 'Twitter / X', gbp: 'Google Business', wordpress: 'Website',
  blog: 'Blog', email: 'Email', youtube: 'YouTube', tiktok: 'TikTok',
}

const READ_ICONS = {
  'trending-up': TrendingUp,
  'calendar-clock': CalendarClock,
  activity: Activity,
  sparkles: Sparkles,
}

const TONE = {
  good: { ring: 'bg-success/10', icon: 'text-success', card: 'border-border bg-card' },
  warn: { ring: 'bg-warning/15', icon: 'text-warning', card: 'border-warning/25 bg-warning/10' },
  muted: { ring: 'bg-muted', icon: 'text-muted-foreground', card: 'border-border bg-card' },
}

// Shared icon-circle card shell used by ReadCard and PendingRead below.
function ReadShell({ cardCls, ringCls, iconCls, icon: Icon, children }) {
  return (
    <div className={`rounded-2xl border p-5 ${cardCls}`}>
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${ringCls}`}>
          <Icon className={`h-4 w-4 ${iconCls}`} />
        </div>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  )
}

function ReadCard({ read }) {
  const Icon = READ_ICONS[read.icon] || Sparkles
  const tone = TONE[read.tone] || TONE.muted
  return (
    <ReadShell cardCls={tone.card} ringCls={tone.ring} iconCls={tone.icon} icon={Icon}>
      <p className="text-sm leading-relaxed">
        <span className="font-semibold">{read.title}</span>{' '}
        <span className="text-muted-foreground">{read.body}</span>
      </p>
      {read.action && (
        <div className="mt-3">
          <Link
            to={read.action.to}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity"
          >
            <Mic className="h-4 w-4" /> {read.action.label}
          </Link>
        </div>
      )}
    </ReadShell>
  )
}

// One "unlocks when connected" preview row in the website section.
function PendingRead({ icon, badge, children }) {
  return (
    <ReadShell cardCls="border-dashed border-border bg-card opacity-60" ringCls="bg-info/10" iconCls="text-info" icon={icon}>
      <span className="text-2xs uppercase tracking-wide bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
        {badge}
      </span>
      <p className="text-sm leading-relaxed mt-2 text-muted-foreground">{children}</p>
    </ReadShell>
  )
}

// GA4 engagement-rate bar (0–1 float → coloured pill).
function EngagementPill({ rate }) {
  const pct  = Math.round((rate || 0) * 100)
  const good = pct >= 55
  // Compact (% only) — the "engaged" label lives in the card's column-header
  // footer so the pill stays inside its fixed alignment column.
  return (
    <span
      title={`${pct}% engaged`}
      className={`text-2xs font-medium px-1.5 py-0.5 rounded-full tabular-nums text-center ${good ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}
    >
      {pct}%
    </span>
  )
}

// Renders when GA4 is connected — landing pages with sessions + engagement.
function LandingPageRead({ data }) {
  if (!data?.connected) {
    return (
      <PendingRead icon={LogIn} badge="Unlocks when GA4 connects">
        <span className="font-semibold text-foreground">Coming:</span>{' '}
        which pages people land on first and whether they go on to book — the literal{' '}
        <span className="italic">&ldquo;is the website landing well?&rdquo;</span> read, with the specific fix to make.
      </PendingRead>
    )
  }
  if (data.error && !data.landingPages?.length) {
    return (
      <PendingRead icon={LogIn} badge="GA4 · Landing pages">
        Data temporarily unavailable — check back shortly.
      </PendingRead>
    )
  }
  if (!data.landingPages?.length) {
    return (
      <PendingRead icon={LogIn} badge="GA4 · Landing pages">
        Still gathering data — check back after a day or two of traffic.
      </PendingRead>
    )
  }

  const best = data.landingPages[0]
  const bestPct = Math.round((best.engagementRate || 0) * 100)
  const fix = bestPct < 50
    ? 'Most visitors to your top page leave quickly — make sure the first screen answers "why should I read this?" with a clear hook.'
    : null

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-info/10 flex items-center justify-center shrink-0">
          <LogIn className="h-4 w-4 text-info" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-2xs uppercase tracking-wide bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
            GA4 · Top landing pages (30d)
          </span>
          <ul className="mt-3 space-y-2">
            {data.landingPages.map((p) => (
              <li key={p.path} className="grid grid-cols-[minmax(0,1fr)_4rem_3.5rem_auto] items-center gap-3 text-sm">
                <span className="truncate text-muted-foreground min-w-0">{p.topic || p.path}</span>
                <span className="text-2xs text-muted-foreground tabular-nums text-right">{(p.sessions || 0).toLocaleString()}</span>
                <EngagementPill rate={p.engagementRate} />
                {p.keyEvents > 0 ? (
                  <span className="text-2xs font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary tabular-nums whitespace-nowrap">
                    {p.keyEvents}{data.hasKeyEvents ? ' conv.' : ''}
                  </span>
                ) : <span />}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-[minmax(0,1fr)_4rem_3.5rem_auto] gap-3 text-3xs text-muted-foreground mt-2 pt-2 border-t border-border">
            <span>page</span>
            <span className="text-right">sessions</span>
            <span>engaged</span>
            <span />
          </div>
          {fix && (
            <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
              <span className="font-medium text-foreground">To improve:</span> {fix}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// Renders when GA4 is connected — pages with poor engagement (high bounce rate).
function ExitAnalysisRead({ data }) {
  if (!data?.connected) {
    return (
      <PendingRead icon={TimerOff} badge="Unlocks when GA4 connects">
        <span className="font-semibold text-foreground">Coming:</span>{' '}
        pages where visitors leave fast (and why) — so you can fix the one that&rsquo;s leaking the most traffic.
      </PendingRead>
    )
  }
  if (data.error && !data.exitRisks?.length) {
    return (
      <PendingRead icon={TimerOff} badge="GA4 · Exit analysis">
        Data temporarily unavailable — check back shortly.
      </PendingRead>
    )
  }
  if (!data.exitRisks?.length) {
    return (
      <div className="rounded-2xl border border-success/15 bg-success/10 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-success mt-0.5 shrink-0" />
          <p className="text-sm">
            <span className="font-semibold">All your published pages are holding visitors well.</span>{' '}
            <span className="text-muted-foreground">No high-exit pages to flag — keep publishing consistently.</span>
          </p>
        </div>
      </div>
    )
  }

  const worst = data.exitRisks[0]
  const worstPct = Math.round((worst.bounceRate || 0) * 100)

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-warning/15 flex items-center justify-center shrink-0">
          <TimerOff className="h-4 w-4 text-warning" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-2xs uppercase tracking-wide bg-warning/10 text-warning px-2 py-0.5 rounded-full font-medium">
            GA4 · Pages leaking traffic
          </span>
          <p className="text-sm mt-2 text-muted-foreground">
            These published pages have the most visitors leaving without engaging.
            The first one to fix is <span className="font-medium text-foreground">{worst.topic || worst.path}</span> — {worstPct}% of visitors leave quickly.
          </p>
          <ul className="mt-3 space-y-2">
            {data.exitRisks.map((p) => {
              const pct = Math.round((p.bounceRate || 0) * 100)
              return (
                <li key={p.path} className="grid grid-cols-[minmax(0,1fr)_4rem_3.5rem] items-center gap-3 text-sm rounded-lg border border-border bg-background px-3 py-2">
                  <span className="truncate font-medium min-w-0">{p.topic || p.path}</span>
                  <span className="text-2xs text-muted-foreground tabular-nums text-right">{(p.sessions || 0).toLocaleString()}</span>
                  <span title={`${pct}% bounce`} className="text-2xs font-medium px-1.5 py-0.5 rounded-full bg-warning/10 text-warning text-center tabular-nums">{pct}%</span>
                </li>
              )
            })}
          </ul>
          <div className="grid grid-cols-[minmax(0,1fr)_4rem_3.5rem] gap-3 text-3xs text-muted-foreground mt-2 px-3">
            <span>page</span>
            <span className="text-right">sessions</span>
            <span className="text-center">bounce</span>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Fix: a clear hook in the first paragraph, a visible CTA, and ensuring the page loads fast on mobile.
          </p>
        </div>
      </div>
    </div>
  )
}

// SEO tab's period-scoped clicks/impressions — driven by the shared
// Week/Month/Year picker, from /api/insights/search-by-period. Separate from
// SearchQueriesRead below, whose topQueries/gaps always use a fixed rolling
// 28-day window regardless of the picker.
function SeoPeriodRead({ data, granularity }) {
  if (!data?.connected) return null
  if (data.error) return null
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Search className="h-4 w-4 text-primary" /> Search Console — {periodRelative(granularity, data.periodOffset).toLowerCase()}
      </h3>
      <div className="mt-4 space-y-3 text-sm">
        <div className="flex justify-between items-baseline">
          <span className="text-muted-foreground">Clicks</span>
          <span className="font-semibold tabular-nums">{fmtNum(data.clicks)}</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-muted-foreground">Impressions</span>
          <span className="font-semibold tabular-nums">{fmtNum(data.impressions)}</span>
        </div>
      </div>
      {data.periodOffset === 0 && (
        <p className="text-2xs text-muted-foreground mt-3 pt-3 border-t border-border">
          Google reports search data with a 1–3 day lag, so this {granularity}&rsquo;s total is still rising.
        </p>
      )}
    </div>
  )
}

// Renders when Search Console is connected — top queries + keyword gaps.
function SearchQueriesRead({ data }) {
  if (!data?.connected) {
    return (
      <PendingRead icon={Search} badge="Unlocks with Search Console · a separate connect">
        <span className="font-semibold text-foreground">Coming:</span>{' '}
        what people type into Google to find you — and the easy searches you&rsquo;re missing a post for.
        <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground ml-1">
          <PenLine className="h-3 w-3" /> with a suggested post to close the gap
        </span>
      </PendingRead>
    )
  }
  if (data.error) {
    return (
      <PendingRead icon={Search} badge="Search Console · temporarily unavailable">
        Data temporarily unavailable — check back shortly.
      </PendingRead>
    )
  }

  const hasGaps = data.gaps?.length > 0
  const hasQueries = data.topQueries?.length > 0

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-info/10 flex items-center justify-center shrink-0">
          <Search className="h-4 w-4 text-info" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-2xs uppercase tracking-wide bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
            Search Console · 28d
          </span>

          {hasQueries && (
            <>
              <p className="text-sm font-medium mt-3 mb-2">What people search to find you</p>
              <ul className="space-y-1.5">
                {data.topQueries.slice(0, 5).map((q) => (
                  <li key={q.query} className="grid grid-cols-[minmax(0,1fr)_4rem_2.5rem] items-center gap-3 text-sm">
                    <span className="truncate text-muted-foreground min-w-0">{q.query}</span>
                    <span className="text-2xs text-muted-foreground tabular-nums text-right">{q.impressions.toLocaleString()}</span>
                    <span className="text-2xs tabular-nums text-right">#{Math.round(q.position)}</span>
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-[minmax(0,1fr)_4rem_2.5rem] gap-3 text-3xs text-muted-foreground mt-2 pt-2 border-t border-border">
                <span>query</span>
                <span className="text-right">impr.</span>
                <span className="text-right">pos.</span>
              </div>
            </>
          )}

          {hasGaps && (
            <>
              <p className="text-sm font-medium mt-4 mb-1">
                <PenLine className="h-3.5 w-3.5 inline mr-1 text-primary" />
                Searches you&rsquo;re missing a strong post for
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                You show up in Google for these but aren&rsquo;t on page one — a dedicated post could move you up.
              </p>
              <ul className="space-y-2">
                {data.gaps.map((g) => (
                  <li key={g.query} className="text-sm rounded-lg border border-border bg-background px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium truncate min-w-0">{g.query}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-2xs text-muted-foreground">{g.impressions} impr.</span>
                        <span className="text-2xs text-muted-foreground">pos #{g.position}</span>
                        {!g.hasPost && (
                          <span className="text-2xs font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                            no post yet
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!hasQueries && !hasGaps && (
            <p className="text-sm text-muted-foreground mt-3">Still gathering data — check back after a few days of search traffic.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function StatPill({ label, value }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-4 py-2.5 rounded-xl bg-muted/50 min-w-[80px]">
      <span className="text-base font-semibold tabular-nums">{value}</span>
      <span className="text-2xs text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  )
}

function LocationStatRow({ loc, fmtN }) {
  const t = loc.totals || {}
  return (
    <div className="pt-3 mt-3 border-t border-border first:border-0 first:pt-0 first:mt-0">
      {loc.title && (
        <p className="text-xs font-medium text-foreground mb-2">{loc.title}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <StatPill label="Impressions"    value={fmtN(t.impressions)} />
        <StatPill label="Maps views"     value={fmtN(t.mapImpressions)} />
        <StatPill label="Search views"   value={fmtN(t.searchImpressions)} />
        <StatPill label="Directions"     value={fmtN(t.directionRequests)} />
        <StatPill label="Calls"          value={fmtN(t.callClicks)} />
        <StatPill label="Website clicks" value={fmtN(t.websiteClicks)} />
      </div>
    </div>
  )
}

function GbpPerformanceRead({ data }) {
  if (!data?.connected) {
    return (
      <PendingRead icon={MapPin} badge="Unlocks when Google Business Profile connects">
        <span className="font-semibold text-foreground">Coming:</span>{' '}
        how many people find your listing on Maps and Search, request directions, or call — across all your locations.
      </PendingRead>
    )
  }
  if (data.error) {
    return (
      <PendingRead icon={MapPin} badge="Google Business Profile · temporarily unavailable">
        Data temporarily unavailable — check back shortly.
      </PendingRead>
    )
  }

  const { totals = {}, locations = [], days = 30 } = data
  const fmtN = (n) => Number(n || 0).toLocaleString()
  const multiLoc = locations.length > 1

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-info/10 flex items-center justify-center shrink-0">
          <MapPin className="h-4 w-4 text-info" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-2xs uppercase tracking-wide bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
            Google Business Profile · {days}d{multiLoc ? ` · ${locations.length} locations` : ''}
          </span>

          {multiLoc ? (
            <>
              {/* Per-location rows */}
              {locations.map((loc) => (
                <LocationStatRow key={loc.name} loc={loc} fmtN={fmtN} />
              ))}
              {/* Combined total */}
              <div className="mt-4 pt-3 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground mb-2">Combined</p>
                <div className="flex flex-wrap gap-2">
                  <StatPill label="Impressions"    value={fmtN(totals.impressions)} />
                  <StatPill label="Maps views"     value={fmtN(totals.mapImpressions)} />
                  <StatPill label="Search views"   value={fmtN(totals.searchImpressions)} />
                  <StatPill label="Directions"     value={fmtN(totals.directionRequests)} />
                  <StatPill label="Calls"          value={fmtN(totals.callClicks)} />
                  <StatPill label="Website clicks" value={fmtN(totals.websiteClicks)} />
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2 mt-4">
              <StatPill label="Impressions"    value={fmtN(totals.impressions)} />
              <StatPill label="Maps views"     value={fmtN(totals.mapImpressions)} />
              <StatPill label="Search views"   value={fmtN(totals.searchImpressions)} />
              <StatPill label="Directions"     value={fmtN(totals.directionRequests)} />
              <StatPill label="Calls"          value={fmtN(totals.callClicks)} />
              <StatPill label="Website clicks" value={fmtN(totals.websiteClicks)} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Apple Business Insights ─────────────────────────────────────────────────
// Numbers come only from monthly recap PDFs the tenant uploads (one per
// location). Per-location view — Apple reports per location, so no cross-
// location summing. The trend is built from actual uploaded months only.
function fmtMonthShort(iso) {
  if (!iso) return ''
  const [y, m] = String(iso).split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString(undefined, { month: 'short' })
}
function fmtMonthLong(iso) {
  if (!iso) return ''
  const [y, m] = String(iso).split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
}

function AppleMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.365 1.43c0 1.14-.42 2.2-1.11 3-.76.9-2 .16-2.06.14-.06-.02-.02-1.12.66-2.02.7-.92 1.9-1.58 2.5-1.62.02.16.01.33.01.5zM19.9 17.02c-.35.82-.53 1.18-.99 1.9-.64 1.01-1.55 2.27-2.68 2.28-1 .01-1.26-.65-2.62-.64-1.36.01-1.64.66-2.64.65-1.13-.01-1.99-1.14-2.63-2.15-1.79-2.82-1.98-6.13-.87-7.89.78-1.24 2.02-1.97 3.18-1.97 1.18 0 1.92.66 2.9.66.95 0 1.53-.66 2.9-.66 1.03 0 2.13.56 2.91 1.53-2.56 1.4-2.14 5.05.31 6.1z" />
    </svg>
  )
}

function AppleYoY({ pct }) {
  if (pct == null) return null
  const up = Number(pct) >= 0
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span className={`text-sm font-semibold flex items-center gap-0.5 ${up ? 'text-success' : 'text-destructive'}`}>
      <Icon className="h-3 w-3" />{Math.abs(Number(pct))}% YoY
    </span>
  )
}

function AppleTile({ label, value, yoy }) {
  return (
    <div className="rounded-xl border border-border bg-accent/40 p-4">
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-3xl font-bold">{value == null ? '—' : Number(value).toLocaleString()}</span>
        <AppleYoY pct={yoy} />
      </div>
    </div>
  )
}

function AppleStat({ label, value }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <div className="text-2xl font-bold">{value == null ? '—' : Number(value).toLocaleString()}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}

function AppleInsightsRead({ data }) {
  const rows = data?.rows || []
  const locs = []
  const seen = new Set()
  for (const r of rows) {
    const key = r.locationId || '__none__'
    if (!seen.has(key)) { seen.add(key); locs.push({ key, name: r.locationName }) }
  }
  const [selKey, setSelKey] = useState(locs[0]?.key)

  if (!data?.connected || rows.length === 0) {
    return (
      <PendingRead icon={MapPin} badge="Unlocks when you upload your first Apple recap">
        <span className="font-semibold text-foreground">Coming:</span>{' '}
        place-card views, search taps, and interactions from Apple Maps — upload the monthly recap in{' '}
        <Link to="/settings/integrations" className="underline">Settings → Integrations</Link>.
      </PendingRead>
    )
  }

  const active = locs.find((l) => l.key === selKey) || locs[0]
  const locRows = rows.filter((r) => (r.locationId || '__none__') === active.key)
  const latest = locRows[0]
  const trend = [...locRows].reverse().slice(-6) // ascending, last 6 uploaded months
  const maxV = Math.max(1, ...trend.map((t) => Number(t.metrics?.placeCardViews || 0)))
  const multiLoc = locs.length > 1

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <AppleMark className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold leading-tight">Apple Business Insights</p>
            <p className="text-xs text-muted-foreground truncate">
              {(active.name || latest?.locationName) ? `${active.name || latest.locationName} · ` : ''}from Apple Maps
            </p>
          </div>
        </div>
        <span className="text-2xs uppercase tracking-wide bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium shrink-0">
          {fmtMonthLong(latest?.month)}
        </span>
      </div>

      {multiLoc && (
        <div className="inline-flex p-1 rounded-lg bg-secondary mt-3">
          {locs.map((l) => (
            <button
              key={l.key}
              onClick={() => setSelKey(l.key)}
              className={`px-3 py-1 rounded-md text-xs font-medium ${l.key === active.key ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
            >
              {l.name || 'Location'}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mt-4">
        <AppleTile label="Place card views" value={latest?.metrics?.placeCardViews} yoy={latest?.yoy?.viewsPct} />
        <AppleTile label="Taps from search" value={latest?.metrics?.tapsFromSearch} yoy={latest?.yoy?.tapsPct} />
      </div>

      <p className="text-xs font-semibold text-muted-foreground mt-5 mb-2 uppercase tracking-wide">Place card interactions</p>
      <div className="grid grid-cols-4 gap-3">
        <AppleStat label="Directions" value={latest?.metrics?.directions} />
        <AppleStat label="Photos" value={latest?.metrics?.photos} />
        <AppleStat label="Website" value={latest?.metrics?.website} />
        <AppleStat label="Calls" value={latest?.metrics?.call} />
      </div>

      {trend.length > 1 ? (
        <>
          <p className="text-xs font-semibold text-muted-foreground mt-6 mb-2 uppercase tracking-wide">Place card views · month over month</p>
          <div className="flex items-end gap-3 h-28 px-1">
            {trend.map((t, i) => {
              const v = Number(t.metrics?.placeCardViews || 0)
              const h = Math.round((v / maxV) * 100)
              const live = i === trend.length - 1
              return (
                <div key={t.month} className="flex-1 flex flex-col items-center gap-1">
                  <div className={`w-full rounded-t-md ${live ? 'bg-primary' : 'bg-primary/20'}`} style={{ height: `${Math.max(h, 4)}%` }} />
                  <span className={`text-2xs ${live ? 'font-semibold' : 'text-muted-foreground'}`}>{fmtMonthShort(t.month)}</span>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground mt-4">Upload next month&rsquo;s recap to start a month-over-month trend.</p>
      )}
    </div>
  )
}

// ── Channel tabs (Social Media / Website / Google Business / Apple / SEO) ────

const fmtNum = (n) => Number(n || 0).toLocaleString()

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap flex items-center gap-1.5 transition-colors ${
        active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" /> {label}
    </button>
  )
}

const GRANULARITY_LABELS = { week: 'Week', month: 'Month', year: 'Year' }

// Shared Social/Website/SEO period picker — Week/Month/Year granularity +
// Prev/Next, backed by src/lib/periodMath.js (mirrored server-side in
// api/_lib/periodMath.js so every tab agrees on period boundaries).
function PeriodNav({ granularity, periodOffset, onGranularityChange, onPrev, onNext, onToday }) {
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={onPrev}
          disabled={periodOffset <= MAX_OFFSET[granularity]}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Prev
        </button>
        <div className="flex items-center gap-2 text-center">
          <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <div className="text-sm font-bold leading-tight">{periodLabel(granularity, periodOffset)}</div>
            <div className="text-3xs font-semibold uppercase tracking-wide text-primary">{periodRelative(granularity, periodOffset)}</div>
          </div>
          {periodOffset !== 0 && (
            <button
              type="button"
              onClick={onToday}
              className="ml-1 rounded-md border border-border px-2 py-0.5 text-3xs font-semibold text-muted-foreground hover:bg-muted"
            >
              Back to this {granularity}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onNext}
          disabled={periodOffset >= 0}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="inline-flex p-1 rounded-lg bg-secondary mt-2.5">
        {GRANULARITIES.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onGranularityChange(g)}
            className={`px-3 py-1 rounded-md text-xs font-medium ${g === granularity ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}
          >
            {GRANULARITY_LABELS[g]}
          </button>
        ))}
      </div>
    </div>
  )
}

const PLATFORM_DOT = {
  instagram: 'bg-gradient-to-br from-purple-500 to-orange-400',
  instagram_story: 'bg-gradient-to-br from-purple-500 to-orange-400',
  facebook: 'bg-blue-600',
  linkedin: 'bg-sky-700',
  twitter: 'bg-slate-800',
  threads: 'bg-slate-800',
  tiktok: 'bg-slate-900',
  youtube: 'bg-red-600',
  youtube_short: 'bg-red-600',
  bluesky: 'bg-sky-500',
  mastodon: 'bg-indigo-600',
}

function PlatformBadge({ platform }) {
  const label = PLATFORM_LABELS[platform] || platform
  const initials = label.slice(0, 2).toUpperCase()
  return (
    <span className="flex items-center gap-2">
      <span className={`h-5 w-5 rounded-full flex items-center justify-center text-white text-3xs font-bold shrink-0 ${PLATFORM_DOT[platform] || 'bg-muted-foreground'}`}>
        {initials}
      </span>
      <span className="text-sm font-medium">{label}</span>
    </span>
  )
}

function SocialTab({ data, loading, cost, granularity = 'week' }) {
  if (loading && !data) {
    return (
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="h-40 rounded-2xl bg-muted animate-pulse" />
        <div className="h-40 rounded-2xl bg-muted animate-pulse" />
      </div>
    )
  }

  const overall = data?.overall || { posts: 0, reach: 0, engagement: 0 }
  const byPlatform = data?.byPlatform || []
  const topPost = data?.topPost
  // Run-cost is always a weekly figure (from the global recap, unrelated to
  // the period picker) — only meaningful when actually viewing a week.
  const showCost = granularity === 'week' && cost && cost.weekTotal > 0

  return (
    <>
      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Overall — social
          </h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground">Posts published</span>
              <span className="font-semibold tabular-nums">{overall.posts}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground">Reach</span>
              <span className="font-semibold tabular-nums">{overall.posts > 0 ? fmtNum(overall.reach) : '—'}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground">Engagement</span>
              <span className="font-semibold tabular-nums">{overall.posts > 0 ? fmtNum(overall.engagement) : '—'}</span>
            </div>
            {showCost && (
              <p className="text-2xs text-muted-foreground pt-1 border-t border-border">
                Estimated run cost this week: {fmtUsd(cost.weekTotal)}
                {cost.perPost != null && <> (≈ {fmtUsd(cost.perPost)}/post)</>}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Award className="h-4 w-4 text-primary" /> Your top post this {granularity}
          </h3>
          {topPost ? (
            <div className="text-sm mt-3">
              <div className="font-medium truncate">{topPost.topic}</div>
              <div className="text-2xs text-muted-foreground mt-0.5">{PLATFORM_LABELS[topPost.platform] || topPost.platform}</div>
              <div className="mt-2 font-semibold tabular-nums">{fmtNum(topPost.reach)} reach · {fmtNum(topPost.engagement)} engagement</div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mt-3">No social posts published this {granularity}.</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-primary" /> By platform
        </h3>
        {byPlatform.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-3">No social posts published this {granularity}.</p>
        ) : (
          <>
            <div className="divide-y divide-border mt-2">
              {byPlatform.map((p) => (
                <div key={p.platform} className="flex items-center justify-between py-3">
                  <PlatformBadge platform={p.platform} />
                  <div className="flex items-center gap-6 text-sm tabular-nums">
                    <span>{fmtNum(p.reach)} reach</span>
                    <span>{fmtNum(p.engagement)} engagement</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-2xs text-muted-foreground mt-3 pt-3 border-t border-border">
              Only platforms you&rsquo;ve actually published to this {granularity} are shown.
            </p>
          </>
        )}
      </div>
    </>
  )
}

function WebsiteWeekCard({ data }) {
  const granularity = data?.granularity || 'week'
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Globe className="h-4 w-4 text-primary" /> Website — {periodRelative(granularity, data?.periodOffset ?? 0).toLowerCase()}
      </h3>
      <div className="mt-4 space-y-3 text-sm">
        {data?.connected && data?.totalSessions != null && (
          <div className="flex justify-between items-baseline">
            <span className="text-muted-foreground">Total site sessions</span>
            <span className="font-semibold tabular-nums">{fmtNum(data.totalSessions)}</span>
          </div>
        )}
        <div className="flex justify-between items-baseline">
          <span className="text-muted-foreground">Sessions on your posts</span>
          <span className="font-semibold tabular-nums">
            {data?.connected && data?.sessions != null ? fmtNum(data.sessions) : '—'}
          </span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-muted-foreground">Engagement rate</span>
          <span className="font-semibold tabular-nums">
            {data?.connected && data?.engagementRate != null ? `${Math.round(data.engagementRate * 100)}%` : '—'}
          </span>
        </div>
        {data?.connected && data?.bookNowClicks != null && (
          <div className="flex justify-between items-baseline">
            <span className="text-muted-foreground">Book Now clicks</span>
            <span className="font-semibold tabular-nums">{fmtNum(data.bookNowClicks)}</span>
          </div>
        )}
        {!data?.connected && (
          <p className="text-2xs text-muted-foreground pt-1 border-t border-border">
            Connect GA4 in Settings → Integrations to see weekly website sessions.
          </p>
        )}
      </div>
    </div>
  )
}

function ChannelNotScopedNotice({ children }) {
  return (
    <div className="rounded-xl border border-dashed border-warning/40 bg-warning/5 p-3 text-2xs text-muted-foreground flex items-center gap-2 mb-4">
      <Info className="h-3.5 w-3.5 text-warning shrink-0" aria-hidden="true" />
      {children}
    </div>
  )
}

function DefinitionsModal({ onClose }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="How these numbers are calculated" className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
          <HelpCircle className="h-5 w-5 text-primary" /> How these numbers are calculated
        </h2>
        <div className="space-y-5 text-sm">
          <p className="text-muted-foreground">
            Social Media, Website, and SEO share one Week / Month / Year picker with Prev/Next — switch it and
            all three update to the same period. Google Business Profile and Apple aren&rsquo;t on the picker yet
            (see their own sections below).
          </p>
          <div>
            <h3 className="font-semibold flex items-center gap-2 mb-1">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center"><Smartphone className="h-3 w-3 text-primary" /></span>
              Social Media (Instagram, Facebook, LinkedIn, etc.)
            </h3>
            <ul className="list-disc pl-8 text-muted-foreground space-y-1.5">
              <li><span className="font-medium text-foreground">Reach</span> — unique accounts your connected platform reports having seen the post at least once.</li>
              <li><span className="font-medium text-foreground">Engagement</span> — likes + comments + shares + saves, added together, as reported by the platform.</li>
              <li>Numbers only update when Bernard pulls fresh stats — on a schedule (1, 3, 7, and 30 days after a post goes out), then it stops. A brand-new post can show 0 until its first pull.</li>
              <li>If your workspace publishes through Buffer rather than bundle.social: Buffer&rsquo;s API doesn&rsquo;t provide per-post engagement data today, so Reach/Engagement won&rsquo;t be available.</li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold flex items-center gap-2 mb-1">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center"><Globe className="h-3 w-3 text-primary" /></span>
              Website
            </h3>
            <ul className="list-disc pl-8 text-muted-foreground space-y-1.5">
              <li><span className="font-medium text-foreground">Total site sessions</span> — every GA4 session on your whole property for the selected period, including pages Bernard doesn&rsquo;t track (home, staff bios, service pages, etc).</li>
              <li><span className="font-medium text-foreground">Sessions on your posts</span> — GA4 sessions on just the pages tied to a published Bernard post, for the same period. Always ≤ total site sessions.</li>
              <li><span className="font-medium text-foreground">Engagement rate</span> — GA4&rsquo;s engaged sessions ÷ total sessions, for your posts&rsquo; pages.</li>
              <li><span className="font-medium text-foreground">Book Now clicks</span> — clicks on your booking-widget link (from Settings → Workspace &rsquo;s Booking URL), counted via GA4&rsquo;s automatic outbound-link tracking. No custom tracking code needed — GA4 detects any click to a different domain on its own. Only shows once Booking URL is set and GA4 is connected.</li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold flex items-center gap-2 mb-1">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center"><Search className="h-3 w-3 text-primary" /></span>
              SEO — clicks &amp; impressions
            </h3>
            <ul className="list-disc pl-8 text-muted-foreground space-y-1.5">
              <li><span className="font-medium text-foreground">Clicks</span> / <span className="font-medium text-foreground">Impressions</span> — Google Search Console&rsquo;s organic search totals for the selected week, month, or year.</li>
              <li>Google reports search data with a 1–3 day lag, so the current period&rsquo;s total is always partial and will keep rising.</li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold flex items-center gap-2 mb-1">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center"><MapPin className="h-3 w-3 text-primary" /></span>
              Google Business Profile
            </h3>
            <ul className="list-disc pl-8 text-muted-foreground space-y-1.5">
              <li><span className="font-medium text-foreground">Impressions</span> / <span className="font-medium text-foreground">Directions</span> / <span className="font-medium text-foreground">Calls</span> / <span className="font-medium text-foreground">Website clicks</span> — as reported by Google&rsquo;s Business Profile Performance API.</li>
              <li>Currently a rolling last-30-days window — not yet scoped to a specific week.</li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold flex items-center gap-2 mb-1">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center"><AppleMark className="h-3 w-3 text-primary" /></span>
              Apple Business Insights
            </h3>
            <ul className="list-disc pl-8 text-muted-foreground space-y-1.5">
              <li>Whatever Apple reports in your uploaded monthly recap — Bernard displays these numbers as-is, no independent calculation.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Analytics() {
  useDocumentTitle('Insights')
  const ws = useWorkspace()
  const { isEditor, isLoading: roleLoading } = useUserRole()
  const { data: stories = [], isLoading: storiesLoading } = useStories()
  const { data: performers = [] } = useTopPerformers()
  const { data: recap } = useWorkspaceRecap()
  const { data: topics } = useTopicSuggestions()
  const { data: health }        = useWebsiteHealth()
  const { data: websiteGA4 }    = useWebsiteGA4()
  const { data: searchData }    = useSearchQueries()
  const { data: gbpData }       = useGbpPerformance()
  const { data: appleData }     = useApplePerformance()

  const [activeTab, setActiveTab] = useState('social')
  const [granularity, setGranularity] = useState('week')
  const [periodOffset, setPeriodOffset] = useState(0)
  const [defsOpen, setDefsOpen] = useState(false)
  const { data: socialPeriod, isLoading: socialPeriodLoading } = useSocialByPeriod(granularity, periodOffset)
  const { data: websitePeriod } = useWebsiteByPeriod(granularity, periodOffset)
  const { data: seoPeriod } = useSearchByPeriod(granularity, periodOffset)

  const changeGranularity = (g) => {
    setGranularity(g)
    setPeriodOffset(0)
  }

  // Owner/producer surface — individual clinicians use Home, not the asset board.
  if (!roleLoading && !isEditor) return <Navigate to="/" replace />

  if (storiesLoading) return <PageSkeleton variant="dashboard" />

  const assetName = ws?.display_name || 'This asset'

  const { reads } = deriveInsights({ stories, performers })
  const cost = buildCostView(recap?.cost || {})
  const suggestions = (topics?.suggestions || []).slice(0, 3)

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 flex-wrap">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            {assetName} — Insights
            <button
              type="button"
              onClick={() => setDefsOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
            >
              <HelpCircle className="h-3.5 w-3.5" /> How these numbers are calculated
            </button>
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Bernard reads your performance like a content expert and tells you what&rsquo;s working and what
            to do next — in plain language, with the numbers behind it if you want them.
          </p>
        </div>
        <div className="text-2xs text-muted-foreground flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1.5">
          <RefreshCw className="h-3 w-3" /> Updates as your posts gather data
        </div>
      </div>

      {defsOpen && <DefinitionsModal onClose={() => setDefsOpen(false)} />}

      {/* GA4 pending banner — only when not yet connected */}
      {!ws?.ga4_property_id && (
        <div className="rounded-xl border border-dashed border-primary/40 bg-accent/40 px-4 py-3 mt-5 flex items-start gap-3">
          <Globe className="h-4 w-4 mt-0.5 shrink-0 text-info" aria-hidden="true" />
          <p className="text-sm">
            <span className="font-medium">Website traffic connects soon.</span>{' '}
            <span className="text-muted-foreground">
              Right now these reads use your social reach and content data. Connect GA4 in Settings → Integrations
              to fold site visits in automatically — same screen, sharper picture.
            </span>
          </p>
        </div>
      )}

      {/* SECTION 1 — the read */}
      <div className="flex items-center gap-2 mt-7 mb-3">
        <MessageSquareText className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="font-semibold">What&rsquo;s working — and what to do next</h2>
      </div>
      <div className="space-y-3">
        {reads.map((r) => <ReadCard key={r.id} read={r} />)}
      </div>

      {/* Channel tabs */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto mt-8 mb-5">
        <TabButton active={activeTab === 'social'} onClick={() => setActiveTab('social')} icon={Smartphone} label="Social Media" />
        <TabButton active={activeTab === 'website'} onClick={() => setActiveTab('website')} icon={Globe} label="Website" />
        <TabButton active={activeTab === 'gbp'} onClick={() => setActiveTab('gbp')} icon={MapPin} label="Google Business" />
        <TabButton active={activeTab === 'apple'} onClick={() => setActiveTab('apple')} icon={AppleMark} label="Apple" />
        <TabButton active={activeTab === 'seo'} onClick={() => setActiveTab('seo')} icon={Search} label="SEO" />
      </div>

      {(activeTab === 'social' || activeTab === 'website' || activeTab === 'seo') && (
        <PeriodNav
          granularity={granularity}
          periodOffset={periodOffset}
          onGranularityChange={changeGranularity}
          onPrev={() => setPeriodOffset((o) => Math.max(MAX_OFFSET[granularity], o - 1))}
          onNext={() => setPeriodOffset((o) => Math.min(0, o + 1))}
          onToday={() => setPeriodOffset(0)}
        />
      )}

      {activeTab === 'social' && (
        <SocialTab data={socialPeriod} loading={socialPeriodLoading} cost={periodOffset === 0 ? cost : null} granularity={granularity} />
      )}

      {activeTab === 'website' && (
        <div className="space-y-3">
          <WebsiteWeekCard data={websitePeriod} />
          {/* Live-now: page-health check (no GA4 needed) */}
          {health && health.checked > 0 && (
            health.issues.length === 0 ? (
              <div className="rounded-2xl border border-success/15 bg-success/10 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-success mt-0.5 shrink-0" />
                  <p className="text-sm">
                    <span className="font-semibold">All {health.checked} of your published pages are loading fine.</span>{' '}
                    <span className="text-muted-foreground">No broken links to fix right now — we&rsquo;ll flag any page that stops loading.</span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-warning/25 bg-warning/10 p-5">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-full bg-warning/15 flex items-center justify-center shrink-0">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-2xs uppercase tracking-wide bg-success/15 text-success px-2 py-0.5 rounded-full font-medium">
                      Live now · no GA4 needed
                    </span>
                    <p className="text-sm leading-relaxed mt-2">
                      <span className="font-semibold">
                        {health.issues.length} published {health.issues.length === 1 ? 'page isn’t' : 'pages aren’t'} loading.
                      </span>{' '}
                      <span className="text-muted-foreground">Readers who click through hit a dead end — worth fixing first.</span>
                    </p>
                    <ul className="mt-3 space-y-2">
                      {health.issues.map((it) => (
                        <li key={it.contentItemId} className="text-sm rounded-lg border border-border bg-card px-3 py-2">
                          <div className="font-medium truncate">{it.topic}</div>
                          <div className="text-2xs text-muted-foreground mt-0.5">{it.issue}</div>
                          <a
                            href={it.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-2xs text-primary mt-1.5 hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" /> Open the page
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )
          )}
          <LandingPageRead data={websiteGA4} />
          <ExitAnalysisRead data={websiteGA4} />
        </div>
      )}

      {activeTab === 'gbp' && (
        <div>
          <ChannelNotScopedNotice>Rolling last 30 days — not yet scoped to a specific week.</ChannelNotScopedNotice>
          <GbpPerformanceRead data={gbpData} />
        </div>
      )}

      {activeTab === 'apple' && (
        <div>
          <ChannelNotScopedNotice>Monthly recap (uploaded PDF) — not week-scoped.</ChannelNotScopedNotice>
          <AppleInsightsRead data={appleData} />
        </div>
      )}

      {activeTab === 'seo' && (
        <div className="space-y-3">
          <SeoPeriodRead data={seoPeriod} granularity={granularity} />
          <SearchQueriesRead data={searchData} />
        </div>
      )}

      {/* SECTION — what Bernard already did */}
      {suggestions.length > 0 && (
        <>
          <div className="flex items-center gap-2 mt-8 mb-3">
            <GitBranch className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="font-semibold">What Bernard already did with this</h2>
          </div>
          <div className="rounded-2xl border border-success/15 bg-success/10 p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-success mt-0.5 shrink-0" />
              <div className="text-sm leading-relaxed">
                <p>
                  You don&rsquo;t have to act on every note yourself — Bernard&rsquo;s already using this in the
                  background. Based on what&rsquo;s resonating, it lined up follow-up topics for your next interview:
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {suggestions.map((s, i) => (
                    <span key={i} className="text-2xs bg-card border border-border rounded-full px-3 py-1">{s}</span>
                  ))}
                </div>
                <p className="text-2xs text-muted-foreground mt-3">
                  Working today: your results decide <span className="font-medium">what to make next</span>.{' '}
                  Coming: using your best posts as the model for <span className="font-medium">how the next ones are written</span> too.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
