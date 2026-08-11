// Disconnected publish channels — the data half of what used to be
// ChannelHealthBanner.
//
// Split out of the component (2026-08-11) so Home's attention queue can fold
// dead channels into its `blocked` tier instead of rendering a second, separate
// red bar underneath it. The derivation is a pure function so the rule — which
// accounts and which locations count as broken — can be tested without a DOM.
//
// Why it exists at all: the daily check-channel-health cron emails the
// workspace OWNER once a day, but an admin who isn't the owner (or doesn't
// read that email) had no in-app surface at all. Q, 2026-07-22: "Any
// connection drop should notify the workspace admin and be displayed on the
// home page."

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { useUserRole } from '@/lib/useUserRole'

export const CHANNEL_TYPE_LABELS = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  LINKEDIN: 'LinkedIn',
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  TWITTER: 'X',
  THREADS: 'Threads',
  BLUESKY: 'Bluesky',
  MASTODON: 'Mastodon',
}

/**
 * Broken channels from a /api/integrations/bundle/status payload.
 *
 * A location only counts when it HAS a team — a Google Business Profile
 * location that was never connected in the first place is not a drop, and
 * flagging it would make the banner cry wolf on every fresh workspace.
 *
 * @param {{accounts?: object[], locations?: object[]}} [data]
 * @returns {{key: string, label: string}[]}
 */
export function brokenChannelsFrom(data) {
  if (!data) return []
  const accounts = (data.accounts || [])
    .filter((a) => !a.connected)
    .map((a) => ({ key: `account:${a.type}`, label: CHANNEL_TYPE_LABELS[a.type] || a.type }))
  const locations = (data.locations || [])
    .filter((l) => l.hasTeam && !l.connected)
    .map((l) => ({ key: `location:${l.id || l.label}`, label: `Google Business Profile (${l.label})` }))
  return [...accounts, ...locations]
}

/**
 * Live channel-connection state for the current workspace. Admin-only — a
 * clinician can't reconnect an integration, so surfacing the alarm to them
 * would be noise they can't act on.
 *
 * Queries the same endpoint the Integrations page uses rather than yesterday's
 * cron snapshot, so a reconnect clears the alarm on the next refetch.
 */
export function useChannelHealth() {
  const { role } = useUserRole()
  const isAdmin = role === 'admin'

  const { data } = useQuery({
    queryKey: ['bundle-status-home'],
    queryFn: () => apiFetch('/api/integrations/bundle/status'),
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  // Memoized because the caller (Home's attention queue) uses this as a memo
  // dependency — brokenChannelsFrom builds fresh arrays, so returning it raw
  // would rebuild the whole queue on every render.
  return useMemo(() => (isAdmin ? brokenChannelsFrom(data) : EMPTY), [isAdmin, data])
}

// Shared frozen instance so the not-admin path is referentially stable too.
const EMPTY = Object.freeze([])
