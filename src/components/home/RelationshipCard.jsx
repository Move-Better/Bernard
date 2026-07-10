import { Link } from 'react-router-dom'
import { PenLine, ChevronRight } from 'lucide-react'
import { useRelationshipCard } from '@/lib/queries'

// F18 (written interim) — "What I noticed about you". Bernard quietly tracks
// how each clinician's interviews evolve (register, angles covered) via
// staff.interview_style_memory; this card is the disclosure of that, paired
// with a receipt of what got shipped for them this week. Personal to the
// logged-in user (their own staff row), not a team aggregate.
//
// Placement: directly under the attention strip, above "Your posts are live"
// — acknowledgment, then receipt, then celebration. Renders nothing when the
// user has no interview history yet (available: false) — never a fabricated
// "I noticed..." for someone Bernard hasn't talked to.

function registerLine(ceiling) {
  if (ceiling === 'peer') {
    return "Since we started, you've climbed to peer-level register — I open technical with you now instead of warming up."
  }
  if (ceiling === 'mid') {
    return "We've built a good rhythm together across our calls."
  }
  return null
}

export default function RelationshipCard() {
  const { data, isLoading } = useRelationshipCard()

  if (isLoading || !data?.available) return null

  const { sessionCount, registerCeiling, recentAngles, shippedThisWeek } = data
  const regLine = registerLine(registerCeiling)
  const hasAngles = recentAngles?.length > 0

  return (
    <div className="rounded-2xl overflow-hidden border border-primary/20 bg-gradient-to-b from-primary/5 to-card shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_28px_-20px_hsl(var(--primary)/0.35)]">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        <span className="h-6 w-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-extrabold tracking-tight text-primary flex-1">What I noticed about you</h2>
        <span className="text-2xs font-bold uppercase tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded-full">
          This week
        </span>
      </div>

      <div className="px-4 pb-3.5">
        {(regLine || hasAngles) && (
          <p className="text-sm leading-relaxed text-foreground mb-3">
            {regLine}
            {regLine && hasAngles && ' '}
            {hasAngles && (
              <>
                This week I asked about <b className="font-semibold text-primary">{recentAngles.length} new {recentAngles.length === 1 ? 'angle' : 'angles'}</b>: {recentAngles.join(', ')}.
              </>
            )}
          </p>
        )}

        <div className="flex flex-wrap gap-2 mb-3">
          <div className="flex items-baseline gap-1.5 bg-card border border-primary/15 rounded-lg px-2.5 py-1.5">
            <span className="text-sm font-extrabold text-primary tabular-nums">{sessionCount}</span>
            <span className="text-2xs font-semibold text-muted-foreground">{sessionCount === 1 ? 'call so far' : 'calls so far'}</span>
          </div>
          {hasAngles && (
            <div className="flex items-baseline gap-1.5 bg-card border border-primary/15 rounded-lg px-2.5 py-1.5">
              <span className="text-sm font-extrabold text-primary tabular-nums">{recentAngles.length}</span>
              <span className="text-2xs font-semibold text-muted-foreground">new {recentAngles.length === 1 ? 'angle' : 'angles'} this week</span>
            </div>
          )}
          <div className="flex items-baseline gap-1.5 bg-card border border-primary/15 rounded-lg px-2.5 py-1.5">
            <span className="text-sm font-extrabold text-primary tabular-nums">{shippedThisWeek}</span>
            <span className="text-2xs font-semibold text-muted-foreground">{shippedThisWeek === 1 ? 'piece shipped for you' : 'pieces shipped for you'}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-primary/10">
          <span className="text-2xs text-muted-foreground">Based on your last {Math.min(sessionCount, 3)} {sessionCount === 1 ? 'interview' : 'interviews'}</span>
          <Link to="/stories" className="text-xs font-semibold text-primary inline-flex items-center gap-0.5 hover:text-primary/80 transition-colors">
            See what shipped <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  )
}
