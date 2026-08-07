import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles, Clock, ArrowRight, X, Loader2 } from 'lucide-react'
import { getOrCreateStaff, createInterview, updateInterview } from '@/lib/api'
import { useParkedPoints, queryKeys } from '@/lib/queries'
import { useAppMutation } from '@/lib/useAppMutation'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getInitials, formatRelativeDate } from '@/lib/utils'

const POINTS_INITIAL_CAP = 4

// "Make a point" quick-capture (Phase 3, .claude/make-a-point-spec.md): a
// one-field box to jot a point the moment it strikes, plus the "Points to
// record" strip of everything saved but not yet turned into a real
// interview. Visually modeled on ResumeStrip.jsx (same card shape, same
// interaction language) in the action/amber palette, so a parked point and
// an active interview never blur together at a glance.
//
// Speaker/voice resolves SILENTLY to the logged-in user at capture time —
// staff_id is required everywhere downstream (interview creation, the
// session route itself), so "no pickers" means no VISIBLE picker, not no
// staff. Same self-detection NewInterview.jsx already uses.
export default function PointCapture() {
  const { user } = useUser()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [text, setText] = useState('')

  const preferredName = user?.unsafeMetadata?.display_name || user?.fullName || ''

  const { data: points = [] } = useParkedPoints()

  const saveMutation = useAppMutation({
    errorMessage: "Couldn't save that point",
    mutationFn: async (pointText) => {
      const staffMember = await getOrCreateStaff({
        name: preferredName,
        createdById: user.id,
        createdByEmail: user.primaryEmailAddress?.emailAddress,
        userId: user.id,
      })
      return createInterview({
        staffId: staffMember.id,
        kind: 'point',
        point: pointText,
        status: 'parked',
        ownerEmail: user.primaryEmailAddress?.emailAddress,
        voiceMode: 'personal',
      })
    },
    onSuccess: () => {
      setText('')
      qc.invalidateQueries({ queryKey: queryKeys.interviews.parked })
    },
  })

  const dismissMutation = useAppMutation({
    errorMessage: "Couldn't dismiss that point",
    mutationFn: (id) => updateInterview(id, { status: 'abandoned' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.interviews.parked }),
  })

  const recordMutation = useAppMutation({
    errorMessage: "Couldn't start that interview",
    mutationFn: (point) => updateInterview(point.id, { status: 'in_progress' }),
    onSuccess: (_result, point) => {
      qc.invalidateQueries({ queryKey: queryKeys.interviews.parked })
      // No micChecked nav state — InterviewSession's own in-session mic-check
      // gate fires naturally (same as any direct link into an interview),
      // so this needs no new plumbing beyond the status flip above.
      navigate(`/interview/${point.staff_id}/${point.id}`)
    },
  })

  function handleSave() {
    const trimmed = text.trim()
    if (!trimmed || saveMutation.isPending) return
    saveMutation.mutate(trimmed)
  }

  const canCapture = !!preferredName

  return (
    <div className="flex flex-col gap-4">
      {/* Capture box — always visible, one field. */}
      <div className="nx-card-hi p-4 flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          <h3 className="text-sm font-bold text-foreground">Make a point</h3>
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Ran two days in a row, ten minutes each — my deep sleep came right back after months of nothing working…"
          className="min-h-[44px] focus:min-h-[76px] transition-[min-height] text-sm"
          disabled={!canCapture}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-2xs text-muted-foreground">
            {canCapture
              ? 'One field. Save it now, record it whenever you\'re ready.'
              : 'Set your name in Settings to capture points.'}
          </p>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canCapture || !text.trim() || saveMutation.isPending}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold px-3.5 py-1.5 disabled:opacity-45 hover:brightness-110 transition"
          >
            {saveMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Save point
          </button>
        </div>
      </div>

      {/* Points to record — hidden entirely when empty, same as ResumeStrip. */}
      {points.length > 0 && (
        <PointsStrip
          points={points}
          onDismiss={(id) => dismissMutation.mutate(id)}
          onRecord={(point) => recordMutation.mutate(point)}
          recordingId={recordMutation.isPending ? recordMutation.variables?.id : null}
        />
      )}
    </div>
  )
}

function PointsStrip({ points, onDismiss, onRecord, recordingId }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? points : points.slice(0, POINTS_INITIAL_CAP)
  const hiddenCount = points.length - POINTS_INITIAL_CAP

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Clock className="h-5 w-5 text-action" aria-hidden="true" />
        <h2 className="text-xl font-bold tracking-tight text-foreground">Points to record</h2>
        <span className="text-sm text-muted-foreground">
          · {points.length} waiting
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visible.map((point) => (
          <PointCard
            key={point.id}
            point={point}
            onDismiss={() => onDismiss(point.id)}
            onRecord={() => onRecord(point)}
            isRecording={recordingId === point.id}
          />
        ))}
      </div>
      {hiddenCount > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 text-xs font-medium text-primary hover:underline"
        >
          View all {points.length} points to record →
        </button>
      )}
      {showAll && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          Show fewer
        </button>
      )}
    </div>
  )
}

function PointCard({ point, onDismiss, onRecord, isRecording }) {
  const staffName = point.staff?.name || 'Someone'
  const text = point.point || point.topic || ''
  return (
    <div className="group relative nx-card-hi p-3 pr-2.5">
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        className="absolute top-2 right-2 h-5 w-5 rounded-md flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition"
      >
        <X className="h-3 w-3" />
      </button>
      <div className="flex items-center gap-1.5 mb-1.5 pr-5">
        <Avatar className="h-[18px] w-[18px]">
          <AvatarFallback className="bg-action/15 text-action text-3xs font-bold">
            {getInitials(staffName)}
          </AvatarFallback>
        </Avatar>
        <p className="text-2xs font-bold text-foreground/75 truncate" title={staffName}>{staffName}</p>
      </div>
      <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2 mb-1.5" title={text}>
        {text}
      </p>
      <p className="text-3xs text-muted-foreground mb-2">
        Saved {formatRelativeDate(point.created_at)}
      </p>
      <button
        type="button"
        onClick={onRecord}
        disabled={isRecording}
        className="inline-flex items-center gap-1 text-xs font-bold text-action hover:underline disabled:opacity-60"
      >
        {isRecording ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        Record now
        {!isRecording && <ArrowRight className="h-3 w-3" />}
      </button>
    </div>
  )
}
