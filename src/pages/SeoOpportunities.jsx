import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  TrendingUp, Target, Sparkles, TrendingDown, GitBranch, Mic, PenLine, X,
  FilePlus2, FilePen, Wrench, Search, Lock, Plug, RefreshCw,
  SearchCheck, CheckCircle2, Repeat, CalendarClock,
  ArrowRight, ArrowUp, ArrowDown, Hourglass, FileCheck2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import {
  useSeoOpportunities, useDismissSeoOpportunity,
  useSeoCitations, useCitationQuestionAction,
} from '@/lib/queries'

// SEO Opportunities (/seo) — search demand → content Bernard makes with you,
// plus advisory on-site fixes. Built to .claude/mockups/seo-opportunities.html.
//
// Two halves:
//   "Write about this"          — ranked content opportunities (actionable).
//   "Recommended website updates" — advisory only, no actions (Bernard spots,
//                                   the tenant fixes).
// Decay + cannibalization render as locked placeholders until the weekly
// gsc-snapshot cron has accrued enough history.

const TYPE_META = {
  striking_distance: { tag: 'Striking distance', tagCls: 'bg-action text-action-foreground', icon: Target },
  demand_no_content: { tag: 'Demand, no content', tagCls: 'bg-primary text-primary-foreground', icon: Sparkles },
}

// Outlined (not filled) so severity pills read as a distinct signal from the
// solid TYPE_META tags above — both used "important" tints, but on different
// axes (opportunity type vs. how worthwhile). Shape now carries that split:
// solid fill = type, outline = severity.
const SEV_META = {
  high: { label: 'Worth doing', cls: 'border border-action text-action bg-transparent' },
  med:  { label: 'Nice lift',   cls: 'border border-primary text-primary bg-transparent' },
  low:  { label: 'Minor',       cls: 'border border-border text-muted-foreground bg-transparent' },
}

const FILTERS = [
  { key: 'all',         label: 'All' },
  { key: 'striking',    label: 'Striking distance' },
  { key: 'demand',      label: 'Demand, no content' },
  { key: 'decaying',    label: 'Decaying' },
  { key: 'cannibal',    label: 'Cannibalization' },
]

