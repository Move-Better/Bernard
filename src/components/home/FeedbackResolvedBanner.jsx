// Home-page notice for the reporter of an in-app Feedback submission once it's
// fixed. Some staff (e.g. front desk) deliberately stop using a feature the
// moment they hit a bug and wait to be told it's safe to come back — email is
// the primary notice (they may not be logged in for a while), this banner is
// the backup for whenever they do return. Self-dismissing per report.
//
// It used to render one fixed sentence — "Fixed: the issue you reported is
// resolved" — with the resolution note appended inline as muted text on the
// same line. Two things were wrong with that (Q, 2026-08-11):
//
//   1. It never said WHICH report. `message`, the reporter's own words, was
//      already being fetched by /api/feedback/my-notices and thrown away. To
//      someone who has filed half a dozen reports, a generic sentence is
//      indistinguishable from noise.
//   2. Real resolution notes run to several paragraphs of genuinely good plain
//      language, and a single-line flex row had nowhere to put them.
//
// So: their words first, verbatim; then what changed, clamped with a
// Show more; then a way back to the page they reported it from.

import { useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { useAppMutation } from '@/lib/useAppMutation'

/** Same-origin in-app path from a stored page_url, or null if it isn't one. */
export function inAppPath(pageUrl) {
  if (!pageUrl) return null
  try {
    const u = new URL(pageUrl, window.location.origin)
    if (u.origin !== window.location.origin) return null
    const path = `${u.pathname}${u.search}`
    // Linking "back" to the page they're already on is a dead control.
    if (path === '/' || path === window.location.pathname) return null
    return path
  } catch {
    return null
  }
}

function formatDay(iso) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return null
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function Notice({ notice, onDismiss, dismissing }) {
  const [expanded, setExpanded] = useState(false)
  const note = (notice.resolved_note || '').trim()
  const backTo = inAppPath(notice.page_url)
  const reported = formatDay(notice.created_at)
  const fixed = formatDay(notice.resolved_at)

  return (
    <div className="flex items-start gap-3 rounded-lg border border-success/30 border-l-4 border-l-success bg-success/[0.08] px-4 py-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-3xs font-bold uppercase tracking-wider text-success">
          Fixed — you reported
        </p>

        {notice.message && (
          <blockquote className="border-l-2 border-success/50 pl-3 text-sm italic text-foreground">
            {notice.message}
          </blockquote>
        )}

        {note && (
          <p className={`text-sm leading-relaxed text-foreground ${expanded ? '' : 'line-clamp-3'}`}>
            <span className="font-semibold">What changed. </span>
            {note}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
          {note && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="font-semibold text-primary hover:underline"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
          {note && (reported || fixed) && <span aria-hidden="true">·</span>}
          {reported && <span>Reported {reported}</span>}
          {reported && fixed && <span aria-hidden="true">·</span>}
          {fixed && <span>fixed {fixed}</span>}
          {backTo && (
            <>
              <span aria-hidden="true">·</span>
              <a href={backTo} className="font-semibold text-primary hover:underline">
                Take me back there
              </a>
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        disabled={dismissing}
        className="-mr-1 shrink-0 rounded p-1 text-muted-foreground transition hover:bg-black/5 hover:text-foreground disabled:opacity-50"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export default function FeedbackResolvedBanner() {
  const queryClient = useQueryClient()
  const [dismissing, setDismissing] = useState(null)

  const { data } = useQuery({
    queryKey: ['feedback-my-notices'],
    queryFn: () => apiFetch('/api/feedback/my-notices'),
    staleTime: 60 * 1000,
    retry: false,
  })

  const acknowledge = useAppMutation({
    mutationFn: (id) => apiFetch('/api/feedback/acknowledge', { method: 'PATCH', body: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feedback-my-notices'] }),
  })

  const notices = data?.notices || []
  if (!notices.length) return null

  const dismiss = (id) => {
    setDismissing(id)
    acknowledge.mutate(id, { onSettled: () => setDismissing(null) })
  }

  return (
    <div className="flex flex-col gap-2">
      {notices.map((n) => (
        <Notice
          key={n.id}
          notice={n}
          dismissing={dismissing === n.id}
          onDismiss={() => dismiss(n.id)}
        />
      ))}
    </div>
  )
}
