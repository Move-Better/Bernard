import { useState, useEffect } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useSmartBack } from '@/lib/useSmartBack'
import { ArrowLeft, Bot, Pause, Play, Power } from 'lucide-react'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { ROLE_ADMIN } from '@/lib/roles'
import { Switch } from '@/components/ui/switch'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useProducerFeed, useNeedsYou, useUpdateProducerConfig } from '@/lib/queries'
import {
  PRODUCER_LANES, laneValue, producerActive, withProducerChange,
  clampSpendCap, SPEND_CAP_MIN, SPEND_CAP_MAX, SPEND_CAP_DEFAULT,
} from '@/lib/producerConfig'

// /producer/settings — the Standing Producer control panel (Phase 4). The one
// place an owner decides what Bernard may do on his own and how much he can
// spend. Owner-only (server also enforces). Reads producer_config from the
// workspace; writes optimistically via useUpdateProducerConfig.

function LaneRow({ lane, checked, disabled, onToggle }) {
  // A "coming soon" lane (e.g. escalation email — no sender wired yet) renders
  // disabled so the control never pretends to do something it can't.
  const soon = Boolean(lane.comingSoon)
  return (
    <div className="flex items-start gap-3 border-t border-border py-3.5 first:border-t-0">
      <div className="pt-0.5">
        <Switch checked={soon ? false : checked} disabled={soon || disabled} onCheckedChange={onToggle} aria-label={lane.label} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{lane.label}</span>
          {lane.isNew && !soon && (
            <span className="inline-flex items-center rounded-full bg-action/15 px-1.5 py-0.5 text-3xs font-bold text-action">New</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{lane.description}</p>
      </div>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-3xs font-bold ${soon ? 'bg-muted text-muted-foreground' : checked ? 'bg-success/12 text-success' : 'bg-muted text-muted-foreground'}`}>
        {soon ? 'Coming soon' : checked ? 'On' : 'Off'}
      </span>
    </div>
  )
}

function actionsThisWeek(actions) {
  if (!Array.isArray(actions)) return 0
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000
  return actions.filter((a) => a.created_at && new Date(a.created_at).getTime() >= since).length
}

export default function ProducerSettings() {
  useDocumentTitle('Bernard · settings')
  const goBack = useSmartBack('/producer')
  const ws = useWorkspace()
  const { role, isLoading: roleLoading } = useUserRole()
  const update = useUpdateProducerConfig()
  const { data: feed } = useProducerFeed(50)
  const { data: needs } = useNeedsYou()

  const cfg = ws?.producer_config || {}
  const enabled = Boolean(cfg.enabled)
  const paused = Boolean(cfg.paused_at)
  const active = producerActive(cfg)

  // Local mirror of the spend cap so the slider drags smoothly; commit on
  // release. Re-seed when the persisted value changes (e.g. after refetch).
  const [cap, setCap] = useState(() => clampSpendCap(cfg.daily_ai_call_cap ?? SPEND_CAP_DEFAULT))
  useEffect(() => {
    setCap(clampSpendCap(cfg.daily_ai_call_cap ?? SPEND_CAP_DEFAULT))
  }, [cfg.daily_ai_call_cap])

  if (roleLoading) return null
  if (role !== ROLE_ADMIN) return <Navigate to="/producer" replace />

  const persist = (change) => update.mutate(withProducerChange(cfg, change))

  const weekActions = actionsThisWeek(feed?.actions)
  const needCount = Array.isArray(needs?.items) ? needs.items.length : 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={goBack}
          className="grid h-8 w-8 place-items-center rounded-lg border hover:bg-muted"
          aria-label="Back to Bernard’s workday"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <Bot className="h-5 w-5" aria-hidden="true" />
          {active && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-success" aria-hidden="true" />}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Bernard <span className="text-base font-normal text-muted-foreground">· your producer</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {enabled ? (paused ? 'Paused — his queue is kept; resume any time.' : 'Always on for this workspace.') : 'Not on this workspace’s team yet.'}
          </p>
        </div>
        {enabled && (
          <button
            type="button"
            onClick={() => persist(paused ? { paused_at: null } : { paused_at: new Date().toISOString() })}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold hover:bg-muted"
          >
            {paused ? <><Play className="h-4 w-4" /> Resume</> : <><Pause className="h-4 w-4" /> Pause</>}
          </button>
        )}
      </div>

      {!enabled ? (
        // Hire flow
        <div className="rounded-xl border-2 border-primary/30 bg-primary/[0.04] p-6 text-center">
          <Bot className="mx-auto mb-2 h-8 w-8 text-primary" aria-hidden="true" />
          <h2 className="text-base font-semibold">Hire Bernard as your producer</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            He’ll revise drafts on your change requests, repair captions that drift from your voice, and surface only what needs you. Nothing publishes without your yes — and you control every lane below.
          </p>
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => persist({ enabled: true, paused_at: null })}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Power className="h-4 w-4" aria-hidden="true" /> Hire Bernard
          </button>
        </div>
      ) : (
        <>
          {/* Lanes */}
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-1 text-2xs font-bold uppercase tracking-wide text-muted-foreground">
              What Bernard may do on his own
            </div>
            {PRODUCER_LANES.map((lane) => (
              <LaneRow
                key={lane.key}
                lane={lane}
                checked={laneValue(cfg, lane.key)}
                disabled={paused || update.isPending}
                onToggle={(val) => persist({ lanes: { [lane.key]: val } })}
              />
            ))}
            {paused && (
              <p className="mt-2 text-2xs text-muted-foreground">Bernard is paused — lanes take effect when you resume.</p>
            )}
          </div>

          {/* Spend cap + this week */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border bg-card p-4">
              <div className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">Daily spend cap</div>
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="range"
                  min={SPEND_CAP_MIN}
                  max={SPEND_CAP_MAX}
                  value={cap}
                  onChange={(e) => setCap(clampSpendCap(e.target.value))}
                  onPointerUp={() => persist({ daily_ai_call_cap: cap })}
                  onKeyUp={() => persist({ daily_ai_call_cap: cap })}
                  className="flex-1 accent-primary"
                  aria-label="Daily AI-action cap"
                />
                <span className="w-8 text-right text-xl font-bold tabular-nums">{cap}</span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                AI actions per day before Bernard pauses himself until tomorrow.
              </p>
            </div>

            <div className="rounded-xl border bg-card p-4">
              <div className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">This week</div>
              <div className="mt-2 flex items-center gap-6">
                <Link to="/producer" className="group">
                  <div className="text-xl font-bold tabular-nums group-hover:text-primary">{weekActions}</div>
                  <div className="text-xs text-muted-foreground group-hover:text-primary">actions →</div>
                </Link>
                <div>
                  <div className={`text-xl font-bold tabular-nums ${needCount ? 'text-action' : ''}`}>{needCount}</div>
                  <div className={`text-xs ${needCount ? 'text-action' : 'text-muted-foreground'}`}>need you</div>
                </div>
              </div>
            </div>
          </div>

          {/* Turn off */}
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3">
            <div>
              <div className="text-sm font-semibold">Turn Bernard off</div>
              <p className="text-xs text-muted-foreground">Stops all autonomous work. His history stays; you can re-hire any time.</p>
            </div>
            <button
              type="button"
              disabled={update.isPending}
              onClick={() => persist({ enabled: false, paused_at: null })}
              className="shrink-0 rounded-lg border border-destructive/40 px-3 py-1.5 text-sm font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-50"
            >
              Turn off
            </button>
          </div>
        </>
      )}

      <p className="text-2xs text-muted-foreground">
        A global kill switch lives in the environment (ops), separate from this per-workspace panel.
      </p>
    </div>
  )
}
