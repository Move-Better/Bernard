// /account — login & security only (email, password, MFA, sessions,
// connected accounts). We mount Clerk's prebuilt <UserProfile /> rather
// than rebuild. Routing="path" lets Clerk's internal sub-routes (e.g.
// /account/security) work without us adding wildcard routes.
//
// Clinician-shaped settings (display name, voice playback pace, content
// focus override, voice notes, recipes) live on /staff/:id. The
// UserButton dropdown surfaces both with their own labels.

import { UserProfile } from '@clerk/react'
import { UserCircle } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { BERNARD_PRIMARY_HSL } from '@/lib/brand'

export default function Account() {
  useDocumentTitle('Account & security')
  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/"
        icon={UserCircle}
        title="Account & security"
        subtitle="Email, password, multi-factor authentication, and active sessions. Looking for your display name, voice pace, or content focus? Those live on your staff profile — open it from the avatar menu in the bottom-left of the sidebar."
      />

      <UserProfile
        routing="path"
        path="/account"
        appearance={{
          // ClerkProvider (src/App.jsx) already sets colorPrimary globally;
          // UserProfile is the one full-page Clerk surface, so give it the
          // rest of the app's design tokens (radius, background, borders)
          // rather than relying on Clerk's default gray card chrome.
          variables: {
            colorPrimary: `hsl(${BERNARD_PRIMARY_HSL})`,
            colorBackground: 'hsl(0 0% 100%)',
            borderRadius: '0.625rem',
          },
          elements: {
            rootBox: 'w-full',
            card: 'shadow-sm border w-full',
          },
        }}
      />
    </div>
  )
}
