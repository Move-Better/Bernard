// Home-page notice for the reporter of an in-app Feedback submission once it's
// fixed. Some staff (e.g. front desk) deliberately stop using a feature the
// moment they hit a bug and wait to be told it's safe to come back — email is
// the primary notice (they may not be logged in for a while), this banner is
// the backup for whenever they do return. Self-dismissing per report.

import { useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { useAppMutation } from '@/lib/useAppMutation'

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
        <div
          key={n.id}
          className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/8 px-4 py-3"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <span className="text-sm font-medium text-foreground">
            Fixed: the issue you reported is resolved
            {n.resolved_note && <span className="text-muted-foreground font-normal"> — {n.resolved_note}</span>}
          </span>
          <button
            type="button"
            onClick={() => dismiss(n.id)}
            disabled={dismissing === n.id}
            className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-black/5 transition"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
