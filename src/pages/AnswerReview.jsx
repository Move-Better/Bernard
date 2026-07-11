import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSmartBack } from '@/lib/useSmartBack'
import {
  MessagesSquare,
  Check,
  Pencil,
  RotateCcw,
  ChevronLeft,
  ShieldCheck,
  Lock,
  AlertTriangle,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useAppMutation } from '@/lib/useAppMutation.js'

// Markdown element styling (module scope — never define components inside render).
const MD_COMPONENTS = {
  h2: (props) => <h3 className="mt-4 mb-1.5 text-sm font-bold text-foreground" {...props} />,
  h3: (props) => <h4 className="mt-3 mb-1 text-sm font-semibold text-foreground" {...props} />,
  p: (props) => <p className="mb-2.5 text-sm leading-relaxed text-muted-foreground" {...props} />,
  strong: (props) => <strong className="font-semibold text-foreground" {...props} />,
  ul: (props) => <ul className="mb-2.5 list-disc pl-5 text-sm text-muted-foreground" {...props} />,
  li: (props) => <li className="mb-1" {...props} />,
}

// Row in the collapsed queue (module scope — never define components inside render).
function QueueRow({ answer, index, total, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left hover:border-primary/40 transition-colors"
    >
      {answer.condition && (
        <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-2xs font-bold text-primary">
          {answer.condition}
        </span>
      )}
      <span className="flex-1 truncate text-sm font-medium text-foreground">{answer.question}</span>
      {answer.status === 'changes_requested' && (
        <span className="shrink-0 rounded-full bg-action/15 px-2 py-0.5 text-3xs font-bold uppercase tracking-wide text-action">
          Revising
        </span>
      )}
      <span className="shrink-0 text-2xs text-muted-foreground">
        {index + 1} of {total}
      </span>
    </button>
  )
}

// --- Voice-fidelity gate (F16 Phase 1) -------------------------------------
// The gate lives in voice_audit.gate: 'passed' | 'held' | 'unscored'. A held
// answer can't publish until it's edited/revised back over the bar.
function voiceGate(a) {
  const va = a?.voice_audit
  return va && typeof va === 'object' ? va.gate || null : null
}
function voiceScore10(a) {
  return typeof a?.voice_fidelity_score === 'number' ? (a.voice_fidelity_score / 10).toFixed(1) : null
}

// Header chip — quiet emerald when it passes, red when held (severity ramp).
function VoiceCheckChip({ answer }) {
  const gate = voiceGate(answer)
  const s = voiceScore10(answer)
  if (gate === 'passed') {
    return (
      <span
        className="ml-auto inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-3xs font-bold text-success"
        title="Faithful to what you've said, in your voice, and non-diagnostic"
      >
        <ShieldCheck className="h-3 w-3" /> Voice check{s ? ` ${s}` : ''}
      </span>
    )
  }
  if (gate === 'held') {
    return (
      <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-3xs font-bold text-destructive">
        <AlertTriangle className="h-3 w-3" /> Voice check{s ? ` ${s}` : ''}
      </span>
    )
  }
  return null
}

