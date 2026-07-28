import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'

/**
 * MomentsPanel — read-only list of the banked moments mined from one interview
 * (P2 of the moment-bank sprint). Rendered inside StoryDetail so extraction
 * quality is visible on the story itself; the weekly planner (P3) will draw
 * exemplars from this same bank.
 *
 * Deliberately display-only: no retire/edit affordances yet — those arrive
 * with the Library "Moments" tab (P4, mockup-first).
 */

// Display labels for the scoreMoments.js taxonomy. Kept as a local mirror —
// the api/ module can't be imported across the client/server boundary.
const MOMENT_TYPE_LABELS = {
  coaching_cue: 'Coaching cue',
  patient_breakthrough: 'Patient breakthrough',
  hook: 'Hook',
  credibility: 'Credibility',
  insight: 'Insight',
  technique: 'Technique',
  story: 'Story',
}

function scoreTone(score) {
  if (score >= 80) return 'bg-primary/10 text-primary'
  if (score >= 60) return 'text-foreground/70 bg-muted'
  return 'bg-muted text-muted-foreground'
}

function MomentRow({ moment }) {
  const typeLabel = MOMENT_TYPE_LABELS[moment.moment_type] || moment.moment_type || 'Moment'
  return (
    <li className="py-3 first:pt-1 last:pb-1">
      <div className="flex items-start gap-3">
        <span
          className={`shrink-0 inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-2xs font-bold tabular-nums ${scoreTone(moment.score ?? 0)}`}
          title="Post-worthiness score at extraction (0–100)"
        >
          {moment.score ?? '—'}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <blockquote className="text-sm text-foreground/90 leading-relaxed">
            “{moment.excerpt}”
          </blockquote>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
            <span className="font-medium text-foreground/60">{typeLabel}</span>
            {moment.topic && <span>· {moment.topic}</span>}
            {moment.status === 'retired' && <span className="uppercase tracking-wide">· retired</span>}
            {!moment.is_exemplar && (
              <span title="A stronger near-duplicate moment represents this cluster; the planner draws that one.">
                · duplicate of a stronger moment
              </span>
            )}
            {moment.usage_count > 0 && <span>· used ×{moment.usage_count}</span>}
          </div>
        </div>
      </div>
    </li>
  )
}

export default function MomentsPanel({ interviewId }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['moments', interviewId],
    queryFn: () => apiFetch(`/api/db/moments?interview_id=${encodeURIComponent(interviewId)}`),
    enabled: !!interviewId,
    refetchOnWindowFocus: false,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading moments…
      </div>
    )
  }
  if (isError) {
    return <p className="py-3 text-sm text-muted-foreground">Couldn’t load moments for this story.</p>
  }

  const moments = data?.moments || []
  if (!moments.length) {
    return (
      <p className="py-3 text-sm text-muted-foreground">
        No banked moments yet. Moments are mined automatically when an interview completes.
      </p>
    )
  }

  const exemplars = moments.filter((m) => m.is_exemplar && m.status === 'banked').length
  return (
    <div>
      <p className="text-2xs text-muted-foreground pb-1">
        {moments.length} banked · {exemplars} usable (near-duplicates collapse to their strongest version)
      </p>
      <ul className="divide-y">
        {moments.map((m) => <MomentRow key={m.id} moment={m} />)}
      </ul>
    </div>
  )
}
