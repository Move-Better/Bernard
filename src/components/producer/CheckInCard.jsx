import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, ImageOff, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { stripStoryDatePrefix } from '@/lib/storyTitle'

// The periodic check-in (Phase 4, mockup-approved): "is Bernard still trending
// right?" — answered in the two halves Q asked for, numbers and taste.
//
// The mockup's stay-auto / go-manual decision is deliberately NOT here yet; see
// the note where it would go. Short version: nothing can graduate today, so the
// control would be a no-op, and a decorative button in a panel about TRUST is
// the worst possible place for one.
//
// Every number here is withheld rather than invented when the data can't carry
// it: a format with too few measurable posts shows its raw counts and no
// percentage, and posts bundle structurally cannot measure (IG carousels,
// stories) are reported as a separate "couldn't measure" line instead of being
// averaged in as zeros — which would make a measurement gap look like poor reach.

const FORMAT_LABEL = { post: 'Post', carousel: 'Carousel', reel: 'Reel', story: 'Story' }

function DeltaChip({ pct }) {
  if (pct == null) {
    return <span className="text-3xs text-muted-foreground">not enough yet</span>
  }
  const up = pct > 0
  const flat = pct === 0
  return (
    <span
      className={`text-2xs font-bold tabular-nums ${
        flat ? 'text-muted-foreground' : up ? 'text-success' : 'text-action'
      }`}
    >
      {up ? '+' : ''}{pct}%
    </span>
  )
}

function Sample({ s }) {
  return (
    <div className="shrink-0 w-[52px]">
      <div className="h-[66px] w-[52px] overflow-hidden rounded-md border border-border bg-muted">
        {s.thumbnailUrl
          ? <img src={s.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-4 w-4" aria-hidden="true" />
            </div>
          )}
      </div>
      <p className="mt-1 truncate text-3xs text-muted-foreground" title={stripStoryDatePrefix(s.topic)}>{stripStoryDatePrefix(s.topic) || '—'}</p>
    </div>
  )
}

export default function CheckInCard() {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  // Marking the check-in done is the ONLY write in this loop, and it is just a
  // timestamp — it clears the due checkpoint on ProducerHome. Deliberately NOT
  // a trust dial: nothing can graduate yet, so a stay-auto / go-manual control
  // would have nothing to control. It joins this call when graduation exists.
  async function markDone() {
    setSaving(true)
    try {
      await apiFetch('/api/producer/checkin-done', { method: 'POST' })
      setDone(true)
      // The checkpoint queue is what actually changes — refetch it so the item
      // disappears rather than lingering until the next page load.
      qc.invalidateQueries({ queryKey: ['producer-checkpoints'] })
      toast.success('Check-in noted', { description: 'Bernard will ask again in about a month.' })
    } catch {
      toast.error('Could not save the check-in')
    } finally {
      setSaving(false)
    }
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['producer-checkin'],
    queryFn: () => apiFetch('/api/producer/checkin'),
    staleTime: 10 * 60 * 1000,
  })

  // A failed read must not render as an empty card — an owner would read that
  // as "nothing published, nothing to review".
  if (isError) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Couldn’t load the check-in just now.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="h-3 w-40 rounded bg-muted animate-pulse" />
        <div className="h-2 w-3/4 rounded bg-muted animate-pulse" />
      </div>
    )
  }

  const formats = Array.isArray(data?.formats) ? data.formats : []
  const samples = Array.isArray(data?.samples) ? data.samples : []

  // Nothing published in the window is a real, common state for a clinic — say
  // so plainly rather than rendering an empty table that looks broken.
  if (!data?.published) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-baseline gap-2">
          <CalendarCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Check-in</h2>
        </div>
        <p className="mt-1 text-2xs text-muted-foreground">
          Nothing published in the last {data?.window?.days ?? 30} days — there’s nothing to review yet.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline gap-2">
        <CalendarCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Check-in</h2>
        <span className="ml-auto text-3xs text-muted-foreground">
          {data.published} posted · last {data.window?.days ?? 30} days
        </span>
      </div>

      {/* ── Numbers ─────────────────────────────────────────────────────── */}
      <p className="mt-3 text-3xs font-bold uppercase tracking-wide text-muted-foreground">Numbers</p>
      <div className="mt-1">
        {formats.map((f) => (
          <div key={f.format} className="flex items-baseline gap-3 border-b border-border py-1.5 last:border-b-0">
            <span className="text-xs font-medium w-20 shrink-0">{FORMAT_LABEL[f.format] || f.format}</span>
            <span className="text-2xs text-muted-foreground w-14 shrink-0 tabular-nums">
              {f.posts} post{f.posts === 1 ? '' : 's'}
            </span>
            <span className="text-2xs text-muted-foreground tabular-nums">
              {f.impressionsPerPost == null ? '—' : `${f.impressionsPerPost}/post`}
            </span>
            <span className="ml-auto"><DeltaChip pct={f.deltaPct} /></span>
          </div>
        ))}
      </div>
      {data.unmeasurable > 0 && (
        // Stated explicitly so the denominator is explainable. Without this the
        // per-post figure silently divides by fewer posts than the count shown.
        <p className="mt-1.5 text-3xs text-muted-foreground">
          {data.unmeasurable} couldn’t be measured — Instagram doesn’t report on carousels and stories.
        </p>
      )}

      {/* ── Taste ───────────────────────────────────────────────────────── */}
      <p className="mt-4 text-3xs font-bold uppercase tracking-wide text-muted-foreground">
        Do these still look like us?
      </p>
      <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
        {samples.map((s) => <Sample key={s.id} s={s} />)}
      </div>

      {/* ── The decision is NOT here yet, deliberately ───────────────────
          The mockup's stay-auto / go-manual pair is omitted until graduation
          exists. Two reasons, and the second is the real one:
            1. Nothing can graduate today — the learning endpoint pins
               graduatedWindows at 0 — so "go more manual" is already the state
               and the button would be a no-op.
            2. A control that silently does nothing is worse than no control,
               and worst of all in a panel about TRUST: it teaches the owner
               that Bernard's buttons are decorative. This session shipped six
               defects of exactly that shape; not adding a seventh on purpose.
          The numbers and the portfolio are useful on their own — this is a
          review surface today, and becomes a decision surface when there is a
          decision to make. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={markDone}
          disabled={saving || done}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          {done && <Check className="h-3 w-3" aria-hidden="true" />}
          {done ? 'Noted' : saving ? 'Saving…' : 'I’ve reviewed this'}
        </button>
        <span className="text-3xs text-muted-foreground">
          Clears this from your checkpoints until next month.
        </span>
      </div>
      <p className="mt-2 text-3xs leading-relaxed text-muted-foreground">
        Bernard still shows you every post before it goes out. When it has earned
        the right to stop asking about something, you’ll be able to decide that here.
      </p>
    </div>
  )
}
