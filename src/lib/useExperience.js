// useExperience — which screen the signed-in person gets (owner / producer /
// team). Thin React wrapper over the pure rule in @/lib/experience, so the
// router and the sidebar read one answer. Presentation only: never use this to
// decide whether an action is allowed.
//
// "See Bernard as" (Q, 2026-11-09): an owner can switch what is DRAWN to the
// producer or team-member screen. The choice lives in this browser only and
// is ignored for anyone who is not an owner (effectiveExperience). It never
// touches permissions: the server still sees the owner.

import { useSyncExternalStore } from 'react'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { experienceFor, effectiveExperience } from '@/lib/experience'

export const VIEW_AS_KEY = 'bernard:view-as:v1'
const EVENT = 'bernard:view-as-change'

function readViewAs() {
  try { return localStorage.getItem(VIEW_AS_KEY) } catch { return null }
}

function subscribe(cb) {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

/** Set (or clear, with null) the owner's "See Bernard as" choice. */
export function setViewAs(experience) {
  try {
    if (experience) localStorage.setItem(VIEW_AS_KEY, experience)
    else localStorage.removeItem(VIEW_AS_KEY)
  } catch { /* storage blocked: the switch just does nothing */ }
  window.dispatchEvent(new Event(EVENT))
}

export function useExperience() {
  const ws = useWorkspace()
  const { role } = useUserRole()
  const viewAs = useSyncExternalStore(subscribe, readViewAs, () => null)
  const actual = experienceFor({
    tier: ws?.current_user_tier ?? null,
    role,
    deactivated: !!ws?.access_deactivated,
  })
  return { actual, experience: effectiveExperience(actual, viewAs) }
}
