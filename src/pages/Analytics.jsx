import { Link, Navigate } from 'react-router-dom'
import {
  Sparkles, MessageSquareText, TrendingUp, CalendarClock, Activity,
  BarChart3, Award, Globe, GitBranch, CheckCircle2, Mic, RefreshCw,
  Search, LogIn, TimerOff, PenLine, AlertTriangle, ExternalLink, MapPin,
} from 'lucide-react'
import { useWorkspace } from '@/lib/WorkspaceContext'
import {
  useStories, useTopPerformers, useWorkspaceRecap, useTopicSuggestions,
  useWebsiteHealth, useWebsiteGA4, useSearchQueries, useGbpPerformance,
} from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { deriveInsights, totalReach, sumField } from '@/lib/insightsReads'
import { buildCostView, fmtUsd } from '@/lib/costEstimate'
import PageSkeleton from '@/components/PageSkeleton'

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

  // Owner/producer surface — individual clinicians use Home, not the asset board.
  if (!roleLoading && !isEditor) return <Navigate to="/" replace />

  if (storiesLoading) return <PageSkeleton variant="dashboard" />

  const assetName = ws?.display_name || 'This asset'

  const { reads, facts } = deriveInsights({ stories, performers })

  // ── Receipts (all real; deltas only where we can truly compute them) ──
  const reach = totalReach(performers)
  const engagement = sumField(performers, 'engagement')
  const top3 = performers.slice(0, 3)
  const cost = buildCostView(recap?.cost || {})

  const suggestions = (topics?.suggestions || []).slice(0, 3)

  const fmtNum = (n) => Number(n || 0).toLocaleString()

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            {assetName} — Insights
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

      {/* SECTION 2 — the receipts */}
      <div className="flex items-center gap-2 mt-8 mb-3 flex-wrap">
        <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="font-semibold">The numbers behind it</h2>
        <span className="text-2xs text-muted-foreground">— just enough to trust the read</span>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        {/* This week vs last */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> This week
          </h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground">Posts published</span>
              <span className="font-semibold tabular-nums">
                {facts.thisWeek}
                {facts.publishedDelta !== 0 && (
                  <span className={facts.publishedDelta > 0 ? 'text-success' : 'text-muted-foreground'}>
                    {' '}{facts.publishedDelta > 0 ? '▲' : '▼'} {facts.publishedDelta > 0 ? '+' : ''}{facts.publishedDelta} vs last
                  </span>
                )}
              </span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground">Social reach (recent posts)</span>
              <span className="font-semibold tabular-nums">{facts.hasReachData ? fmtNum(reach) : '—'}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground">Engagement (likes + comments + shares)</span>
              <span className="font-semibold tabular-nums">{facts.hasReachData ? fmtNum(engagement) : '—'}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground">Website sessions (30d)</span>
              <span className="font-semibold tabular-nums">
                {websiteGA4?.connected && websiteGA4?.totalPageviews != null
                  ? websiteGA4.totalPageviews.toLocaleString()
                  : <span className="text-muted-foreground">—</span>}
              </span>
            </div>
            {cost.weekTotal > 0 && (
              <p className="text-2xs text-muted-foreground pt-1 border-t border-border">
                Estimated run cost this week: {fmtUsd(cost.weekTotal)}
                {cost.perPost != null && <> (≈ {fmtUsd(cost.perPost)}/post)</>}
              </p>
            )}
          </div>
        </div>

        {/* Top 3 */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Award className="h-4 w-4 text-primary" /> Your top {top3.length || 3} right now
          </h3>
          {top3.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3">
              Engagement ranking fills in as your posts gather reach (and the moment GA4 connects, website pages join the list).
            </p>
          ) : (
            <ul className="mt-3 text-sm">
              {top3.map((p) => {
                const value = Number(p.reach ?? p.pageviews ?? 0)
                const unit = p.source === 'ga4' ? 'visits' : 'reach'
                return (
                  <li key={p.id} className="flex items-center justify-between border-t border-border pt-3 mt-3 first:border-0 first:pt-0 first:mt-0">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.topic || 'Untitled'}</div>
                      <div className="text-2xs text-muted-foreground">{PLATFORM_LABELS[p.platform] || p.platform || ''}</div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="font-semibold tabular-nums">{fmtNum(value)}</div>
                      <div className="text-2xs text-muted-foreground">{unit}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* SECTION 3 — Google Business Profile */}
      <div className="flex items-center gap-2 mt-8 mb-3">
        <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="font-semibold">Google Business Profile</h2>
      </div>
      <GbpPerformanceRead data={gbpData} />

      {/* SECTION 5 — tune up the website */}
      <div className="flex items-center gap-2 mt-8 mb-1">
        <Globe className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="font-semibold">Tune up the website</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-3 max-w-2xl">
        Not &ldquo;make more content&rdquo; — the actual changes to make on the site so visitors do something
        once they land. Bernard spots them; you make them. These reads light up as each input connects.
      </p>
      <div className="space-y-3">
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
        <SearchQueriesRead data={searchData} />
      </div>

      {/* SECTION 6 — what Bernard already did */}
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
