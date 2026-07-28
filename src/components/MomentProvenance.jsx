// MomentProvenance — the "From your words" verbatim block (Moments IA ①,
// .claude/moment-ia-build-plan.md / mockup §02). Rendered everywhere a piece is
// reviewed: the /week day card, the publish editors' approval rail, and the
// clinician review slice. A piece whose atom has no moment renders nothing —
// legacy pieces stay clean.
//
// `moment` is the shared API shape: { excerpt, score, interviewTopic, interviewDate }.
export default function MomentProvenance({ moment, compact = false, className = '' }) {
  if (!moment?.excerpt) return null
  const date = moment.interviewDate
    ? new Date(moment.interviewDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null
  const metaLine = [moment.interviewTopic, date, 'faithfulness checked against this exact passage']
    .filter(Boolean)
    .join(' · ')
  return (
    <div className={`rounded-r-lg border-l-2 border-primary bg-primary/5 px-3 py-2 ${className}`}>
      <p className="text-3xs font-bold uppercase tracking-wider text-primary">
        From your words{Number.isFinite(moment.score) ? ` · scored ${moment.score}` : ''}
      </p>
      <q className={`mt-0.5 block text-xs leading-relaxed text-foreground/85 ${compact ? 'line-clamp-2' : 'line-clamp-6'}`}>
        {moment.excerpt}
      </q>
      {!compact && metaLine && <p className="mt-1 text-2xs text-muted-foreground">{metaLine}</p>}
    </div>
  )
}
