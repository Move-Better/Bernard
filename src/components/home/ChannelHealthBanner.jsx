// Home-page alert for a dropped social/GBP connection — admin-visible, live
// (queries the same /api/integrations/bundle/status the Integrations page
// uses, not yesterday's cron snapshot), self-gated to render nothing when
// everything's connected or the workspace isn't on bundle.social.
//
// Why this exists: the daily check-channel-health cron already emails the
// workspace owner once a day, but there was no in-app surface at all — an
// admin who doesn't read that email (or isn't the owner) had no way to see a
// dead channel short of opening Settings → Integrations and noticing. Q,
// 2026-07-22: "Any connection drop should notify the workspace admin and be
// displayed on the home page."

import { AlertTriangle, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { useUserRole } from '@/lib/useUserRole'

const TYPE_LABELS = {
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

export default function ChannelHealthBanner() {
  const { role } = useUserRole()
  const isAdmin = role === 'admin'

  const { data } = useQuery({
    queryKey: ['bundle-status-home'],
    queryFn: () => apiFetch('/api/integrations/bundle/status'),
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  if (!isAdmin || !data) return null

  const brokenAccounts = (data.accounts || []).filter((a) => !a.connected)
  const brokenLocations = (data.locations || []).filter((l) => l.hasTeam && !l.connected)
  const names = [
    ...brokenAccounts.map((a) => TYPE_LABELS[a.type] || a.type),
    ...brokenLocations.map((l) => `Google Business Profile (${l.label})`),
  ]
  if (names.length === 0) return null

  return (
    <Link to="/settings/integrations" className="nx-alert nx-alert-crit hover:brightness-[0.98] transition">
      <span className="nx-alert-chip nx-alert-chip-crit">
        <AlertTriangle className="h-4 w-4" />
      </span>
      <span className="text-sm font-medium text-foreground">
        {names.length === 1 ? `${names[0]} is disconnected` : `${names.length} channels are disconnected`}
        {names.length > 1 && <span className="text-muted-foreground font-normal"> — {names.join(', ')}</span>}
      </span>
      <span className="ml-auto inline-flex items-center gap-0.5 text-sm font-medium text-destructive">
        Reconnect <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  )
}
