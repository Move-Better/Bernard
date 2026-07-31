import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, MoreHorizontal, Search, PlayCircle, Quote, Check, Archive, CheckCircle2, Pencil, X, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import RatingBadge from '@/components/ui/RatingBadge'
import { useAppMutation } from '@/lib/useAppMutation'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import ErrorState from '@/components/ErrorState'
import MomentRetireReasons from '@/components/moments/MomentRetireReasons'
import { MOMENT_RETIRE_REASON_LABEL } from '@/lib/momentRetire'
import { MOMENT_SEND_BACK_NOTE_MAX, MOMENT_SEND_BACK_PLACEHOLDER } from '@/lib/momentSendBack'

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

function fmtDay(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// The producer's queue. sent_back_at is excluded so a quote waiting on its
// author doesn't keep resurfacing to the one person who already said they
// can't fix it — it returns here automatically once the author resolves it.
function isPending(m) {
  return m.status === 'banked' && !m.reviewed_at && !m.sent_back_at
}

// The author's queue: quotes sent back to THEM, still awaiting a repair.
function isSentBackTo(m, staffId) {
  return Boolean(staffId) && m.staff_id === staffId && m.status === 'banked' && Boolean(m.sent_back_at)
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
 *
 * Retire and Send back each open a small popover (mirroring ModelPostRating's
 * "what made this land" flow, for the opposite verdicts) rather than firing
 * instantly — a reject is worth a beat to say why, and a send-back is useless
 * to the author without a note saying what looked wrong.
 */
/**
 * The quote itself, with an inline Edit affordance. Shared by the producer's
 * queue card and the author's fix card so a repair reads and behaves the same
 * wherever it happens.
 *
 * Editing swaps the whole action row (passed as children) for Save/Cancel:
 * mid-edit is not a moment to also be offering Approve or Retire, and a verdict
 * fired against half-rewritten text would stamp the wrong words.
 *
 * The excerpt is transcript-derived, and ASR reliably mangles clinical speech —
 * clauses run together, terms come out wrong. Editing is for repairing THAT,
 * which is why it sits next to the verdicts rather than behind a menu.
 */
function MomentExcerpt({ m, onSave, disabled, children }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.excerpt)
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setDraft(m.excerpt)
    setEditing(true)
  }
  function cancelEdit() {
    setEditing(false)
    setDraft(m.excerpt)
  }
  async function save() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === m.excerpt) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(m, trimmed)
      setEditing(false)
    } catch {
      // useAppMutation already raised the error toast. Staying in edit mode is
      // deliberate — dropping back to the read view would discard a rewrite the
      // person just typed.
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <>
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={4000}
          rows={6}
          className="text-base leading-relaxed max-w-[66ch]"
        />
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Button size="sm" disabled={saving || !draft.trim()} onClick={save}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save quote
          </Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={cancelEdit} className="text-muted-foreground">
            <X className="h-4 w-4" />Cancel
          </Button>
          <span className="text-2xs text-muted-foreground">
            Tidy up how it reads — keep what they actually meant.
          </span>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="flex items-start gap-2">
        <blockquote className="text-base leading-relaxed text-foreground max-w-[66ch] flex-1">
          &ldquo;{m.excerpt}&rdquo;
        </blockquote>
        <button
          type="button"
          onClick={startEdit}
          disabled={disabled}
          aria-label="Edit this quote"
          className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </>
  )
}

