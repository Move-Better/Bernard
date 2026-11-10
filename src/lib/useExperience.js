// useExperience — which screen the signed-in person gets (owner / producer /
// team). Thin React wrapper over the pure rule in @/lib/experience, so the
// router and the sidebar read one answer. Presentation only: never use this to
// decide whether an action is allowed.

import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { experienceFor, effectiveExperience } from '@/lib/experience'

export const VIEW_AS_KEY = 'bernard:view-as:v1'

function readViewAs() {
  try { return localStorage.getItem(VIEW_AS_KEY) } catch { return null }
}

export function useExperience() {
  const ws = useWorkspace()
  const { role } = useUserRole()
  const actual = experienceFor({
    tier: ws?.current_user_tier ?? null,
    role,
    deactivated: !!ws?.access_deactivated,
  })
  return { actual, experience: effectiveExperience(actual, readViewAs()) }
}
