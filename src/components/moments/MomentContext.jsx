import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Loader2, ExternalLink } from 'lucide-react'
import { apiFetch } from '@/lib/api'

// Wrap the verbatim excerpt inside the anchored turn so the reviewer's eye
// lands on the exact words that were banked. Falls back to the whole turn when
// the excerpt can't be located verbatim (an edited excerpt, or an oversized
// turn that momentWindow center-sliced) — the turn's own highlight still marks
// where it came from, so a missing <mark> degrades quietly.
function markExcerpt(content, excerpt) {
  if (!excerpt) return content
  const idx = content.indexOf(excerpt)
  if (idx === -1) return content
  return (
    <>
      {content.slice(0, idx)}
      <mark className="rounded-sm bg-primary/15 px-0.5 text-inherit">{excerpt}</mark>
      {content.slice(idx + excerpt.length)}
    </>
  )
}

// One transcript turn in the context panel. role 'assistant' is the interviewer
// (muted — it's scaffolding for the answer), 'user' is the clinician (the words
// that matter). The anchored turn is the one the quote was pulled from.
function Turn({ turn, staffName, isAnchor, excerpt, anchorRef }) {
  const clinician = turn.role === 'user'
  const who = clinician ? (staffName || 'Clinician') : 'Interviewer'
  const body = isAnchor ? markExcerpt(turn.content, excerpt) : turn.content

  if (isAnchor) {
    return (
      <div
        ref={anchorRef}
        className="my-1.5 -mx-3 border-l-2 border-primary bg-primary/10 px-3 py-2"
      >
        <div className="mb-1 flex items-center gap-2 text-3xs font-bold uppercase tracking-wide text-primary">
          {who}
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-3xs font-bold text-primary-foreground">
            Quoted here
          </span>
        </div>
        <p className="text-sm leading-relaxed text-foreground">{body}</p>
      </div>
    )
  }

  return (
    <div className="border-t border-border/60 py-2 first:border-t-0">
      <div className={`mb-0.5 text-3xs font-bold uppercase tracking-wide ${clinician ? 'text-primary' : 'text-muted-foreground'}`}>
        {who}
      </div>
      <p className={`text-sm leading-relaxed ${clinician ? 'text-foreground' : 'text-muted-foreground'}`}>{body}</p>
    </div>
  )
}

/**
 * Inline "Show context" disclosure for a banked moment under review. Expands to
 * the surrounding interview turns — the question that prompted the quote and the
 * turns around it — with the quoted turn highlighted, so a reviewer can judge a
 * quote in context without leaving the queue. The full story stays one click
 * away (the header link + the moment's own title link).
 *
 * The transcript window is fetched lazily (only on first expand) from
 * GET /api/moments/context, which runs the same momentWindow() a draft is cut
 * from. A window doesn't change, so it's cached for the session.
 *
 * Rendered as a child of MomentMeta: the trigger sits inline on the provenance
 * line, and the panel is w-full so it wraps to its own row below the meta.
 */
export default function MomentContext({ m, staffName }) {
  const [open, setOpen] = useState(false)
  const scrollRef = useRef(null)
  const anchorRef = useRef(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['moment-context', m.id],
    queryFn: () => apiFetch(`/api/moments/context?id=${encodeURIComponent(m.id)}`),
    enabled: open,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const turns = useMemo(() => (Array.isArray(data?.turns) ? data.turns : []), [data])
  const anchorIndex = data?.anchorIndex ?? -1
  const unavailable = !!data && (turns.length === 0 || anchorIndex < 0)

  // Center the quoted turn in the panel so the turn that prompted it (usually
  // the interviewer's question) reads directly above it and the response flow
  // reads below — the context that makes a bare quote make sense. Scrolls only
  // the panel, never the page (scrollIntoView would); offsetTop is relative to
  // the scroll container.
  useEffect(() => {
    if (!open || !data || !scrollRef.current || !anchorRef.current) return
    const c = scrollRef.current
    const a = anchorRef.current
    c.scrollTop = Math.max(0, a.offsetTop - (c.clientHeight - a.clientHeight) / 2)
  }, [open, data])

  const storyHref = `/stories/${m.interview_id}`

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-2xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {open ? 'Hide context' : 'Show context'}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 w-full overflow-hidden rounded-lg border border-border bg-muted/50">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="text-3xs font-bold uppercase tracking-wide text-muted-foreground">
              Where this came from{data?.topic ? ` · ${data.topic}` : ''}
            </span>
            <Link
              to={storyHref}
              className="inline-flex shrink-0 items-center gap-1 text-2xs font-semibold text-primary hover:underline"
            >
              Open full story <ExternalLink className="h-3 w-3" />
            </Link>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-2xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading context…
            </div>
          ) : isError ? (
            <p className="px-3 py-4 text-2xs text-muted-foreground">
              Couldn&rsquo;t load the surrounding conversation. Open the full story above to read it.
            </p>
          ) : unavailable ? (
            <p className="px-3 py-4 text-2xs text-muted-foreground">
              Inline context isn&rsquo;t available for this quote. Open the full story above to read it.
            </p>
          ) : (
            <div ref={scrollRef} className="relative max-h-72 overflow-y-auto px-3 py-2">
              {turns.map((turn, i) => (
                <Turn
                  key={i}
                  turn={turn}
                  staffName={staffName}
                  isAnchor={i === anchorIndex}
                  excerpt={data?.excerpt}
                  anchorRef={i === anchorIndex ? anchorRef : null}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