function SummaryCard({ value, label, tone, locked }) {
  return (
    <div className={`bg-card border border-border rounded-xl p-4 ${locked ? 'opacity-60' : ''}`}>
      <div className={`text-2xl font-semibold ${tone || ''}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}

function OpportunityCard({ opp, onStartInterview, onDraft, onDismiss, dismissing }) {
  const meta = TYPE_META[opp.type] || TYPE_META.demand_no_content
  const Icon = meta.icon
  const MatchIcon = opp.match?.has ? FilePen : FilePlus2
  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`text-2xs font-semibold px-2 py-0.5 rounded-full ${meta.tagCls}`}>{meta.tag}</span>
            <span className="text-2xs text-muted-foreground">{opp.intent}</span>
          </div>
          <div className="font-medium text-sm leading-snug flex items-center gap-2">
            <Icon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <span className="truncate">{opp.query}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{opp.why}</p>
          <div className={`text-2xs mt-2 inline-flex items-center gap-1 ${opp.match?.has ? 'text-muted-foreground' : 'text-action'}`}>
            <MatchIcon className="w-3.5 h-3.5" aria-hidden="true" /> {opp.match?.label}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums text-muted-foreground">#{opp.position}</div>
          <div className="text-2xs text-muted-foreground">{opp.impressions.toLocaleString()} impr · {opp.ctr}% ctr</div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
        <Button size="sm" onClick={() => onStartInterview(opp)}>
          <Mic className="w-3.5 h-3.5" /> Start interview
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDraft(opp)}>
          <PenLine className="w-3.5 h-3.5" /> Draft content
        </Button>
        <Button
          size="sm" variant="ghost"
          onClick={() => onDismiss(opp)}
          disabled={dismissing}
          aria-busy={dismissing}
          title="Dismiss this opportunity"
          aria-label="Dismiss this opportunity"
          className="ml-auto text-muted-foreground"
        >
          <X className="w-3.5 h-3.5" /> {dismissing ? 'Dismissing…' : 'Dismiss'}
        </Button>
      </div>
    </div>
  )
}

function LockedCard({ tag, icon: Icon, label, why }) {
  return (
    <div className="bg-card border border-dashed border-border rounded-xl p-4 opacity-70">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{tag}</span>
        <span className="text-2xs text-muted-foreground inline-flex items-center gap-1">
          <Lock className="w-3 h-3" /> Snapshots run Mondays — needs 2 weeks of history
        </span>
      </div>
      <div className="font-medium text-sm flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> {label}
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">{why}</p>
    </div>
  )
}

// Decay ("Slipping in rank") — a query that lost ground week-over-week. Same
// action seam as OpportunityCard, plus a "Refresh content" primary (drafting for
// the query is the practical way to defend a slipping page).
function DecayCard({ item, onRefresh, onStartInterview, onDismiss, dismissing }) {
  return (
    <div
      className="bg-card border border-destructive/30 rounded-xl p-4 hover:border-destructive/50 transition-colors"
      style={{ background: 'linear-gradient(0deg, hsl(var(--destructive) / 0.04), transparent)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-destructive text-destructive-foreground">Slipping</span>
            <span className="text-2xs text-muted-foreground">{item.intent}</span>
            <span className="text-2xs font-semibold text-destructive inline-flex items-center gap-0.5">
              <ArrowDown className="w-3 h-3" aria-hidden="true" /> {item.drop} pos / wk
            </span>
          </div>
          <div className="font-medium text-sm leading-snug flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-destructive shrink-0" aria-hidden="true" />
            <span className="truncate">{item.query}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{item.why}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums inline-flex items-center gap-1">
            #{item.prevPosition} <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" /> <span className="text-destructive">#{item.position}</span>
          </div>
          <div className="text-2xs text-muted-foreground mt-0.5">{item.impressions.toLocaleString()} impr · 28d</div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
        <Button size="sm" onClick={() => onRefresh(item)}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh content
        </Button>
        <Button size="sm" variant="outline" onClick={() => onStartInterview(item)}>
          <Mic className="w-3.5 h-3.5" /> Start interview
        </Button>
        <Button
          size="sm" variant="ghost"
          onClick={() => onDismiss(item)}
          disabled={dismissing}
          aria-busy={dismissing}
          title="Dismiss this slipping query"
          aria-label="Dismiss this slipping query"
          className="ml-auto text-muted-foreground"
        >
          <X className="w-3.5 h-3.5" /> {dismissing ? 'Dismissing…' : 'Dismiss'}
        </Button>
      </div>
    </div>
  )
}

// Post-publish "Did it work?" — ranking movement for a published website piece.
function PostPublishCard({ item }) {
  const improved = item.delta > 0
  const flat     = item.delta === 0
  const toneCls  = improved ? 'text-success' : flat ? 'text-muted-foreground' : 'text-destructive'
  const dateLabel = new Date(item.publishedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-accent text-accent-foreground">Website · blog</span>
            <span className="text-2xs text-muted-foreground">published {dateLabel}</span>
          </div>
          <div className="font-medium text-sm leading-snug flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <span className="truncate">&ldquo;{item.topic}&rdquo; <span className="text-muted-foreground font-normal">→ {item.query}</span></span>
          </div>
          <div className="text-2xs mt-2 inline-flex items-center gap-1 text-muted-foreground">
            {item.confidence === 'exact'
              ? <><CheckCircle2 className="w-3.5 h-3.5 text-success" aria-hidden="true" /> Exact match</>
              : <><Search className="w-3.5 h-3.5" aria-hidden="true" /> Likely match</>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums inline-flex items-center gap-1">
            #{item.positionAtPublish} <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" /> <span className={toneCls}>#{item.positionNow}</span>
          </div>
          <div className={`text-2xs font-semibold mt-0.5 inline-flex items-center gap-0.5 justify-end ${toneCls}`}>
            {improved ? <><ArrowUp className="w-3 h-3" aria-hidden="true" /> up {item.delta} since publish</>
              : flat ? <>no change yet</>
              : <><ArrowDown className="w-3 h-3" aria-hidden="true" /> down {Math.abs(item.delta)} since publish</>}
          </div>
        </div>
      </div>
    </div>
  )
}

// Cannibalization — a query where 2+ of the workspace's own pages both rank.
function CannibalCard({ item }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-primary text-primary-foreground">Cannibalization</span>
        <span className="text-2xs text-muted-foreground">{item.intent}</span>
      </div>
      <div className="font-medium text-sm leading-snug flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="truncate">{item.query}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{item.why}</p>
      <div className="mt-2.5 space-y-1">
        {item.pages.map((p) => (
          <div key={p.page} className="flex items-center justify-between gap-3 text-2xs bg-muted/40 rounded-lg px-2.5 py-1.5">
            <span className="truncate text-muted-foreground">{p.page}</span>
            <span className="shrink-0 tabular-nums font-medium">#{p.position} · {p.impressions.toLocaleString()} impr</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SiteCard({ s }) {
  const sev = SEV_META[s.sev] || SEV_META.low
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start gap-3">
        <span className={`shrink-0 mt-0.5 text-2xs font-semibold px-2 py-0.5 rounded-full ${sev.cls}`}>{sev.label}</span>
        <div className="min-w-0">
          <div className="font-medium text-sm leading-snug">{s.title}</div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.why}</p>
          <div className="text-2xs text-muted-foreground mt-1.5 inline-flex items-center gap-1">
            <Search className="w-3 h-3" /> {s.source}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Citation scoreboard ("Are you the answer?") ─────────────────────────────
// Built to .claude/mockups/answer-graph-v1.html screen 2 (Q sign-off 2026-07-02).
// AI assistants now answer a large share of patient questions directly; the
// scoreboard tracks whether THIS clinic is the cited answer, per question per
// engine, and turns every gap into an interview coverage goal.

const ENGINE_META = [
  { key: 'chatgpt',    label: 'ChatGPT' },
  { key: 'perplexity', label: 'Perplexity' },
  { key: 'google',     label: 'Google AI' },
]

function shortDomain(domain) {
  if (!domain) return null
  const base = domain.replace(/^www\./, '')
  return base.length > 22 ? `${base.slice(0, 20)}…` : base
}

function EngineCell({ probe, connected }) {
  if (!connected) return <span className="text-2xs text-muted-foreground/60" title="This engine isn't connected yet">·</span>
  if (!probe) return <span className="text-2xs text-muted-foreground">—</span>
  if (probe.cited) {
    return (
      <span className="inline-flex text-2xs font-bold px-2 py-1 rounded-full bg-success/10 text-success whitespace-nowrap">
        ✓ You
      </span>
    )
  }
  return (
    <span
      className="inline-flex text-2xs font-medium px-2 py-1 rounded-full bg-destructive/10 text-destructive/80 whitespace-nowrap"
      title={probe.topCitedDomain ? `Cited instead: ${probe.topCitedDomain}` : 'No local source cited'}
    >
      {shortDomain(probe.topCitedDomain) || '— generic'}
    </span>
  )
}

// Weekly answer-share trend inside the hero — one bar per probe week (the
// same any-engine share rule as the top-line %). Hidden until two weekly
// probes have accrued, mirroring the page's decay/cannibalization pattern of
// features lighting up as history builds.
function ShareTrend({ history }) {
  if (!Array.isArray(history) || history.length < 2) return null
  return (
    <div className="mt-4 pt-3 border-t border-white/15">
      <div className="text-3xs font-semibold uppercase tracking-wider opacity-60 mb-1.5">
        Answer share by week
      </div>
      <div className="flex items-end gap-1.5">
        {history.map((h) => {
          const pct = h.probed > 0 ? Math.round((h.cited / h.probed) * 100) : 0
          const label = new Date(`${h.week_start}T00:00:00Z`)
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
          return (
            <div
              key={h.week_start}
              className="flex flex-col items-center flex-1 min-w-0 max-w-[4.5rem]"
              title={`${label}: cited in ${h.cited} of ${h.probed} questions`}
            >
              <div className="flex items-end h-9 w-full justify-center" aria-hidden="true">
                <div
                  className="w-[60%] max-w-[18px] rounded-t-[3px] bg-white/50"
                  style={{ height: `${Math.round((pct / 100) * 32) + 2}px` }}
                />
              </div>
              <div className="text-3xs font-bold opacity-90 tabular-nums">{pct}%</div>
              <div className="text-3xs opacity-50 whitespace-nowrap">{label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CitationHero({ share, perEngine, connectedEngines, lastProbedAt, history }) {
  const probedLabel = lastProbedAt
    ? new Date(lastProbedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : null
  return (
    <div
      className="rounded-xl p-5 text-primary-foreground"
      style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(186 83% 18%))' }}
    >
      <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
        <div>
          <div className="text-2xs font-semibold uppercase tracking-wider opacity-70">Are you the answer?</div>
          <div className="flex items-end gap-3 mt-1 flex-wrap">
            <div className="text-4xl font-black tabular-nums">{share.pct}%</div>
            <div className="text-sm opacity-80 pb-1.5">
              cited in <span className="font-bold">{share.citedQuestions} of {share.probedQuestions}</span> tracked patient questions
            </div>
            {share.deltaQuestions !== null && share.deltaQuestions !== 0 && (
              <div className="text-2xs font-bold pb-2 px-2 py-0.5 rounded-full bg-white/15 whitespace-nowrap">
                {share.deltaQuestions > 0 ? '▲ +' : '▼ '}{share.deltaQuestions} question{Math.abs(share.deltaQuestions) === 1 ? '' : 's'} vs last probe
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-3 sm:ml-auto flex-wrap">
          {ENGINE_META.map(({ key, label }) => {
            const tally = perEngine?.[key]
            return (
              <div key={key} className="rounded-lg bg-white/10 px-4 py-2.5 text-center min-w-[5.5rem]">
                {connectedEngines?.[key] && tally ? (
                  <div className="text-lg font-bold tabular-nums">{tally.cited}/{tally.probed}</div>
                ) : (
                  <div className="text-lg font-bold opacity-50" title="Not connected yet">—</div>
                )}
                <div className="text-3xs opacity-75">{label}{!connectedEngines?.[key] && ' · soon'}</div>
              </div>
            )
          })}
        </div>
      </div>
      <ShareTrend history={history} />
      <div className="text-2xs opacity-70 mt-3">
        Probed weekly{probedLabel && ` · last run ${probedLabel}`} · clicks are no longer the scoreboard — AI answers now resolve a large share of patient searches before any website is visited.
      </div>
    </div>
  )
}

function CitationRow({ row, connectedEngines, onQueueGoal, queueing }) {
  const anyCited = ENGINE_META.some(({ key }) => row.engines[key]?.cited)
  const queued = Boolean(row.goalQueuedAt)
  return (
    <tr className={!anyCited && !queued ? 'bg-action/5' : ''}>
      <td className="py-3 pr-4 font-medium text-sm">{row.question}</td>
      {ENGINE_META.map(({ key }) => (
        <td key={key} className="px-3 text-center">
          <EngineCell probe={row.engines[key]} connected={connectedEngines?.[key]} />
        </td>
      ))}
      <td className="pl-3">
        {anyCited ? (
          <span className="text-2xs font-medium text-success inline-flex items-center gap-1 whitespace-nowrap">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Answer live · holding
          </span>
        ) : queued ? (
          <span className="text-2xs font-medium text-muted-foreground inline-flex items-center gap-1 whitespace-nowrap">
            <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" /> Queued for interview
          </span>
        ) : (
          <Button
            size="sm"
            onClick={() => onQueueGoal(row)}
            disabled={queueing}
            aria-busy={queueing}
            className="bg-action text-action-foreground hover:bg-action/90 whitespace-nowrap"
          >
            <Mic className="w-3.5 h-3.5" /> → Monday&apos;s interview
          </Button>
        )}
      </td>
    </tr>
  )
}

function CitationScoreboard() {
  const { data, isLoading } = useSeoCitations()
  const act = useCitationQuestionAction()

  if (isLoading) return <div className="h-40 rounded-xl bg-muted animate-pulse mt-5" />

  // Pre-first-probe state: the cron seeds questions + probes on Mondays.
  if (!data?.available) {
    return (
      <div className="mt-5 bg-card border border-dashed border-border rounded-xl p-4 text-sm text-muted-foreground flex items-start gap-2.5">
        <SearchCheck className="w-4 h-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <span>
          <span className="font-medium text-foreground">Are you the answer?</span>{' '}
          Every Monday Bernard asks ChatGPT and Perplexity the questions your patients ask, and tracks whether
          you&apos;re the cited answer.{' '}
          {data?.seededQuestions > 0
            ? `${data.seededQuestions} questions are tracked — the first probe lands next Monday.`
            : 'Questions seed automatically from your Search Console data on the first run.'}
        </span>
      </div>
    )
  }

  const rows = data.rows || []
  const gaps = rows.filter((r) => !ENGINE_META.some(({ key }) => r.engines[key]?.cited))
  const queuedGaps = gaps.filter((r) => r.goalQueuedAt)
  const firstOpenGap = gaps.find((r) => !r.goalQueuedAt) || gaps[0]
  const onQueueGoal = (row) => act.mutate({ action: 'queue_goal', id: row.id })

  return (
    <div className="mt-5 space-y-4">
      <CitationHero
        share={data.share}
        perEngine={data.perEngine}
        connectedEngines={data.connectedEngines}
        lastProbedAt={data.lastProbedAt}
        history={data.history}
      />

      <div className="bg-card border border-border rounded-xl p-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-2xs text-muted-foreground border-b border-border">
              <th className="py-2 pr-4 font-semibold">Patient question</th>
              {ENGINE_META.map(({ key, label }) => (
                <th key={key} className="py-2 px-3 font-semibold text-center">{label}</th>
              ))}
              <th className="py-2 pl-3 font-semibold">Next step</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <CitationRow
                key={row.id}
                row={row}
                connectedEngines={data.connectedEngines}
                onQueueGoal={onQueueGoal}
                queueing={act.isPending && act.variables?.id === row.id}
              />
            ))}
          </tbody>
        </table>
      </div>

      {gaps.length > 0 && (
        <div className="rounded-xl border-2 border-action/40 bg-action/5 p-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Repeat className="w-4 h-4 text-action" aria-hidden="true" /> The loop — gap → interview → answer → cited
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {queuedGaps.length > 0
              ? <>{queuedGaps.length} uncited question{queuedGaps.length === 1 ? ' is' : 's are'} queued as <span className="font-medium text-foreground">interview coverage goals</span> — they surface as suggested topics when your next interview starts.</>
              : <>Queue an uncited question and it becomes an <span className="font-medium text-foreground">interview coverage goal</span> — a suggested topic the moment your next interview starts.</>}
          </p>
          {firstOpenGap && (
            <div className="mt-3 rounded-lg bg-card border border-border px-4 py-3 text-sm italic text-muted-foreground">
              &ldquo;AIs are answering &lsquo;{firstOpenGap.question}&rsquo; without you. Give me your two-minute take and it&apos;s published this week.&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NotConnected() {
  return (
    <div className="bg-card border border-border rounded-xl p-8 text-center">
      <Plug className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
      <h2 className="text-base font-semibold">Connect Search Console to see opportunities</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
        Once Google Search Console is connected, Bernard turns the searches you already show up for into
        content to make and site fixes to suggest.
      </p>
      <Link to="/settings/integrations" className="inline-flex items-center gap-2 mt-4 bg-primary text-primary-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90 transition-opacity">
        <Plug className="w-4 h-4" /> Connect Search Console
      </Link>
    </div>
  )
}

export default function SeoOpportunities() {
  useDocumentTitle('SEO Opportunities')
  const ws = useWorkspace()
  const navigate = useNavigate()
  const { isEditor, isLoading: roleLoading } = useUserRole()
  const qc = useQueryClient()
  const { data, isLoading, isFetching, dataUpdatedAt } = useSeoOpportunities()
  const dismiss = useDismissSeoOpportunity()
  const [filter, setFilter] = useState('all')

  const handleRefresh = () => qc.invalidateQueries({ queryKey: ['seo-opportunities'] })
  const updatedLabel = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null

  // Editor surface — same gate as Insights/Overview.
  if (!roleLoading && !isEditor) return <Navigate to="/" replace />

  const assetName = ws?.display_name || 'This asset'

  // Action handlers. Both seed the destination with the target query via the
  // live `?topic=` seam (same one HomeRightRail uses for suggested topics):
  //   Start interview → NewInterview reads ?topic= into the interview's topic
  //                     (→ interviews.topic → interview system prompt).
  //   Draft content   → NewBrief reads ?topic= into the brief title.
  const onStartInterview = (opp) => navigate(`/new/interview?topic=${encodeURIComponent(opp.query)}`)
  const onDraft          = (opp) => navigate(`/new/brief?topic=${encodeURIComponent(opp.query)}`)
  const onDismiss        = (opp) => dismiss.mutate({ query: opp.query }, {
    onError: () => {
      // Surface the failure — the dismiss button re-enables automatically when isPending clears
      console.error('[SeoOpportunities] dismiss failed for query:', opp.query)
    },
  })

  const opps = data?.opportunities || []
  const filteredOpps = filter === 'striking' ? opps.filter((o) => o.type === 'striking_distance')
    : filter === 'demand' ? opps.filter((o) => o.type === 'demand_no_content')
    : opps
  const decay       = data?.decay || []
  const postPublish = data?.postPublish || []
  const cannibal    = data?.cannibalization || []
  const locked      = data?.locked || { decay: {}, cannibalization: {} }
  const summary = data?.summary || { open: 0, strikingDistance: 0, demandNoContent: 0, decaying: 0 }
  const site = data?.websiteSuggestions || []

  // Which sections a given filter reveals.
  const showWrite    = filter === 'all' || filter === 'striking' || filter === 'demand'
  const showDecay    = filter === 'all' || filter === 'decaying'
  const showResults  = filter === 'all'   // "Did it work?" + website updates only in the full view
  const showCannibal = filter === 'all' || filter === 'cannibal'

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
            SEO Opportunities
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Search demand you can already see in Google — turned into things to write about, plus site fixes to suggest.
            <span className="text-primary font-medium"> {assetName}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="text-right">
            <div>Search Console · last 28 days</div>
            {updatedLabel && <div className="mt-0.5">Fetched at {updatedLabel}</div>}
          </div>
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            aria-label="Refresh SEO data"
            title="Refresh"
            className="p-1.5 rounded-lg hover:bg-accent/20 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3 mt-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[0,1,2,3].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
          </div>
          {[0,1,2].map(i => <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : data?.connected === false ? (
        <div className="mt-5"><NotConnected /></div>
      ) : data?.error === 'gsc_fetch_failed' ? (
        <div className="mt-5 bg-card border border-border rounded-xl p-6 text-sm text-muted-foreground flex items-center justify-between gap-4">
          <span>Couldn&apos;t reach Search Console right now. This is usually temporary.</span>
          <button
            onClick={() => window.location.reload()}
            className="shrink-0 text-sm font-medium text-primary hover:underline"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {/* Citation scoreboard — "Are you the answer?" (weekly probe) */}
          <CitationScoreboard />

          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 mb-6">
            <SummaryCard value={summary.open} label="Open opportunities" />
            <SummaryCard value={summary.strikingDistance} label="Striking distance (#8–20)" tone="text-action" />
            <SummaryCard value={summary.demandNoContent} label="Demand, no content" />
            {locked.decay?.ready
              ? <SummaryCard value={summary.decaying ?? 0} label="Slipping in rank" tone="text-destructive" />
              : <SummaryCard value={<Lock className="w-5 h-5 inline" />} label="Decay — needs history" locked />}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 mb-4 overflow-x-auto">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                  filter === f.key ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-muted-foreground hover:bg-accent/20'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Write about this */}
          {showWrite && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <PenLine className="w-4 h-4 text-primary" aria-hidden="true" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Write about this</h2>
                <span className="text-2xs text-muted-foreground">— search demand → content Bernard makes with you</span>
              </div>
              <div className="space-y-3 mb-8">
                {filteredOpps.map((opp) => (
                  <OpportunityCard
                    key={opp.query}
                    opp={opp}
                    onStartInterview={onStartInterview}
                    onDraft={onDraft}
                    onDismiss={onDismiss}
                    dismissing={dismiss.isPending && dismiss.variables?.query === opp.query}
                  />
                ))}
                {filteredOpps.length === 0 && (
                  <div className="text-sm text-muted-foreground py-8 text-center bg-card border border-border rounded-xl">
                    No open opportunities in this view right now. New ones surface as your Search Console data updates.
                  </div>
                )}
              </div>
            </>
          )}

          {/* Slipping in rank — decay (live once ~2 snapshot weeks accrue) */}
          {showDecay && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="w-4 h-4 text-destructive" aria-hidden="true" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Slipping in rank — act fast</h2>
                <span className="text-2xs text-muted-foreground">— rankings you were close to winning, now falling</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Compared this week&apos;s Search Console position to last week&apos;s. These were in reach and dropped 3+ spots — refresh or expand the page before it leaves page 1.
              </p>
              <div className="space-y-3 mb-8">
                {!locked.decay?.ready ? (
                  <div className="bg-muted/40 border border-dashed border-border rounded-xl p-4 text-sm text-muted-foreground flex items-start gap-2.5">
                    <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      <span className="font-medium text-foreground">Decay</span> needs about 2 weeks of Search Console history to compare rankings week-over-week. Snapshots run Mondays; check back once a couple have accrued.
                    </span>
                  </div>
                ) : decay.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center bg-card border border-border rounded-xl">
                    Nothing slipping this week — your rankings held or improved. Bernard checks every Monday.
                  </div>
                ) : (
                  decay.map((item) => (
                    <DecayCard
                      key={item.query}
                      item={item}
                      onRefresh={onDraft}
                      onStartInterview={onStartInterview}
                      onDismiss={onDismiss}
                      dismissing={dismiss.isPending && dismiss.variables?.query === item.query}
                    />
                  ))
                )}
              </div>
            </>
          )}

          {/* Did it work? — post-publish ranking delta (website pieces only) */}
          {showResults && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Target className="w-4 h-4 text-primary" aria-hidden="true" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Did it work?</h2>
                <span className="text-2xs text-muted-foreground">— ranking movement after you publish for a query</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                When you publish a <span className="font-medium text-foreground">website / blog</span> piece for a query, Bernard watches its Search Console position before vs. after.
              </p>
              <div className="space-y-3 mb-8">
                {postPublish.length > 0 ? (
                  postPublish.map((item) => <PostPublishCard key={`${item.query}-${item.publishedAt}`} item={item} />)
                ) : (
                  <div className="bg-card border border-border rounded-xl p-6 text-center">
                    <Hourglass className="w-6 h-6 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
                    <div className="text-sm font-medium">No measured pieces yet</div>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xl mx-auto leading-relaxed">
                      As you publish website/blog content, each piece&apos;s target query shows up here with its ranking movement — once there&apos;s a snapshot from before and after it went live. Social posts aren&apos;t measured; they don&apos;t affect Google rankings.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Cannibalization — locked until per-URL history accrues */}
          {showCannibal && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <GitBranch className="w-4 h-4 text-primary" aria-hidden="true" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Cannibalization</h2>
                <span className="text-2xs text-muted-foreground">— two of your pages competing for one query</span>
              </div>
              <div className="space-y-3 mb-8 mt-2">
                {!locked.cannibalization?.ready ? (
                  <LockedCard
                    tag="Cannibalization" icon={GitBranch} label="Two of your pages competing for one query"
                    why="Flags when multiple of your pages rank for the same query and split the clicks — consolidate to lift both. Needs per-URL Search Console history, which Bernard is now collecting; it can't be backfilled."
                  />
                ) : cannibal.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center bg-card border border-border rounded-xl">
                    No cannibalization detected — no query has two of your pages splitting its clicks.
                  </div>
                ) : (
                  cannibal.map((item) => <CannibalCard key={item.query} item={item} />)
                )}
              </div>
            </>
          )}

          {/* Recommended website updates (advisory) */}
          {showResults && (
            <>
              <div className="flex items-center gap-2 mt-2 mb-1">
                <Wrench className="w-4 h-4 text-primary" aria-hidden="true" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recommended website updates</h2>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Changes to the site itself — not content. <span className="font-medium text-foreground">Bernard spots them; you or your web person make them.</span> Suggestions only — Bernard never edits your site.
              </p>
              <div className="space-y-2.5">
                {site.map((s, i) => <SiteCard key={`${s.source}-${i}`} s={s} />)}
                {site.length === 0 && (
                  <div className="text-sm text-muted-foreground py-6 text-center bg-card border border-border rounded-xl">
                    No site suggestions right now — the on-page checks came back clean.
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