function QueueCard({ m, staffName, onApprove, onRetire, onSkip, onSaveExcerpt, onSendBack, busy }) {
  const [retireOpen, setRetireOpen] = useState(false)
  const [reasons, setReasons] = useState([])
  const [note, setNote] = useState('')
  const [sendBackOpen, setSendBackOpen] = useState(false)
  const [sendBackNote, setSendBackNote] = useState('')
  const toggleReason = (key) =>
    setReasons((prev) => (prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key]))
  const confirmRetire = () => {
    onRetire(m, { reasons, note })
    setRetireOpen(false)
  }
  const confirmSendBack = () => {
    onSendBack(m, sendBackNote)
    setSendBackOpen(false)
  }
  const authorLabel = staffName || 'the author'
  return (
    <article className="rounded-xl border border-border bg-card shadow-sm p-4 flex gap-3.5">
      <RatingBadge score={m.score} signal="quote" size="md" />
      <div className="min-w-0 flex-1">
        <MomentExcerpt m={m} onSave={onSaveExcerpt} disabled={busy}>
          <div className="mt-2.5">
            <MomentMeta m={m} staffName={staffName} />
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3.5">
            <Button
              variant="success"
              size="sm"
              disabled={busy}
              onClick={() => onApprove(m)}
            >
              <Check className="h-4 w-4" />Approve
            </Button>
            <Popover
              open={retireOpen}
              onOpenChange={(o) => { setRetireOpen(o); if (!o) { setReasons([]); setNote('') } }}
            >
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Archive className="h-4 w-4" />Retire
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 space-y-3">
                <p className="text-sm font-semibold text-foreground">Why doesn&rsquo;t this one work?</p>
                <MomentRetireReasons reasons={reasons} onToggleReason={toggleReason} note={note} onNoteChange={setNote} />
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={confirmRetire}
                  className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  <Archive className="h-4 w-4" />Retire
                </Button>
              </PopoverContent>
            </Popover>
            <Popover
              open={sendBackOpen}
              onOpenChange={(o) => { setSendBackOpen(o); if (!o) setSendBackNote('') }}
            >
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy}>
                  <Undo2 className="h-4 w-4" />Send back
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Send back to {authorLabel}</p>
                  <p className="mt-1 text-2xs text-muted-foreground">
                    Use this when the words are garbled and only they can say what they meant.
                    Bernard won&rsquo;t write from it until they fix it.
                  </p>
                </div>
                <Textarea
                  value={sendBackNote}
                  onChange={(e) => setSendBackNote(e.target.value)}
                  maxLength={MOMENT_SEND_BACK_NOTE_MAX}
                  rows={3}
                  placeholder={MOMENT_SEND_BACK_PLACEHOLDER}
                  className="text-sm"
                />
                <Button size="sm" disabled={busy} onClick={confirmSendBack} className="w-full">
                  <Undo2 className="h-4 w-4" />Send back
                </Button>
              </PopoverContent>
            </Popover>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSkip(m)} className="text-muted-foreground">
              Skip for now
            </Button>
          </div>
        </MomentExcerpt>
      </div>
    </article>
  )
}

// "Why: doesn't land, not social — reads flat on Reels." The reject reason —
// visible so a human scanning retired moments can see the pattern, not just
// that a verdict happened.
function RetireReasonLine({ m }) {
  const reasons = Array.isArray(m.retire_reasons) ? m.retire_reasons : []
  if (!reasons.length && !m.retire_note) return null
  const labels = reasons.map((r) => MOMENT_RETIRE_REASON_LABEL[r] || r).join(', ')
  return (
    <p className="mt-1 text-2xs text-muted-foreground">
      Why: {[labels, m.retire_note].filter(Boolean).join(' — ')}
    </p>
  )
}

/**
 * The author's side of a send-back: one of YOUR quotes that a producer flagged
 * as garbled. Only two ways out, both one click from here — repair the words,
 * or say it already reads right. Either resolves the flag and hands the moment
 * back to the producer's queue for the actual verdict.
 *
 * The producer's note leads the card. Without it this is just "something's
 * wrong with a thing you said months ago", which is not enough to act on.
 */
function AuthorFixCard({ m, senderName, onSaveExcerpt, onConfirmFine, busy }) {
  return (
    <article className="rounded-xl border border-action/40 bg-action/5 shadow-sm p-4 flex gap-3.5">
      <span
        className="shrink-0 self-start inline-flex items-center justify-center rounded-md px-1.5 py-1 bg-action/15 text-action"
        title="Sent back for your fix"
      >
        <Undo2 className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-2xs font-bold uppercase tracking-wide text-action">
          {senderName ? `${senderName} sent this back` : 'Sent back for your fix'}
          {m.sent_back_at && <> · {fmtDay(m.sent_back_at)}</>}
        </p>
        {m.sent_back_note && (
          <p className="mt-1 mb-2.5 text-sm text-foreground/80">&ldquo;{m.sent_back_note}&rdquo;</p>
        )}
        <MomentExcerpt m={m} onSave={onSaveExcerpt} disabled={busy}>
          <div className="mt-2.5">
            <MomentMeta m={m} />
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3.5">
            <span className="text-2xs text-muted-foreground">
              Fix the wording with the pencil, or:
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onConfirmFine(m)}>
              <Check className="h-4 w-4" />It already reads right
            </Button>
          </div>
        </MomentExcerpt>
      </div>
    </article>
  )
}

