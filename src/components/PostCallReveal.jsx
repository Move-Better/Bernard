import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Sparkles, Send, Archive, Mail, ArrowRight, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { PLATFORM_META } from '@/lib/contentMeta'

// F2 A.3 — the post-call reveal. Mounted after a realtime call wraps
// (?from=realtime&wrap=1). Shows "your call became a month of material":
// what the Strategist scheduled this week, what it banked, and the digest
// contribution. Reads /api/content-plan/week-summary.
//
// HARD RULE: never fabricate counts. Until plan_week atoms exist for this week
// (the Strategist runs on completion via waitUntil), show the "being woven"
// state — no numbers. Polls (with a 60s hard cap, per the detail-drawer refresh
// contract) so it flips to the real reveal the moment the plan lands.

const DAY_FMT = { weekday: 'short' }

function dayLabel(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, DAY_FMT)
  } catch {
    return ''
  }
}

export default function PostCallReveal() {
  const navigate = useNavigate()
  const pollStartRef = useRef(Date.now())

  const { data } = useQuery({
    queryKey: ['week-summary'],
    queryFn: () => apiFetch('/api/content-plan/week-summary'),
    refetchInterval: (q) => {
      if (q.state.data?.hasPlan) return false
      if (Date.now() - pollStartRef.current > 60_000) return false // hard cap — no infinite poll
      return 3000
    },
    refetchOnWindowFocus: false,
  })

  // Fallback: plan not woven yet (or polling timed out). No fabricated counts.
  if (!data?.hasPlan) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-primary/30 bg-gradient-to-b from-card to-primary/5 p-7 text-center">
        <div role="status" className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          <span className="sr-only">Loading plan…</span>
        </div>
        <h2 className="text-xl font-bold tracking-tight">Your call is being woven into this week’s plan</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          I’m turning what you said into a paced set of posts. This takes a moment — you can keep working and check back.
        </p>
        <button
          type="button"
          onClick={() => navigate('/week')}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent/40"
        >
          Go to Your week <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    )
  }

  const platforms = Object.entries(data.byPlatform || {})

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-primary/30 bg-gradient-to-b from-card to-primary/5 p-7">
      <div className="mb-5 text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-r from-primary to-action">
          <Sparkles className="h-6 w-6 text-white" aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">
          Your call became <span className="bg-gradient-to-r from-primary to-action bg-clip-text text-transparent">a month of material</span>.
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Paced to your cadence so you never flood your audience.</p>
      </div>

      {/* Scheduled this week */}
      <div className="mb-3 rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold">Scheduled this week</span>
          <span className="ml-auto inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-2xs font-semibold text-success">
            to your cadence
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-2xs sm:text-xs">
          {platforms.map(([platform, count]) => {
            const meta = PLATFORM_META[platform] || { label: platform, icon: null }
            const Icon = meta.icon
            const days = (data.scheduled || [])
              .filter((s) => s.platform === platform)
              .map((s) => dayLabel(s.scheduled_at))
              .filter(Boolean)
            return (
              <div key={platform} className="flex items-center gap-1.5">
                {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                <span className="font-medium">{count} {meta.label}</span>
                {days.length > 0 && <span className="text-muted-foreground">· {days.join(', ')}</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Held as backlog */}
      {data.heldCount > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border bg-card p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Archive className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">+{data.heldCount} more drafted, held for upcoming weeks</div>
            <div className="text-2xs text-muted-foreground">Banked to your backlog so this one call carries you for weeks — not dumped all at once.</div>
          </div>
        </div>
      )}

      {/* Digest contribution */}
      {data.digest && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-action/30 bg-gradient-to-b from-card to-action/5 p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-action/20 text-action">
            <Mail className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">
              Highlights added to your {data.digest.frequency || ''} <span className="text-action">{data.digest.label}</span> newsletter
            </div>
            <div className="text-2xs text-muted-foreground">
              Assembled with the rest of the period{data.digest.next_send ? ` — sends ${data.digest.next_send}` : ''}, not now. One call ≠ one email.
            </div>
          </div>
        </div>
      )}

      <div className="text-center">
        <button
          type="button"
          onClick={() => navigate('/week')}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" /> Review this week’s {data.scheduledTotal}
        </button>
        <p className="mt-2 text-2xs text-muted-foreground">Nothing publishes without your yes.</p>
      </div>
    </div>
  )
}
