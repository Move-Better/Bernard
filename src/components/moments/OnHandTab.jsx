import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, MoreHorizontal, Search, PlayCircle, Quote, Check, Archive, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { useAppMutation } from '@/lib/useAppMutation'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import ErrorState from '@/components/ErrorState'

// Display labels for the scoreMoments.js taxonomy. Local mirror — the api/
// module can't be imported across the client/server boundary (same note as
// MomentsPanel.jsx).
const MOMENT_TYPE_LABELS = {
  coaching_cue: 'Coaching cue',
  patient_breakthrough: 'Patient breakthrough',
  hook: 'Hook',
  credibility: 'Credibility',
  insight: 'Insight',
  technique: 'Technique',
  story: 'Story',
}

const SORTS = [
  { key: 'strongest', label: 'Strongest first' },
  { key: 'newest', label: 'Newest first' },
  { key: 'most_used', label: 'Most used' },
]

const REVIEW_FILTERS = [
  { key: 'all', label: 'All moments' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'unreviewed', label: 'Not reviewed' },
]

// How many cards the queue shows at once. Three is enough to compare and build
// a rhythm without turning the screen into a wall of quotes.
const QUEUE_SIZE = 3

function scoreTone(score) {
  if (score >= 80) return 'bg-primary/10 text-primary'
  if (score >= 60) return 'text-foreground/70 bg-muted'
  return 'bg-muted text-muted-foreground'
}

