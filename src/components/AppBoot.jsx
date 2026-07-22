import PageSkeleton from '@/components/PageSkeleton'

// AppBoot — what the app paints while the shell is still gated.
//
// App.jsx cannot render any route until BOTH Clerk reports isLoaded and
// /api/workspace/me resolves (it needs the workspace row to know whether to
// mount OrgGate or DomainGuard, and guessing wrong flashes an "Access
// Restricted" screen at a legitimate customer). Measured on prod 2026-07-22
// that is ~2.2s on a cold load, dominated by Clerk's own client-side boot —
// which we do not control. Until now the gate returned null, so the whole
// window was a blank white page.
//
// This does not make anything load faster. It replaces "looks broken" with
// "looks like it is loading", which for staff opening the app many times a day
// is the difference that is actually felt.
//
// Deliberately dependency-free: no Clerk hooks, no workspace context, no
// queries. It renders BEFORE any of those are available, and anything it
// touched would either throw or kick off the very fetches the gate is waiting
// on. PageSkeleton is safe here — it is presentational only.

// Mirrors Layout.jsx. Keep in sync with it — sidebar widths (w-14 / w-56),
// content offset (md:ml-14 / md:ml-56), the h-14 top bar, and main's
// px-4 sm:px-6 lg:px-8 py-8 — so the real shell replaces this in place instead
// of the page jumping when it mounts.
const COLLAPSED_KEY = 'sidebar-collapsed'

function readCollapsed() {
  // Same key Layout.jsx's own readCollapsed() uses, duplicated rather than
  // imported: importing from Layout would drag in its Clerk hooks and defeat
  // the point of this file being dependency-free.
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Clerk publishes `__client_uat` as a readable (non-HttpOnly) cookie: absent or
 * "0" means no session, anything else means there is one. It lets us tell,
 * before Clerk has booted, whether this person is heading for the app or for
 * the sign-in card — so a returning user watches the app shell form instead of
 * staring at a blank page for two seconds.
 *
 * THIS IS A PAINTING HINT AND NOTHING ELSE. Cookies are user-controlled, so it
 * must never gate access to data or routes; real authentication is Clerk plus
 * OrgGate / DomainGuard in App.jsx, unchanged. The worst a forged value can do
 * is show someone the wrong placeholder for a moment before the real gate
 * resolves and overrides it.
 */
export function looksSignedIn() {
  try {
    const c = document.cookie.split('; ').find((x) => x.startsWith('__client_uat='))
    return !!c && c.split('=')[1] !== '0'
  } catch {
    return false
  }
}

// Signed-out (or unknown): a quiet brand mark. Deliberately NOT the app shell —
// showing a fake sidebar to someone about to be asked to sign in is a lie about
// where they are.
function BootSplash() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <img src="/bernard-logo.svg" alt="" className="h-9 w-auto animate-pulse opacity-50" />
    </div>
  )
}

// Signed-in: the shell forming. The sidebar is drawn SOLID rather than as
// shimmering placeholders — its geometry and color are the two things we can
// state truthfully at this point, and a shimmering nav rail reads as broken
// rather than as loading. The content region, whose shape we genuinely do not
// know yet, uses the same PageSkeleton every data page already shows, so the
// boot placeholder and the per-page one are the same object.
function ShellSkeleton() {
  const collapsed = readCollapsed()
  return (
    <div className="min-h-screen bg-background">
      <aside
        aria-hidden="true"
        className={`hidden md:flex fixed inset-y-0 left-0 ${collapsed ? 'w-14' : 'w-56'} flex-col border-r border-sidebar-border bg-sidebar`}
      >
        <div className={`h-14 shrink-0 border-b border-sidebar-border flex items-center ${collapsed ? 'justify-center' : 'px-4'}`}>
          <img src="/bernard-icon.svg" alt="" className="h-6 w-6 opacity-80" />
        </div>
        <div className="flex-1 space-y-1.5 px-2 py-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`h-8 rounded-md bg-sidebar-active/50 ${collapsed ? 'mx-auto w-9' : ''}`} />
          ))}
        </div>
      </aside>

      <div className={collapsed ? 'md:ml-14' : 'md:ml-56'}>
        <main className="px-4 py-8 sm:px-6 lg:px-8">
          <PageSkeleton variant="dashboard" />
        </main>
      </div>
    </div>
  )
}

/**
 * `signedIn` — pass it when the caller already knows (gate ②, where Clerk has
 * loaded and reported isSignedIn). Omit it at gate ①, where Clerk has not
 * booted yet and the cookie hint is the best available signal.
 */
export default function AppBoot({ signedIn }) {
  const showShell = signedIn === undefined ? looksSignedIn() : signedIn
  return showShell ? <ShellSkeleton /> : <BootSplash />
}
