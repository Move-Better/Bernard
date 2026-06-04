import { Link, Navigate } from 'react-router-dom'
import {
  BarChart3, Globe, CalendarCheck, Heart, FileText, Plug, Link2,
  AlertTriangle, Clock, Layers, Users, TrendingUp,
} from 'lucide-react'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useStories, useTopPerformers } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

// Per-asset analytics dashboard. One per workspace ("asset") — Equine is the
// standalone template; People/Animals reuse it (and share the Jane booking
// property for their Bookings tile). Four input tiles, each rendering in one of
// two states: CONNECTED (live numbers) or ATTACH (a connect CTA when the source
// isn't wired yet). The structure ships complete and empty; sources attach over
// time. Today only Content is connected — GA4 traffic/bookings and Buffer social
// light up as those inputs come online. Spec: .claude/mockups/equine-dashboard.html.

const PLATFORM_LABELS = {
  facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn',
  twitter: 'Twitter / X', gbp: 'Google Business', wordpress: 'Website',
  blog: 'Blog', email: 'Email', youtube: 'YouTube', tiktok: 'TikTok',
}

function StatePill({ tone = 'muted', children }) {
  const tones = {
    muted: 'bg-muted text-muted-foreground',
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-[hsl(38_92%_35%)]',
  }
  return (
    <span className={`text-2xs uppercase tracking-wide px-2 py-0.5 rounded-full font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

function Kpi({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  )
}

function Tile({ icon: Icon, iconClass, title, pill, children, footer }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Icon className={`h-4 w-4 ${iconClass}`} /> {title}
        </h2>
        {pill}
      </div>
      <div className="mt-4">{children}</div>
      {footer && <p className="text-2xs text-muted-foreground mt-3">{footer}</p>}
    </section>
  )
}

// Reusable empty/connect state for an unwired input.
function AttachState({ icon: Icon, iconClass = 'text-muted-foreground', title, body, cta }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
      <Icon className={`h-6 w-6 mx-auto ${iconClass}`} />
      <p className="text-sm font-medium mt-2">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">{body}</p>
      {cta}
    </div>
  )
}

export default function Analytics() {
  useDocumentTitle('Analytics')
  const ws = useWorkspace()
  const { isEditor, isLoading: roleLoading } = useUserRole()
  const { data: stories = [] } = useStories()
  const { data: topPerformers = [] } = useTopPerformers()

  // Owner/producer surface — individual clinicians use Home, not the asset board.
  if (!roleLoading && !isEditor) return <Navigate to="/" replace />

  const assetName = ws?.display_name || 'This asset'

  // ── Content tile: live, derived from real pieces (no fabricated data) ──
  const pieces = stories.flatMap((s) => s.pieces || [])
  const published = pieces.filter((p) => p.status === 'published')
  const performedWell = pieces.filter((p) => p.performed_well).length
  const voiceScores = pieces
    .map((p) => p.voice_fidelity_score)
    .filter((v) => typeof v === 'number' && v > 0)
  const avgVoice = voiceScores.length
    ? Math.round(voiceScores.reduce((a, b) => a + b, 0) / voiceScores.length)
    : null
  const recentPublished = [...published]
    .sort((a, b) => new Date(b.published_at || b.updated_at || 0) - new Date(a.published_at || a.updated_at || 0))
    .slice(0, 4)

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
            {assetName} — Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            This asset&rsquo;s performance across website, bookings, social, and content. Attach each
            input as it comes online — the structure is here and ready.
          </p>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
        <Kpi icon={Users} label="Website users" value="—" sub="Attach GA4 to populate" />
        <Kpi icon={CalendarCheck} label="Bookings" value="—" sub="Attach booking source" />
        <Kpi icon={Heart} label="Social engagement" value="—" sub="Attach Buffer" />
        <Kpi icon={FileText} label="Posts published" value={published.length} sub="NarrateRx · connected" />
      </div>

      {/* Tiles */}
      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        {/* 1. Website traffic (GA4) */}
        <Tile
          icon={Globe} iconClass="text-info" title="Website traffic"
          pill={<StatePill>GA4 · not connected</StatePill>}
          footer="When connected: users · sessions · pageviews · top pages · top sources · month-over-month"
        >
          <AttachState
            icon={Link2}
            title="Attach a GA4 property"
            body={`Connect this asset's Google Analytics so its website traffic shows here. Each asset uses its own GA4 property.`}
            cta={
              <Link to="/settings/integrations" className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm px-3 py-1.5 rounded-lg mt-3 hover:opacity-90 transition-opacity">
                <Plug className="h-4 w-4" /> Connect GA4
              </Link>
            }
          />
        </Tile>

        {/* 2. Bookings (GA4 key events) */}
        <Tile
          icon={CalendarCheck} iconClass="text-primary" title="Bookings"
          pill={<StatePill>key events · not connected</StatePill>}
          footer="When connected: booking starts · completions · conversion rate · month-over-month"
        >
          <AttachState
            icon={Link2}
            title="Attach a booking source"
            body="Booking starts and completions from this asset's GA4 key events — the bottom-of-funnel outcome."
            cta={
              <Link to="/settings/integrations" className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm px-3 py-1.5 rounded-lg mt-3 hover:opacity-90 transition-opacity">
                <Plug className="h-4 w-4" /> Connect bookings
              </Link>
            }
          />
        </Tile>

        {/* 3. Social (Buffer) */}
        <Tile
          icon={Heart} iconClass="text-destructive" title="Social engagement"
          pill={<StatePill tone="warning">Buffer · needs fix</StatePill>}
          footer="When connected: reach · likes · comments · shares, per platform · month-over-month"
        >
          <AttachState
            icon={AlertTriangle} iconClass="text-warning"
            title="Buffer stats not yet available"
            body="Buffer's per-post metrics return empty today (a known API gap). This tile is structured and ready — it lights up once the Buffer fix lands."
            cta={
              <span className="inline-flex items-center gap-2 border border-border bg-card text-muted-foreground text-sm px-3 py-1.5 rounded-lg mt-3">
                <Clock className="h-4 w-4" /> Pending Buffer fix
              </span>
            }
          />
        </Tile>

        {/* 4. Content performance (NarrateRx) — connected */}
        <Tile
          icon={FileText} iconClass="text-success" title="Content performance"
          pill={<StatePill tone="success">NarrateRx · connected</StatePill>}
          footer="Ties published content → the outcome it drove (joins to GA4 once the website input is attached)"
        >
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xl font-bold tabular-nums">{published.length}</div>
              <div className="text-2xs text-muted-foreground">published</div>
            </div>
            <div>
              <div className="text-xl font-bold tabular-nums">{avgVoice != null ? `${avgVoice}%` : '—'}</div>
              <div className="text-2xs text-muted-foreground">avg voice fidelity</div>
            </div>
            <div>
              <div className="text-xl font-bold tabular-nums">{performedWell}</div>
              <div className="text-2xs text-muted-foreground">flagged &ldquo;performed well&rdquo;</div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-2xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3" /> Recently published
            </div>
            {recentPublished.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-2">Nothing published yet.</p>
            ) : (
              <ul className="mt-1">
                {recentPublished.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm border-t border-border pt-2 mt-2">
                    <span className="truncate">{p.topic || 'Untitled'}</span>
                    <span className="text-muted-foreground shrink-0 ml-3 text-xs">
                      {PLATFORM_LABELS[p.platform] || p.platform || ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {topPerformers.length === 0 && (
              <p className="text-2xs text-muted-foreground mt-3">
                Engagement ranking lights up once the GA4 input is attached and traffic accrues.
              </p>
            )}
          </div>
        </Tile>
      </div>

      {/* Cross-asset note */}
      <div className="rounded-2xl border border-border bg-card p-4 mt-4 flex items-start gap-3">
        <Layers className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          This four-tile structure is every asset&rsquo;s dashboard. Each asset attaches its own
          inputs; the layout stays identical so the whole of Move Better reads the same way.
        </p>
      </div>
    </div>
  )
}