function fmtDay(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function isPending(m) {
  return m.status === 'banked' && !m.reviewed_at
}

function RowMenu({ m, onRetire, onRestore }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const item =
    'w-full text-left px-3 py-1.5 rounded-md text-sm hover:bg-muted transition-colors'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Moment actions"
          className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1.5">
        <button type="button" className={item} onClick={() => { setOpen(false); navigate(`/stories/${m.interview_id}`) }}>
          Open story
        </button>
        {m.clip_asset_id && (
          <button type="button" className={item} onClick={() => { setOpen(false); navigate(`/moments/clip/${m.clip_asset_id}`) }}>
            Open clip
          </button>
        )}
        {m.status === 'retired' ? (
          <button type="button" className={item} onClick={() => { setOpen(false); onRestore(m) }}>
            Restore
          </button>
        ) : (
          <button
            type="button"
            className={`${item} text-muted-foreground`}
            onClick={() => { setOpen(false); onRetire(m) }}
          >
            Retire
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

// The shared provenance line under a quote — type, topic, source story, staff,
// usage. Identical in the queue card and the browse row so a moment reads the
// same wherever you meet it.
function MomentMeta({ m, staffName, children }) {
  const typeLabel = MOMENT_TYPE_LABELS[m.moment_type] || m.moment_type || 'Moment'
  const interviewLabel = m.interview?.topic || 'Untitled story'
  const interviewDay = fmtDay(m.interview?.created_at)
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
      <span className="font-semibold text-foreground/60">{typeLabel}</span>
      {m.topic && <span>· {m.topic}</span>}
      <span>
        · from{' '}
        <Link to={`/stories/${m.interview_id}`} className="font-medium text-primary hover:underline">
          {interviewLabel}
        </Link>
        {interviewDay && <> · {interviewDay}</>}
      </span>
      {staffName && <span>· {staffName}</span>}
      {m.usage_count > 0 && (
        <span>
          · used ×{m.usage_count}
          {m.last_used_at && <> · last {fmtDay(m.last_used_at)}</>}
        </span>
      )}
      {m.clip_asset_id && (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-3xs font-bold text-primary bg-primary/10">
          <PlayCircle className="h-3 w-3" />clip attached
        </span>
      )}
      {children}
    </div>
  )
}

// "Reviewed by Zach Cullen · Jul 30". reviewed_by holds a Clerk user id, so the
// name comes from the staff row that claimed that id — same resolution as
// AssetsPane's approver display. Falls back to the raw id rather than hiding
// the stamp, so an unclaimed reviewer is visible instead of silently anonymous.
function ReviewStamp({ m, reviewerName, tone = 'reviewed' }) {
  if (!m.reviewed_at) return null
  const who = reviewerName || m.reviewed_by
  const when = new Date(m.reviewed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const label = tone === 'retired' ? 'Retired' : 'Reviewed'
  const classes = tone === 'retired'
    ? 'bg-destructive/10 text-destructive'
    : 'bg-success/10 text-success'
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-3xs font-bold ${classes}`}>
      {tone === 'retired' ? <Archive className="h-3 w-3" /> : <Check className="h-3 w-3" />}
      {label}{who ? ` by ${who}` : ''} · {when}
    </span>
  )
}

/**
 * One card in the approval queue. The quote leads at readable size — a verdict
 * on a moment is a judgment about the words, so the words get the room.
 * Approve is green and Retire is red on purpose: the brand teal reads as
 * navigation everywhere else in the app, so a teal button here wouldn't read as
 * a decision.
 */
function QueueCard({ m, staffName, isTop, onApprove, onRetire, onSkip, busy }) {
  return (
    <article className="rounded-xl border border-border bg-card shadow-sm p-4 flex gap-3.5">
      <span
        className={`shrink-0 self-start inline-flex items-center justify-center min-w-[34px] rounded-md px-1.5 py-1 text-sm font-bold tabular-nums ${scoreTone(m.score ?? 0)}`}
        title="Post-worthiness score at extraction (0–100)"
      >
        {m.score ?? '—'}
      </span>
      <div className="min-w-0 flex-1">
        <blockquote className="text-base leading-relaxed text-foreground max-w-[66ch]">
          &ldquo;{m.excerpt}&rdquo;
        </blockquote>
        <div className="mt-2.5">
          <MomentMeta m={m} staffName={staffName} />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3.5">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => onApprove(m)}
            className="bg-success text-white hover:bg-success/90"
          >
            <Check className="h-4 w-4" />Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onRetire(m)}
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Archive className="h-4 w-4" />Retire
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSkip(m)} className="text-muted-foreground">
            Skip for now
          </Button>
          {isTop && (
            <span className="hidden sm:flex items-center gap-1 ml-auto text-3xs text-muted-foreground">
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-bold">A</kbd>
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-bold">R</kbd>
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-bold">S</kbd>
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

function MomentRow({ m, staffName, reviewerName, onRetire, onRestore }) {
  const retired = m.status === 'retired'
  return (
    <div className="flex items-start gap-3 py-3.5 border-t border-border first:border-t-0">
      <span
        className={`shrink-0 inline-flex items-center justify-center min-w-[30px] rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${scoreTone(m.score ?? 0)}`}
        title="Post-worthiness score at extraction (0–100)"
      >
        {m.score ?? '—'}
      </span>
      <div className="min-w-0 flex-1">
        <blockquote className={`text-sm leading-relaxed ${retired ? 'text-muted-foreground' : 'text-foreground/90'}`}>
          &ldquo;{m.excerpt}&rdquo;
        </blockquote>
        <div className="mt-1">
          <MomentMeta m={m} staffName={staffName}>
            <ReviewStamp m={m} reviewerName={reviewerName} tone={retired ? 'retired' : 'reviewed'} />
            {retired && !m.reviewed_at && (
              <span className="uppercase tracking-wide font-bold text-3xs rounded px-1.5 py-0.5 bg-destructive/10 text-destructive">
                Retired
              </span>
            )}
            {!retired && !m.reviewed_at && (
              <span className="uppercase tracking-wide font-bold text-3xs rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
                Not reviewed
              </span>
            )}
          </MomentMeta>
        </div>
      </div>
      <RowMenu m={m} onRetire={onRetire} onRestore={onRestore} />
    </div>
  )
}

/**
 * The /moments "On hand" tab. Two modes over one dataset:
 *
 *   queue  — the default. Up to three unreviewed banked moments as cards, each
 *            with an explicit Approve / Retire verdict. Clearing one refills
 *            from the queue, so the pile visibly shrinks.
 *   browse — the full searchable inventory (the pre-2026-07-30 list, unchanged
 *            plus a review filter and the reviewed-by stamp).
 *
 * Approving is a REVIEW MARKER, not a gate: the planner already draws from
 * every banked moment and still does. What the queue buys is that the bank
 * actually gets looked at, and that weak material gets retired instead of
 * sitting there forever.
 *
 * Data comes from the page-level bank query so the header stats and the tab
 * count stay one fetch.
 */
export default function OnHandTab({ moments, isLoading, error, refetch, staffMap, staffByUserId = {} }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState('queue')          // 'queue' | 'browse'
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [staffId, setStaffId] = useState('all')
  const [reviewState, setReviewState] = useState('all')
  const [sort, setSort] = useState('strongest')
  const [retireTarget, setRetireTarget] = useState(null)
  // Session-local: "skip for now" pushes a moment to the back of the queue
  // rather than recording a verdict, so it deliberately does not persist —
  // a reload brings skipped moments back for another look.
  const [skipped, setSkipped] = useState([])

  const staffOptions = useMemo(() => {
    const ids = [...new Set((moments || []).map((m) => m.staff_id).filter(Boolean))]
    return ids
      .map((id) => ({ id, name: staffMap[id] }))
      .filter((s) => s.name)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [moments, staffMap])

  // The review queue: banked + unreviewed, strongest first, with anything
  // skipped this session moved to the back (never dropped).
  const pending = useMemo(() => {
    const list = (moments || []).filter(isPending)
    const rank = (m) => (skipped.includes(m.id) ? 1 : 0)
    return [...list].sort(
      (a, b) => rank(a) - rank(b) || (b.score || 0) - (a.score || 0),
    )
  }, [moments, skipped])

  const visible = useMemo(() => {
    let list = moments || []
    if (type !== 'all') list = list.filter((m) => m.moment_type === type)
    if (staffId !== 'all') list = list.filter((m) => m.staff_id === staffId)
    if (reviewState === 'reviewed') list = list.filter((m) => !!m.reviewed_at)
    else if (reviewState === 'unreviewed') list = list.filter((m) => !m.reviewed_at)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((m) =>
        [m.excerpt, m.hook, m.topic, m.interview?.topic]
          .some((t) => t && t.toLowerCase().includes(q)),
      )
    }
    const byInterviewDate = (m) => new Date(m.interview?.created_at || m.created_at || 0).getTime()
    list = [...list]
    if (sort === 'newest') list.sort((a, b) => byInterviewDate(b) - byInterviewDate(a))
    else if (sort === 'most_used') list.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0) || (b.score || 0) - (a.score || 0))
    else list.sort((a, b) => (b.score || 0) - (a.score || 0))
    return list
  }, [moments, type, staffId, reviewState, search, sort])

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['moment-bank'] })
    // The header stats (usable count, runway) come from the shared summary
    // endpoint — refresh it too so retire/restore moves the numbers live.
    queryClient.invalidateQueries({ queryKey: ['moments-summary'] })
  }, [queryClient])

  // One mutation for every verdict. `status` and `reviewed` are independent on
  // the wire: Approve sends {reviewed:true}, Retire sends both, Undo/Restore
  // sends {status:'banked'} and leaves the stamp alone.
  const patchMutation = useAppMutation({
    errorMessage: 'Could not update this moment',
    mutationFn: ({ id, ...body }) =>
      apiFetch(`/api/db/moments?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      invalidate()
      if (vars.silent) return
      if (vars.status === 'retired') {
        // No confirm dialog in the queue — a modal per rejection is what stops
        // a 100+ item queue from ever getting finished. Undo carries the safety
        // instead, and retire is reversible by design (planned pieces keep
        // their drafts either way).
        toast('Retired — Bernard won’t use this moment again.', {
          action: {
            label: 'Undo',
            onClick: () => patchMutation.mutate({ id: vars.id, status: 'banked', reviewed: false, silent: true }),
          },
        })
      } else if (vars.reviewed === true) {
        toast.success('Approved — staying on hand.')
      } else if (vars.status === 'banked') {
        toast('Restored — back on hand.')
      }
    },
  })

  const approve = useCallback((m) => patchMutation.mutate({ id: m.id, reviewed: true }), [patchMutation])
  const retireNow = useCallback((m) => patchMutation.mutate({ id: m.id, status: 'retired', reviewed: true }), [patchMutation])
  const skip = useCallback((m) => setSkipped((prev) => (prev.includes(m.id) ? prev : [...prev, m.id])), [])

  const queue = pending.slice(0, QUEUE_SIZE)
  const top = queue[0]

  // A / R / S act on the top card only — the queue is a stack, so there is
  // never ambiguity about which moment a keypress lands on. Ignored while a
  // field has focus or a modifier is held so it can't hijack real typing.
  useEffect(() => {
    if (mode !== 'queue' || !top) return
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target
      if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return
      const k = e.key.toLowerCase()
      if (k === 'a') { e.preventDefault(); approve(top) }
      else if (k === 'r') { e.preventDefault(); retireNow(top) }
      else if (k === 's') { e.preventDefault(); skip(top) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, top, approve, retireNow, skip])

  if (isLoading) {
    return (
      <div role="status" className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading moments…</span>
      </div>
    )
  }
  if (error) return <ErrorState message="Failed to load moments" onRetry={refetch} size="sm" />

  const all = moments || []
  const total = all.length
  const onHandCount = all.filter((m) => m.status === 'banked').length
  const retiredCount = all.filter((m) => m.status === 'retired').length
  const reviewedCount = onHandCount - pending.length
  const plannedN = retireTarget?.planned_count || 0
  const busy = patchMutation.isPending

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center rounded-xl border-2 border-dashed border-border">
        <Quote className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-semibold">Nothing on hand yet</p>
        <p className="text-xs text-muted-foreground max-w-sm">
          Capture a conversation and Bernard mines it into moments — verbatim
          excerpts your weekly content gets composed from.
        </p>
        <Button size="sm" variant="outline" onClick={() => navigate('/new')}>
          Capture a conversation
        </Button>
      </div>
    )
  }

  // ── Queue mode ────────────────────────────────────────────────────────────
  if (mode === 'queue') {
    const pct = onHandCount ? Math.round((reviewedCount / onHandCount) * 100) : 0
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div>
            <div className="text-sm font-bold">
              {pending.length > 0 ? 'Needs your review' : 'All caught up'}
            </div>
            <p className="text-2xs text-muted-foreground">
              {pending.length > 0
                ? `${pending.length} to go · strongest first`
                : `${reviewedCount} of ${onHandCount} reviewed`}
            </p>
          </div>
          <div className="grow" />
          {onHandCount > 0 && (
            <div
              className="hidden sm:block w-32 h-1.5 rounded-full bg-muted overflow-hidden"
              role="progressbar"
              aria-label="Moments reviewed"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
            </div>
          )}
          <Button size="sm" variant="outline" onClick={() => setMode('browse')}>
            Browse all {onHandCount}
          </Button>
        </div>

        {pending.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-2 text-center rounded-xl border-2 border-dashed border-border">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <p className="text-sm font-semibold">All caught up — {reviewedCount} reviewed</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              Bernard composes your week from what&rsquo;s on hand. New captures land
              here for review as they&rsquo;re mined.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-1">
              <Button size="sm" onClick={() => navigate('/new')}>Capture a conversation</Button>
              <Button size="sm" variant="outline" onClick={() => setMode('browse')}>
                Browse all {onHandCount}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {queue.map((m, i) => (
              <QueueCard
                key={m.id}
                m={m}
                staffName={staffMap[m.staff_id]}
                isTop={i === 0}
                busy={busy}
                onApprove={approve}
                onRetire={retireNow}
                onSkip={skip}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Browse mode ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <div className="text-sm font-bold">All moments</div>
          <p className="text-2xs text-muted-foreground">
            {onHandCount} on hand · {retiredCount} retired
          </p>
        </div>
        <div className="grow" />
        <Button size="sm" variant="outline" onClick={() => setMode('queue')}>
          ← Back to review{pending.length > 0 ? ` (${pending.length})` : ''}
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            aria-label="Search moments"
            placeholder="Search moments…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 rounded-lg border border-border bg-card text-sm w-full sm:w-56 outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-9 text-sm w-auto min-w-[110px]" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(MOMENT_TYPE_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {staffOptions.length > 0 && (
          <Select value={staffId} onValueChange={setStaffId}>
            <SelectTrigger className="h-9 text-sm w-auto min-w-[110px]" aria-label="Filter by staff">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All staff</SelectItem>
              {staffOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={reviewState} onValueChange={setReviewState}>
          <SelectTrigger className="h-9 text-sm w-auto min-w-[130px]" aria-label="Filter by review state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REVIEW_FILTERS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="h-9 text-sm w-auto min-w-[130px]" aria-label="Sort moments">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-center rounded-xl border-2 border-dashed border-border">
          <p className="text-sm font-semibold">No moments match</p>
          <p className="text-xs text-muted-foreground">Try a different search, type, staff member, or review state.</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {visible.map((m) => (
            <MomentRow
              key={m.id}
              m={m}
              staffName={staffMap[m.staff_id]}
              reviewerName={staffByUserId[m.reviewed_by]}
              onRetire={setRetireTarget}
              onRestore={(row) => patchMutation.mutate({ id: row.id, status: 'banked' })}
            />
          ))}
        </div>
      )}

      {/* Retiring from the browse list keeps its confirm dialog — it's a
          one-off action on a row you went looking for, not a queue verdict, so
          there's no rhythm for a modal to break. */}
      <ConfirmDialog
        open={!!retireTarget}
        onOpenChange={(open) => { if (!open) setRetireTarget(null) }}
        title="Retire this moment?"
        description={
          plannedN > 0
            ? `Stops future use — Bernard won't compose new pieces from it. ${plannedN} planned piece${plannedN === 1 ? '' : 's'} keep${plannedN === 1 ? 's' : ''} their drafts.`
            : 'Stops future use — Bernard won’t compose new pieces from it. No planned pieces are affected.'
        }
        confirmLabel="Retire"
        destructive={false}
        loading={busy}
        onConfirm={() => {
          if (!retireTarget) return
          patchMutation.mutate({ id: retireTarget.id, status: 'retired', reviewed: true })
          setRetireTarget(null)
        }}
      />
    </div>
  )
}
