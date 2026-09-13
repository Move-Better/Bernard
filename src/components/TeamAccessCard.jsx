// Access card on a staff profile: deactivate someone who left (handing their
// open work to a successor) or turn a deactivated person back on.
//
// Deactivating keeps their Clerk login, access level and history — only
// sign-in to Bernard, their upload link and their emails stop. Owner-gated on
// members.invite, the same gate as the Access page; the server re-checks it
// and refuses owners and yourself (POST /api/staff/access).

import { useState } from 'react'
import { useUser } from '@clerk/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserX, UserCheck, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { apiFetch } from '@/lib/api'
import { useAppMutation } from '@/lib/useAppMutation'
import { usePermission } from '@/lib/usePermission'
import { toast } from '@/lib/toast'
import { formatDate } from '@/lib/utils'

const postAccess = (body) =>
  apiFetch('/api/staff/access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const ERROR_COPY = {
  cannot_deactivate_owner: 'Owners can’t be deactivated. Change their role in Members first.',
  cannot_deactivate_self: 'You can’t deactivate yourself.',
  invalid_successor: 'Pick someone active who can sign in.',
  already_deactivated: 'Their access is already switched off.',
  handover_failed: 'Handing over their work stopped part-way. Nothing was switched off. Try again.',
}

function MoveRow({ label, count, to }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border last:border-0">
      <span className="text-sm">{label}</span>
      <span className="text-sm tabular-nums font-semibold shrink-0">
        {count}
        <span className="ml-2 font-normal text-2xs text-muted-foreground">{count > 0 ? to : '—'}</span>
      </span>
    </div>
  )
}

export default function TeamAccessCard({ staffMember, staffList = [] }) {
  const { user } = useUser()
  const { has } = usePermission()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [successorId, setSuccessorId] = useState('')

  const canManage = has('members.invite')
  const isSelf = !!staffMember?.user_id && staffMember.user_id === user?.id
  const firstName = (staffMember?.name || 'They').split(' ')[0]

  // Someone who can take the work: active, able to sign in, not this person.
  const successors = staffList.filter(
    (s) => s.id !== staffMember?.id && !s.deactivated_at && s.user_id,
  )
  const successorName = successors.find((s) => s.id === successorId)?.name

  const preview = useQuery({
    queryKey: ['staff-access-preview', staffMember?.id, successorId],
    queryFn: () => postAccess({ action: 'preview', staffId: staffMember.id, successorId }),
    enabled: open && !!successorId && canManage,
    staleTime: 0,
    retry: false,
  })

  const mutation = useAppMutation({
    silent: true,
    mutationFn: postAccess,
    onSuccess: (data, body) => {
      qc.invalidateQueries({ queryKey: ['staff'] })
      qc.invalidateQueries({ queryKey: ['access-matrix'] })
      if (body.action === 'reactivate') {
        toast.success(`${staffMember.name}'s access is back on`)
      } else {
        toast.success(`${staffMember.name} is deactivated`, {
          description: `Open work moved to ${data?.successor?.name || 'their successor'}.`,
        })
        setOpen(false)
        setSuccessorId('')
      }
    },
    onError: (e) => {
      toast.error('Could not change access', {
        description: ERROR_COPY[e?.payload?.error] || e?.message,
      })
    },
  })

  if (!staffMember || !canManage || isSelf) return null

  const deactivated = !!staffMember.deactivated_at
  const counts = preview.data?.counts
  const previewError = preview.error ? (ERROR_COPY[preview.error?.payload?.error] || 'Could not load what would move.') : null

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Access</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {deactivated
                ? `Switched off ${formatDate(staffMember.deactivated_at)}. Their login, access level and history are kept.`
                : 'For someone who has left. Their login and history are kept, so you can turn access back on later.'}
            </p>
          </div>
          {deactivated ? (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ action: 'reactivate', staffId: staffMember.id })}
            >
              {mutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><UserCheck className="h-4 w-4 mr-1.5" aria-hidden="true" />Reactivate</>}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/5"
              onClick={() => setOpen(true)}
            >
              <UserX className="h-4 w-4 mr-1.5" aria-hidden="true" />
              Deactivate
            </Button>
          )}
        </div>

        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSuccessorId('') }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Deactivate {staffMember.name}</DialogTitle>
              <DialogDescription>
                {firstName} won’t be able to open Bernard. Choose who takes over their open work.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <Select value={successorId} onValueChange={setSuccessorId}>
                <SelectTrigger className="w-full h-9 text-sm" aria-label="Who takes over their work">
                  <SelectValue placeholder="Who takes over?" />
                </SelectTrigger>
                <SelectContent>
                  {successors.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {successorId && (
                <div className="rounded-lg border border-border px-3 py-1">
                  {preview.isLoading && (
                    <p className="text-sm text-muted-foreground py-2 flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking what moves…
                    </p>
                  )}
                  {previewError && <p className="text-sm text-destructive py-2">{previewError}</p>}
                  {counts && (
                    <>
                      <MoveRow label="Open drafts and posts" count={counts.content} to={`→ ${successorName}`} />
                      <MoveRow label="Unpublished answers" count={counts.answers} to={`→ ${successorName}`} />
                      <MoveRow label="Campaigns targeting them" count={counts.campaigns} to={`→ ${successorName}`} />
                      <MoveRow label="Quotes sent back for their review" count={counts.sentBackMoments} to="released" />
                    </>
                  )}
                </div>
              )}

              <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-2xs text-muted-foreground space-y-1">
                <p><span className="font-semibold text-foreground">Switches off:</span> sign-in to Bernard, their photo upload link, their emails and nudges.</p>
                <p><span className="font-semibold text-foreground">Kept:</span> their login, access level, and their name on everything already published.</p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); setSuccessorId('') }} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!counts || mutation.isPending}
                onClick={() => mutation.mutate({ action: 'deactivate', staffId: staffMember.id, successorId })}
              >
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Deactivate and hand over'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