function MomentRow({ m, staffName, reviewerName, onRetire, onRestore }) {
  const retired = m.status === 'retired'
  return (
    <div className="flex items-start gap-3 py-3.5 border-t border-border first:border-t-0">
      <RatingBadge score={m.score} signal="quote" size="sm" />
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
          {retired && <RetireReasonLine m={m} />}
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
export default function OnHandTab({ moments, isLoading, error, refetch, staffMap, staffByUserId = {}, myStaffId = null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState('queue')          // 'queue' | 'browse'
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [staffId, setStaffId] = useState('all')
  const [reviewState, setReviewState] = useState('all')
  const [sort, setSort] = useState('strongest')
  const [retireTarget, setRetireTarget] = useState(null)
  const [retireReasons, setRetireReasons] = useState([])
  const [retireNote, setRetireNote] = useState('')
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

  // Quotes a producer sent back to THIS signed-in person. Oldest first: a
  // repair request that has been waiting two weeks is the one to answer.
  const myFixes = useMemo(() => {
    if (!myStaffId) return []
    return (moments || [])
      .filter((m) => isSentBackTo(m, myStaffId))
      .sort((a, b) => new Date(a.sent_back_at) - new Date(b.sent_back_at))
  }, [moments, myStaffId])

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
      } else if (vars.excerpt !== undefined) {
        toast.success('Quote updated.')
      } else if (vars.sentBack === true) {
        toast('Sent back — Bernard won’t use it until it’s fixed.', {
          action: {
            label: 'Undo',
            onClick: () => patchMutation.mutate({ id: vars.id, sentBack: false, silent: true }),
          },
        })
      } else if (vars.sentBack === false) {
        toast.success('Thanks — it’s back in the review queue.')
      }
    },
  })

  const approve = useCallback((m) => patchMutation.mutate({ id: m.id, reviewed: true }), [patchMutation])
  // reasons/note are optional — the queue card's Retire button goes through
  // a reason popover first and passes what was picked; other callers (Undo,
  // row-menu retire) can omit the second arg for an instant retire.
  const retireNow = useCallback(
    (m, { reasons = [], note = '' } = {}) =>
      patchMutation.mutate({
        id: m.id,
        status: 'retired',
        reviewed: true,
        retireReasons: reasons.length ? reasons : undefined,
        retireNote: note.trim() || undefined,
      }),
    [patchMutation],
  )
  const skip = useCallback((m) => setSkipped((prev) => (prev.includes(m.id) ? prev : [...prev, m.id])), [])
  // mutateAsync, not mutate: MomentExcerpt awaits this to decide whether to
  // leave edit mode, so a failed save has to reject rather than resolve.
  const saveExcerpt = useCallback(
    (m, excerpt) => patchMutation.mutateAsync({ id: m.id, excerpt }),
    [patchMutation],
  )
  const sendBack = useCallback(
    (m, note = '') => patchMutation.mutate({ id: m.id, sentBack: true, sentBackNote: note.trim() || undefined }),
    [patchMutation],
  )
  const confirmFine = useCallback((m) => patchMutation.mutate({ id: m.id, sentBack: false }), [patchMutation])

  const queue = pending.slice(0, QUEUE_SIZE)

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

        {/* Your own quotes a producer couldn't fix. Above the review queue on
            purpose: nobody else can unblock these, and each one is currently
            held out of drafting. */}
        {myFixes.length > 0 && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-sm font-bold">
                {myFixes.length === 1 ? 'One of your quotes needs a fix' : `${myFixes.length} of your quotes need a fix`}
              </div>
              <p className="text-2xs text-muted-foreground">
                Sent back because the wording came out garbled — only you know what you meant.
                Bernard won&rsquo;t write from {myFixes.length === 1 ? 'it' : 'them'} until fixed.
              </p>
            </div>
            {myFixes.map((m) => (
              <AuthorFixCard
                key={m.id}
                m={m}
                senderName={staffByUserId[m.sent_back_by]}
                busy={busy}
                onSaveExcerpt={saveExcerpt}
                onConfirmFine={confirmFine}
              />
            ))}
          </div>
        )}

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
            {queue.map((m) => (
              <QueueCard
                key={m.id}
                m={m}
                staffName={staffMap[m.staff_id]}
                busy={busy}
                onApprove={approve}
                onRetire={retireNow}
                onSkip={skip}
                onSaveExcerpt={saveExcerpt}
                onSendBack={sendBack}
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
        onOpenChange={(open) => { if (!open) { setRetireTarget(null); setRetireReasons([]); setRetireNote('') } }}
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
          patchMutation.mutate({
            id: retireTarget.id,
            status: 'retired',
            reviewed: true,
            retireReasons: retireReasons.length ? retireReasons : undefined,
            retireNote: retireNote.trim() || undefined,
          })
          setRetireTarget(null)
          setRetireReasons([])
          setRetireNote('')
        }}
      >
        <MomentRetireReasons
          reasons={retireReasons}
          onToggleReason={(key) =>
            setRetireReasons((prev) => (prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key]))
          }
          note={retireNote}
          onNoteChange={setRetireNote}
        />
      </ConfirmDialog>
    </div>
  )
}
