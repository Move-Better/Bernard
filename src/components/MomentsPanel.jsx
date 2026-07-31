import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useAppMutation } from '@/lib/useAppMutation'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import RatingBadge from '@/components/ui/RatingBadge'
import { toast } from '@/lib/toast'
import MomentRetireReasons from '@/components/moments/MomentRetireReasons'
import { MOMENT_RETIRE_REASON_LABEL } from '@/lib/momentRetire'

/**
 * MomentsPanel — the banked moments mined from one interview, rendered inside
 * StoryDetail (open by default since the Moments IA reframe, #2420).
 *
 * Retire/Restore shares semantics + copy with the /moments On hand tab
 * (OnHandTab.jsx): retire is QUIET — it stops future draws only; already-
 * planned pieces keep their per-piece review life, and the confirm dialog
 * states how many. Restore is immediate. The server (PATCH /api/db/moments)
 * enforces the editor-role gate; like OnHandTab we don't hide the affordance
 * client-side.
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

function MomentRow({ moment, onRetire, onRestore, busy }) {
  const typeLabel = MOMENT_TYPE_LABELS[moment.moment_type] || moment.moment_type || 'Moment'
  const retired = moment.status === 'retired'
  return (
    <li className="py-3 first:pt-1 last:pb-1">
      <div className="flex items-start gap-3">
        <RatingBadge score={moment.score} signal="quote" size="sm" />
        <div className="min-w-0 flex-1 space-y-1">
          <blockquote className={`text-sm leading-relaxed ${retired ? 'text-muted-foreground' : 'text-foreground/90'}`}>
            “{moment.excerpt}”
          </blockquote>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
            <span className="font-medium text-foreground/60">{typeLabel}</span>
            {moment.topic && <span>· {moment.topic}</span>}
            {retired && (
              <span className="uppercase tracking-wide font-semibold">· Retired</span>
            )}
            {retired && (moment.retire_reasons?.length > 0 || moment.retire_note) && (
              <span>
                · why:{' '}
                {[
                  (moment.retire_reasons || []).map((r) => MOMENT_RETIRE_REASON_LABEL[r] || r).join(', '),
                  moment.retire_note,
                ]
                  .filter(Boolean)
                  .join(' — ')}
              </span>
            )}
            {!retired && !moment.is_exemplar && (
              <span title="A stronger near-duplicate moment represents this cluster; the planner draws that one.">
                · duplicate of a stronger moment
              </span>
            )}
            {moment.usage_count > 0 && <span>· used ×{moment.usage_count}</span>}
            {retired ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRestore(moment)}
                className="font-semibold text-primary hover:underline disabled:opacity-50"
              >
                Restore
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRetire(moment)}
                className="font-semibold text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
              >
                Retire
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

export default function MomentsPanel({ interviewId }) {
  const queryClient = useQueryClient()
  const [retireTarget, setRetireTarget] = useState(null)
  const [retireReasons, setRetireReasons] = useState([])
  const [retireNote, setRetireNote] = useState('')
  const { data, isLoading, isError } = useQuery({
    queryKey: ['moments', interviewId],
    queryFn: () => apiFetch(`/api/db/moments?interview_id=${encodeURIComponent(interviewId)}`),
    enabled: !!interviewId,
    refetchOnWindowFocus: false,
  })

  const statusMutation = useAppMutation({
    errorMessage: 'Could not update this moment',
    mutationFn: ({ id, status, retireReasons: reasons, retireNote: note }) =>
      apiFetch(`/api/db/moments?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          ...(status === 'retired' ? { retireReasons: reasons?.length ? reasons : undefined, retireNote: note?.trim() || undefined } : {}),
        }),
      }),
    onSuccess: (_data, { status }) => {
      // This list + the /moments bank share the row; the Stories list and the
      // StoryDetail badge derive from the banked count (#2420 aggregates).
      queryClient.invalidateQueries({ queryKey: ['moments', interviewId] })
      queryClient.invalidateQueries({ queryKey: ['moment-bank'] })
      queryClient.invalidateQueries({ queryKey: ['stories'] })
      queryClient.invalidateQueries({ queryKey: ['staff', 'card'] })
      setRetireTarget(null)
      setRetireReasons([])
      setRetireNote('')
      toast(status === 'retired' ? 'Retired — Bernard won’t use this moment again.' : 'Restored — back on hand.')
    },
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

  const bankedN = moments.filter((m) => m.status === 'banked').length
  const exemplars = moments.filter((m) => m.is_exemplar && m.status === 'banked').length
  const plannedN = retireTarget?.planned_count || 0
  return (
    <div>
      <p className="text-2xs text-muted-foreground pb-1">
        {bankedN} banked · {exemplars} usable (near-duplicates collapse to their strongest version)
      </p>
      <ul className="divide-y">
        {moments.map((m) => (
          <MomentRow
            key={m.id}
            moment={m}
            busy={statusMutation.isPending}
            onRetire={setRetireTarget}
            onRestore={(row) => statusMutation.mutate({ id: row.id, status: 'banked' })}
          />
        ))}
      </ul>

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
        loading={statusMutation.isPending}
        onConfirm={() =>
          retireTarget &&
          statusMutation.mutate({ id: retireTarget.id, status: 'retired', retireReasons, retireNote })
        }
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
