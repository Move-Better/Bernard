import { Link, Navigate } from 'react-router-dom'
import {
  Sparkles, MessageSquareText, TrendingUp, CalendarClock, Activity,
  BarChart3, Award, Globe, GitBranch, CheckCircle2, Mic, RefreshCw,
  Search, LogIn, TimerOff, PenLine, AlertTriangle, ExternalLink,
} from 'lucide-react'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useStories, useTopPerformers, useWorkspaceRecap, useTopicSuggestions, useWebsiteHealth } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { deriveInsights, totalReach, sumField } from '@/lib/insightsReads'
import { buildCostView, fmtUsd } from '@/lib/costEstimate'

// ── Insights advisor ──────────────────────────────────────────────────────────
//
// Narrate reading the workspace's performance like a content expert: plain-
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
  warn: { ring: 'bg-warning/15', icon: 'text-warning', card: 'border-[hsl(28_80%_85%)] bg-[hsl(28_90%_97%)]' },
  muted: { ring: 'bg-muted', icon: 'text-muted-foreground', card: 'border-border bg-card' },
}

function ReadCard({ read }) {
  const Icon = READ_ICONS[read.icon] || Sparkles
  const tone = TONE[read.tone] || TONE.muted
  return (
    <div className={`rounded-2xl border p-5 ${tone.card}`}>
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${tone.ring}`}>
          <Icon className={`h-4 w-4 ${tone.icon}`} />
        </div>
        <div className="flex-1 min-w-0">
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
        </div>
      </div>
    </div>
  )
}

// One "unlocks when connected" preview row in the website section.
function PendingRead({ icon: Icon, badge, children }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 opacity-90">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-info/10 flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-info" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-2xs uppercase tracking-wide bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
            {badge}
          </span>
          <p className="text-sm leading-relaxed mt-2 text-muted-foreground">{children}</p>
        </div>
      </div>
    </div>
  )
}

export default function Analytics() {
  useDocumentTitle('Insights')
  const ws = useWorkspace()
  const { isEditor, isLoading: roleLoading } = useUserRole()
  const { data: stories = [] } = useStories()
  const { data: performers = [] } = useTopPerformers()
  const { data: recap } = useWorkspaceRecap()
  const { data: topics } = useTopicSuggestions()
  const { data: health } = useWebsiteHealth()

  // Owner/producer surface — individual clinicians use Home, not the asset board.
  if (!roleLoading && !isEditor) return <Navigate to="/" replace />

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
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            {assetName} — Insights
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Narrate reads your performance like a content expert and tells you what&rsquo;s working and what
            to do next — in plain language, with the numbers behind it if you want them.
          </p>
        </div>
        <div className="text-2xs text-muted-foreground flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1.5">
          <RefreshCw className="h-3 w-3" /> Updates as your posts gather data
        </div>
      </div>

      {/* GA4 pending banner */}
      <div className="rounded-xl border border-dashed border-primary/40 bg-accent/40 px-4 py-3 mt-5 flex items-start gap-3">
        <Globe className="h-4 w-4 mt-0.5 shrink-0 text-info" aria-hidden="true" />
        <p className="text-sm">
          <span className="font-medium">Website traffic connects soon.</span>{' '}
          <span className="text-muted-foreground">
            Right now these reads use your social reach and content data. The moment Google finishes
            connecting GA4, site visits fold in automatically — same screen, sharper picture. No setup on your end.
          </span>
        </p>
      </div>

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
              <span className="text-muted-foreground">Website visits</span>
              <span className="font-semibold tabular-nums text-muted-foreground">— soon</span>
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

      {/* SECTION 3 — tune up the website */}
      <div className="flex items-center gap-2 mt-8 mb-1">
        <Globe className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="font-semibold">Tune up the website</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-3 max-w-2xl">
        Not &ldquo;make more content&rdquo; — the actual changes to make on the site so visitors do something
        once they land. Narrate spots them; you make them. These reads light up as each input connects.
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
            <div className="rounded-2xl border border-[hsl(28_80%_85%)] bg-[hsl(28_90%_97%)] p-5">
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
        <PendingRead icon={LogIn} badge="Unlocks when GA4 connects">
          <span className="font-semibold text-foreground">Coming:</span>{' '}
          which pages people land on first and whether they go on to book — the literal{' '}
          <span className="italic">&ldquo;is the website landing well?&rdquo;</span> read, with the specific fix to make.
        </PendingRead>
        <PendingRead icon={TimerOff} badge="Unlocks when GA4 connects">
          <span className="font-semibold text-foreground">Coming:</span>{' '}
          pages where visitors leave fast (and why) — so you can fix the one that&rsquo;s leaking the most traffic.
        </PendingRead>
        <PendingRead icon={Search} badge="Unlocks with Search Console · a separate connect">
          <span className="font-semibold text-foreground">Coming:</span>{' '}
          what people type into Google to find you — and the easy searches you&rsquo;re missing a post for.
          <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground ml-1">
            <PenLine className="h-3 w-3" /> with a suggested post to close the gap
          </span>
        </PendingRead>
      </div>

      {/* SECTION 4 — what Narrate already did */}
      {suggestions.length > 0 && (
        <>
          <div className="flex items-center gap-2 mt-8 mb-3">
            <GitBranch className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="font-semibold">What Narrate already did with this</h2>
          </div>
          <div className="rounded-2xl border border-success/15 bg-success/10 p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-success mt-0.5 shrink-0" />
              <div className="text-sm leading-relaxed">
                <p>
                  You don&rsquo;t have to act on every note yourself — Narrate&rsquo;s already using this in the
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
