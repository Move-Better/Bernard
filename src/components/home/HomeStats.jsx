import { useMemo } from 'react'
import { ArrowRight } from 'lucide-react'

// HomeStats — 3-tile pipeline story: interviews captured → voice match → published.
// Tells the "I talked → in my voice → it's out there" narrative at a glance.
// Pulls from the same useStories() data as the rest of the page — no extra fetch.

const DAY_MS = 24 * 60 * 60 * 1000
const VOICE_SAMPLE_LIMIT = 20

function withinDays(ts, days) {
  if (!ts) return false
  const t = new Date(ts).getTime()
  if (!Number.isFinite(t)) return false
  const cutoff = Date.now() - days * DAY_MS
  return t >= cutoff
}

function inWindow(ts, lo, hi) {
  if (!ts) return false
  const t = new Date(ts).getTime()
  return Number.isFinite(t) && t >= lo && t < hi
}

function computeVoiceMatch(stories) {
  // Sample the N most-recent pieces that carry provenance.summary
  // (verbatim_pct + paraphrase_pct combine to "own words %"). Average them.
  const pieces = []
  for (const s of stories) {
    for (const p of s.pieces || []) {
      const sum = p?.provenance?.summary
      const own = (sum?.verbatim_pct ?? 0) + (sum?.paraphrase_pct ?? 0)
      if (own > 0 && p.updated_at) pieces.push({ own, t: new Date(p.updated_at).getTime() })
    }
  }
  if (pieces.length === 0) return null
  pieces.sort((a, b) => b.t - a.t)
  const sample = pieces.slice(0, VOICE_SAMPLE_LIMIT)
  const avg = sample.reduce((acc, p) => acc + p.own, 0) / sample.length
  return Math.round(avg)
}

export default function HomeStats({ stories = [] }) {
  const metrics = useMemo(() => {
    // This week — stories created or last-activity-updated in the last 7 days
    const thisWeek = stories.filter((s) => withinDays(s.last_activity_at || s.created_at, 7)).length

    // Published — story_stage === 'published' with last_activity within
    // the relevant window. Delta is published this 30d window vs prior 30d.
    const now = Date.now()
    const win30 = now - 30 * DAY_MS
    const win60 = now - 60 * DAY_MS
    const publishedThis = stories.filter((s) => s.story_stage === 'published' && inWindow(s.last_activity_at, win30, now)).length
    const publishedPrev = stories.filter((s) => s.story_stage === 'published' && inWindow(s.last_activity_at, win60, win30)).length
    const publishedDelta = publishedThis - publishedPrev

    // Voice match — averaged own-words % across the most-recent provenance
    // summaries. Falls back to null when no provenance exists yet, in which
    // case the card renders a placeholder.
    const voiceMatch = computeVoiceMatch(stories)

    return { thisWeek, publishedThis, publishedDelta, voiceMatch }
  }, [stories])

  return (
    <div className="flex items-stretch gap-0">
      {/* This week — input to the pipeline */}
      <div className="flex-1 rounded-2xl border border-border bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="text-2xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Last 7 days</div>
        <div className="text-4xl font-extrabold tracking-tight tabular-nums">{metrics.thisWeek}</div>
        <div className="text-sm text-muted-foreground mt-1">stories captured</div>
      </div>

      {/* Arrow connector */}
      <div className="flex items-center px-3 text-muted-foreground/30" aria-hidden="true">
        <ArrowRight className="h-4 w-4" />
      </div>

      {/* Voice match — center hero: the core moat KPI */}
      <div
        className="flex-1 rounded-2xl border p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
        style={{ background: 'hsl(var(--foreground))', borderColor: 'hsl(var(--foreground))', color: '#fff' }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-2xs font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.65)' }}>Voice match</div>
          {typeof metrics.voiceMatch === 'number' ? (
            <span className="inline-flex items-center justify-center rounded-full text-2xs font-bold px-2 py-0.5 bg-agreement-signal/20 text-agreement-signal">
              {metrics.voiceMatch >= 60 ? 'strong' : metrics.voiceMatch >= 40 ? 'fair' : 'building'}
            </span>
          ) : null}
        </div>
        <div className="text-4xl font-extrabold tracking-tight nx-grad-text tabular-nums">
          {typeof metrics.voiceMatch === 'number' ? `${metrics.voiceMatch}%` : '—'}
        </div>
        <div className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
          {typeof metrics.voiceMatch === 'number' ? 'your words · your voice' : 'Run an interview to start tracking'}
        </div>
      </div>

      {/* Arrow connector */}
      <div className="flex items-center px-3 text-muted-foreground/30" aria-hidden="true">
        <ArrowRight className="h-4 w-4" />
      </div>

      {/* Published — output of the pipeline */}
      <div className="flex-1 rounded-2xl border border-border bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center justify-between mb-2">
          <div className="text-2xs font-bold uppercase tracking-widest text-muted-foreground">Published</div>
          {metrics.publishedDelta !== 0 ? (
            <span className={`text-2xs font-bold ${metrics.publishedDelta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {metrics.publishedDelta > 0 ? '↗' : '↘'} {metrics.publishedDelta > 0 ? '+' : ''}{metrics.publishedDelta}
            </span>
          ) : null}
        </div>
        <div className="text-4xl font-extrabold tracking-tight tabular-nums">{metrics.publishedThis}</div>
        <div className="text-sm text-muted-foreground mt-1">last 30 days</div>
      </div>
    </div>
  )
}
