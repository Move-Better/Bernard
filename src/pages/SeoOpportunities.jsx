import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  TrendingUp, Target, Sparkles, TrendingDown, GitBranch, Mic, PenLine, X,
  FilePlus2, FilePen, Wrench, Search, Lock, Plug,
} from 'lucide-react'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useSeoOpportunities, useDismissSeoOpportunity } from '@/lib/queries'

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

const SEV_META = {
  high: { label: 'Worth doing', cls: 'bg-action/15 text-action' },
  med:  { label: 'Nice lift',   cls: 'bg-primary/10 text-primary' },
  low:  { label: 'Minor',       cls: 'bg-muted text-muted-foreground' },
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
          <div className={`text-2xs mt-2 inline-flex items-center gap-1 ${opp.match?.has ? 'text-accent-foreground' : 'text-action'}`}>
            <MatchIcon className="w-3.5 h-3.5" aria-hidden="true" /> {opp.match?.label}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold tabular-nums">#{opp.position}</div>
          <div className="text-2xs text-muted-foreground">{opp.impressions.toLocaleString()} impr · {opp.ctr}% ctr</div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
        <button
          onClick={() => onStartInterview(opp)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity"
        >
          <Mic className="w-3.5 h-3.5" /> Start interview
        </button>
        <button
          onClick={() => onDraft(opp)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-card border border-border inline-flex items-center gap-1.5 hover:bg-accent/20 transition-colors"
        >
          <PenLine className="w-3.5 h-3.5" /> Draft content
        </button>
        <button
          onClick={() => onDismiss(opp)}
          disabled={dismissing}
          className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-muted-foreground hover:bg-muted ml-auto inline-flex items-center gap-1.5 disabled:opacity-50 aria-[busy=true]:cursor-wait"
          title="Dismiss this opportunity"
        >
          <X className="w-3.5 h-3.5" /> {dismissing ? 'Dismissing…' : 'Dismiss'}
        </button>
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
          <Lock className="w-3 h-3" /> Unlocks as weekly snapshots accrue
        </span>
      </div>
      <div className="font-medium text-sm flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> {label}
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">{why}</p>
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
  const { data, isLoading } = useSeoOpportunities()
  const dismiss = useDismissSeoOpportunity()
  const [filter, setFilter] = useState('all')

  // Editor surface — same gate as Insights/Overview.
  if (!roleLoading && !isEditor) return <Navigate to="/" replace />

  const assetName = ws?.display_name || 'This asset'

  // Action handlers. P1 navigates to the creation flow carrying the target
  // query; destination-side seeding (pre-filling the interview/brief with the
  // query + intent) is wired in P2.
  const onStartInterview = (opp) => navigate(`/new/interview?seed=${encodeURIComponent(opp.query)}`)
  const onDraft          = (opp) => navigate(`/new?seed=${encodeURIComponent(opp.query)}`)
  const onDismiss        = (opp) => dismiss.mutate({ query: opp.query }, {
    onError: () => {
      // Surface the failure — the dismiss button re-enables automatically when isPending clears
      console.error('[SeoOpportunities] dismiss failed for query:', opp.query)
    },
  })

  const opps = data?.opportunities || []
  const filteredOpps = filter === 'striking' ? opps.filter((o) => o.type === 'striking_distance')
    : filter === 'demand' ? opps.filter((o) => o.type === 'demand_no_content')
    : (filter === 'decaying' || filter === 'cannibal') ? []
    : opps
  const showLocked = filter === 'all' || filter === 'decaying' || filter === 'cannibal'
  const summary = data?.summary || { open: 0, strikingDistance: 0, demandNoContent: 0 }
  const site = data?.websiteSuggestions || []

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
            SEO Opportunities
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Search demand you can already see in Google — turned into things to write about, plus site fixes to suggest.
            <span className="text-primary font-medium"> {assetName}</span>
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>Search Console · last 28 days</div>
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
          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 mb-6">
            <SummaryCard value={summary.open} label="Open opportunities" />
            <SummaryCard value={summary.strikingDistance} label="Striking distance (#8–20)" tone="text-action" />
            <SummaryCard value={summary.demandNoContent} label="Demand, no content" />
            <SummaryCard value={<Lock className="w-5 h-5 inline" />} label="Decay — needs history" locked />
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 mb-4 overflow-x-auto">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                  filter === f.key ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-muted-foreground hover:bg-accent/20'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Write about this */}
          <div className="flex items-center gap-2 mb-3">
            <PenLine className="w-4 h-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Write about this</h2>
            <span className="text-2xs text-muted-foreground">— search demand → content Bernard makes with you</span>
          </div>

          <div className="space-y-3">
            {filteredOpps.map((opp) => (
              <OpportunityCard
                key={opp.query}
                opp={opp}
                onStartInterview={onStartInterview}
                onDraft={onDraft}
                onDismiss={onDismiss}
                dismissing={dismiss.isPending}
              />
            ))}
            {filteredOpps.length === 0 && (filter === 'all' || filter === 'striking' || filter === 'demand') && (
              <div className="text-sm text-muted-foreground py-8 text-center bg-card border border-border rounded-xl">
                No open opportunities in this view right now. New ones surface as your Search Console data updates.
              </div>
            )}
            {showLocked && (
              <>
                <LockedCard
                  tag="Decaying" icon={TrendingDown} label="Pages slipping in rank"
                  why="Compares each query's position week-over-week to catch rankings that are falling before they leave page 1."
                />
                <LockedCard
                  tag="Cannibalization" icon={GitBranch} label="Two pages competing for one query"
                  why="Flags when multiple of your pages rank for the same query and split the clicks — consolidate to lift both."
                />
              </>
            )}
          </div>

          {/* Recommended website updates (advisory) */}
          <div className="flex items-center gap-2 mt-9 mb-1">
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
    </div>
  )
}