// The loud, act-now banner shown above the actions when an answer is held.
function HeldBanner({ answer }) {
  const va = answer?.voice_audit || {}
  const s = voiceScore10(answer)
  const threshold = typeof va.threshold === 'number' ? va.threshold : 7.5
  const dims = [
    { label: 'Faithful to you', v: va.said_fidelity },
    { label: 'Sounds like you', v: va.voice_match },
    { label: 'Non-diagnostic & safe', v: va.safety },
  ].filter((d) => typeof d.v === 'number')
  return (
    <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wide text-destructive">
          <Lock className="h-3.5 w-3.5" /> Held — can&rsquo;t publish yet
        </span>
        <span className="ml-auto text-2xs font-bold tabular-nums text-destructive">
          {s ? `${s} / 10 · ` : ''}bar is {threshold}
        </span>
      </div>
      {va.red_flag && va.red_flag !== 'none' && (
        <p className="mt-2 text-2xs text-foreground">
          <span className="font-bold">What drifted:</span> {va.red_flag}
        </p>
      )}
      {dims.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {dims.map((d) => (
            <span key={d.label} className="inline-flex items-center gap-1 text-3xs font-bold text-muted-foreground">
              {d.label}
              <span className={d.v < threshold ? 'text-destructive' : 'text-success'}>{d.v}</span>
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-2xs text-muted-foreground">
        Fix it with <span className="font-semibold text-foreground">Edit inline</span>, or{' '}
        <span className="font-semibold text-foreground">Ask Bernard to revise</span> — it re-drafts in
        your voice and re-scores. Approve unlocks once it clears {threshold}.
      </p>
    </div>
  )
}

export default function AnswerReview() {
  // Reached from PipelineKanban, StoryDetail, Home, and MediaHub, so the
  // fallback (used only with no real history to go back to) can't be a
  // single hardcoded destination.
  const goBack = useSmartBack('/')
  // While Bernard is re-drafting a revise (status changes_requested), poll so the
  // updated answer appears when it flips back to needs_review. Hard-capped at 90s
  // so a silent generation failure can't spin forever.
  const pollStartRef = useRef(0)
  const queryClient = useQueryClient()
  const { data, isPending, refetch } = useQuery({
    queryKey: ['answers-review'],
    queryFn: () => apiFetch('/api/answers'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const rows = query.state.data?.answers || []
      const revising = rows.some((a) => a.status === 'changes_requested')
      if (!revising) {
        pollStartRef.current = 0
        return false
      }
      if (!pollStartRef.current) pollStartRef.current = Date.now()
      if (Date.now() - pollStartRef.current > 90_000) return false
      return 3000
    },
  })
  const answers = useMemo(() => data?.answers || [], [data])

  const [openId, setOpenId] = useState(null)
  const [mode, setMode] = useState(null) // 'edit' | 'revise' | null
  const [draft, setDraft] = useState({ question: '', answer_lead: '', body: '' })
  const [note, setNote] = useState('')

  // The expanded answer defaults to the first in the queue.
  const active = answers.find((a) => a.id === openId) || answers[0] || null

  // When the active answer changes (approve advances to the next one, or the
  // reviewer opens another from the queue), jump back to the top — otherwise a
  // new answer loads under the old scroll position and it's near-impossible to
  // tell anything happened.
  useEffect(() => {
    if (active?.id) window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [active?.id])

  const mutation = useAppMutation({
    mutationFn: (payload) =>
      apiFetch('/api/answers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: (res, payload) => {
      if (payload.action === 'approve') {
        if (res?.blocked) {
          // The hard voice gate refused to publish. Stay on this answer so its
          // held banner is visible; refetch() pulls the fresh score/flag in.
          toast.error(
            res.gate === 'unscored'
              ? "Couldn't check the voice on this one — try again in a moment"
              : 'Held — tighten it back to your voice before it can go public',
          )
        } else {
          toast.success(res?.status === 'published' ? 'Published to movebetter.co ✓' : 'Approved — ready to publish')
          // Approve moves the answer out of the review queue (approved/published),
          // so drop it from the cache immediately. Without this the screen only
          // advances once refetch() round-trips — which read as "nothing happened
          // after publish". setOpenId(null) lets `active` fall through to the next
          // queued answer instead of clinging to the now-gone id.
          queryClient.setQueryData(['answers-review'], (prev) =>
            prev?.answers ? { ...prev, answers: prev.answers.filter((a) => a.id !== payload.id) } : prev,
          )
          setOpenId(null)
        }
      } else if (payload.action === 'edit') toast.success('Your edits saved')
      else if (payload.action === 'revise') toast.success('Sent to Bernard — it will revise in your voice')
      setMode(null)
      setNote('')
      refetch()
    },
    onError: () => toast.error('Something went wrong — try again'),
  })

  function startEdit(a) {
    setDraft({ question: a.question || '', answer_lead: a.answer_lead || '', body: a.body || '' })
    setMode('edit')
  }

  const busy = mutation.isPending

  if (isPending) {
    return (
      <div className="py-6 pb-24">
        <div className="h-4 w-14 animate-pulse rounded bg-muted" />
        <div className="mt-3 flex items-center gap-3">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-5 w-48 animate-pulse rounded bg-muted" />
            <div className="h-4 w-72 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
          <div className="h-96 animate-pulse rounded-xl bg-muted" />
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    )
  }

  return (
    <div className="py-6 pb-24">
      <button
        type="button"
        onClick={goBack}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </button>

      <div className="mt-3 flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <MessagesSquare className="h-4.5 w-4.5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground">Answers to review</h1>
            {answers.length > 0 && (
              <span className="rounded-full bg-action/15 px-2.5 py-0.5 text-2xs font-bold text-action">
                {answers.length} waiting
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Drafted in your voice for the public answer library. Nothing is public until you approve it.
          </p>
        </div>
      </div>

      {answers.length === 0 ? (
        <div className="mt-10 rounded-xl border border-border bg-card px-6 py-12 text-center">
          <Check className="mx-auto h-8 w-8 text-success" />
          <p className="mt-3 text-base font-semibold text-foreground">You&rsquo;re all caught up</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No answers are waiting for your review right now.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
          {/* Expanded answer */}
          {active && (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                {active.condition && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-2xs font-bold text-primary">
                    {active.condition}
                  </span>
                )}
                <span className="text-2xs text-muted-foreground">for movebetter.co/answers</span>
                {active.status === 'changes_requested' && (
                  <span className="rounded-full bg-action/15 px-2 py-0.5 text-3xs font-bold uppercase tracking-wide text-action">
                    Revising
                  </span>
                )}
                <VoiceCheckChip answer={active} />
              </div>

              <div className="px-5 py-5">
                <h2 className="mb-3 text-lg font-bold text-foreground">{active.question}</h2>

                {mode === 'edit' ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">
                        Question
                      </label>
                      <input
                        value={draft.question}
                        onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">
                        The direct answer (the snippet AI cites)
                      </label>
                      <textarea
                        value={draft.answer_lead}
                        onChange={(e) => setDraft({ ...draft, answer_lead: e.target.value })}
                        rows={4}
                        className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed"
                      />
                    </div>
                    <div>
                      <label className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">
                        The full answer
                      </label>
                      <textarea
                        value={draft.body}
                        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                        rows={12}
                        className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-2xs leading-relaxed"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-sm leading-relaxed text-foreground">
                    <p className="mb-3 border-l-[3px] border-primary pl-3.5 font-medium">
                      {active.answer_lead}
                    </p>
                    <ReactMarkdown components={MD_COMPONENTS}>{active.body || ''}</ReactMarkdown>
                  </div>
                )}

                {active.grounding_source && mode !== 'edit' && (
                  <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-2xs text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
                    {active.grounding_source}
                  </div>
                )}

                {active.status === 'changes_requested' && active.review_notes && mode !== 'edit' && (
                  <div className="mt-3 rounded-lg border border-action/30 bg-action/5 px-3 py-2 text-2xs text-foreground">
                    <span className="font-bold text-action">You asked Bernard to revise:</span> {active.review_notes}
                  </div>
                )}

                {/* Actions */}
                {mode === 'edit' ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        mutation.mutate({
                          id: active.id,
                          action: 'edit',
                          question: draft.question,
                          answer_lead: draft.answer_lead,
                          body: draft.body,
                        })
                      }
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      Save my edits
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode(null)}
                      className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                ) : mode === 'revise' ? (
                  <div className="mt-4">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What should Bernard change? e.g. 'add a line about when an MRI matters'"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busy || !note.trim()}
                        onClick={() => mutation.mutate({ id: active.id, action: 'revise', note })}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        Send to Bernard
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode(null)}
                        className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {voiceGate(active) === 'held' && <HeldBanner answer={active} />}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {voiceGate(active) === 'held' ? (
                        <button
                          type="button"
                          disabled
                          title="Fix the voice check first — edit it or ask Bernard to revise"
                          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground"
                        >
                          <Lock className="h-4 w-4" /> Approve — fix the voice check first
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => mutation.mutate({ id: active.id, action: 'approve' })}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          <Check className="h-4 w-4" /> Looks right — approve
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startEdit(active)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground"
                      >
                        <Pencil className="h-4 w-4" /> Edit inline
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode('revise')}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-semibold ${
                          voiceGate(active) === 'held'
                            ? 'border-action/40 bg-action/10 text-action'
                            : 'border-border text-foreground'
                        }`}
                      >
                        <RotateCcw className="h-4 w-4" /> Ask Bernard to revise
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Queue of the remaining answers — a sticky right rail on wide
              screens, stacked below the active answer on smaller ones. */}
          {answers.length > 1 && (
            <div className="space-y-2 xl:sticky xl:top-6">
              <p className="px-1 text-2xs font-bold uppercase tracking-wide text-muted-foreground">
                Up next
              </p>
              {answers
                .filter((a) => a.id !== active?.id)
                .map((a) => {
                  const idx = answers.findIndex((x) => x.id === a.id)
                  return (
                    <QueueRow
                      key={a.id}
                      answer={a}
                      index={idx}
                      total={answers.length}
                      onOpen={() => {
                        setOpenId(a.id)
                        setMode(null)
                      }}
                    />
                  )
                })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
