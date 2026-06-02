import { useEffect } from 'react'
import { mountVercelToolbar } from '@vercel/toolbar'

// Mounts the Vercel feedback toolbar for authenticated users.
// Visitors are prompted to sign in with a (free) Vercel account to submit;
// submissions appear as comment threads in the Vercel dashboard and are
// readable via the Vercel MCP tool (list_toolbar_threads).
export function FeedbackToolbar() {
  useEffect(() => {
    mountVercelToolbar()
  }, [])
  return null
}
