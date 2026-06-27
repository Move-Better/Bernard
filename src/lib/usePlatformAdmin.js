import { useUser } from '@clerk/react'

// Whether the current user is a Bernard PLATFORM admin — a cross-tenant
// operator who can see the global /admin usage view. This is a USER-level
// Clerk flag (publicMetadata.platform_admin === true), distinct from the
// per-workspace 'admin' role: org admins and internal-plan members are NOT
// platform admins. Set the flag by hand in the Clerk dashboard for the small
// set of operators.
//
// UI affordance only — the server gate requirePlatformAdmin() in
// api/_lib/auth.js is authoritative and will 403 anyone without the flag.
export function usePlatformAdmin() {
  const { user, isLoaded } = useUser()
  return {
    isPlatformAdmin: user?.publicMetadata?.platform_admin === true,
    isLoading: !isLoaded,
  }
}
