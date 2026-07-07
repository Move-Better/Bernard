// /settings/members — invite teammates, change roles, remove members.
//
// We mount Clerk's prebuilt <OrganizationProfile /> rather than reimplementing
// the invite + role + remove UI. Clerk already manages organization membership
// for this app (OrgGate in App.jsx activates the workspace's Clerk org per
// subdomain), so the same primitive can drive the in-app members tab without
// any custom server work.
//
// Routing: routePath="/settings/members" tells Clerk to mount its internal
// router under that base so deep links (e.g. /settings/members/invitations)
// keep working without us having to add wildcard routes.

import { OrganizationProfile } from '@clerk/react'
import { ArrowLeft, Bot, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useSmartBack } from '@/lib/useSmartBack'
import { useWorkspace } from '@/lib/WorkspaceContext'

// Bernard-as-teammate card (Standing Producer Phase 0). Presentational: shown
// only when the workspace has hired Bernard (producer_config.enabled), it
// establishes Bernard as a named member alongside the humans and links to the
// workday feed. Self-serve enable/pause controls land in Phase 4.
function BernardMemberCard() {
  const ws = useWorkspace()
  if (!ws?.producer_config?.enabled) return null
  const paused = Boolean(ws.producer_config.paused_at)
  return (
    <Link
      to="/producer"
      className="flex items-center gap-3 rounded-xl border-2 border-primary/40 bg-primary/[0.04] px-4 py-3 transition-colors hover:bg-primary/[0.07]"
    >
      <div className="relative w-9 h-9 rounded-full bg-primary grid place-items-center text-sm font-bold text-primary-foreground shrink-0">
        <Bot className="w-5 h-5" aria-hidden="true" />
        {!paused && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card bg-success" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold">
          Bernard <span className="font-normal text-muted-foreground">· {paused ? 'paused' : 'always on'}</span>
        </div>
        <div className="text-xs text-muted-foreground">Your AI producer — see the workday</div>
      </div>
      <span className="ml-auto shrink-0 text-xs font-bold px-2 py-0.5 rounded-full bg-primary text-primary-foreground">Producer</span>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
    </Link>
  )
}

export default function Members() {
  useDocumentTitle('Members')
  const goBack = useSmartBack('/settings/workspace')
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={goBack} aria-label="Back to settings">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center">
            <span
              className="inline-block w-1 h-6 rounded-full shrink-0 mr-2.5 bg-info"
              aria-hidden="true"
            />
            Members
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invite teammates, change roles, and manage workspace access.
          </p>
        </div>
      </div>

      <BernardMemberCard />

      <OrganizationProfile routing="path" path="/settings/members" />
    </div>
  )
}
