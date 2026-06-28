// F6 Phase 4 — Practice Brain (supersession review) data hooks.
// Reads/writes the pending-supersession queue from /api/practice-memory/supersessions.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'
import { useAppMutation } from './useAppMutation'

const SUPERSESSIONS_KEY = ['practice-brain', 'supersessions']

/** Pending supersession candidates for the current workspace (the confirm queue). */
export function usePracticeBrainSupersessions(options = {}) {
  return useQuery({
    queryKey: SUPERSESSIONS_KEY,
    queryFn: () => apiFetch('/api/practice-memory/supersessions'),
    staleTime: 5 * 60_000,
    ...options,
  })
}

/** Confirm (suppress the older take) or reject (keep both) a candidate. */
export function useUpdateSupersession() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't save your response",
    mutationFn: ({ id, action }) =>
      apiFetch('/api/practice-memory/supersessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['practice-brain'] }),
  })
}
