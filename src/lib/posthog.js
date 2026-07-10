// posthog-js is loaded on demand (dynamic import) and initialized off the
// critical path — see initPosthog + App.jsx. Keeping it out of the static import
// graph drops ~66 KB gzip of analytics JS from every route's modulepreload, and
// deferring init to idle keeps it off the LCP path. Any identify/pageview/capture
// fired before the module finishes loading is buffered and flushed on init, so no
// early event is lost.

// Routes where session recording is completely off (transcripts, PHI-adjacent,
// credentials, billing). All other routes record with inputs masked.
const REPLAY_EXCLUDE_PREFIXES = [
  '/interview/',
  '/onboard/interview',
  '/new/live-interview',
  '/new/voice-memo',
  '/capture/',
  '/settings/',
  '/account/',
]

let posthog = null
const preloadQueue = [] // calls made before posthog-js finished loading

// Run `fn(posthog)` now if the SDK is loaded, otherwise buffer it until
// initPosthog resolves. Args are captured in the closure at call time, so a
// buffered pageview keeps the URL it was fired for, not the URL at flush time.
function withPosthog(fn) {
  if (posthog?.__loaded) {
    fn(posthog)
  } else {
    preloadQueue.push(fn)
  }
}

export async function initPosthog() {
  const key = import.meta.env.VITE_POSTHOG_KEY
  const host = import.meta.env.VITE_POSTHOG_HOST
  if (!key || !host) return

  const mod = await import('posthog-js')
  posthog = mod.default
  posthog.init(key, {
    api_host: host,
    person_profiles: 'identified_only', // no anonymous profiles — cost control
    autocapture: true,                   // breadth: heatmaps + rage clicks everywhere
    capture_dead_clicks: true,           // separate from autocapture — off by default in posthog-js
    capture_performance: true,           // enables $web_vitals capture
    capture_exceptions: true,            // $exception autocapture → lights up error-clicks (Sentry still holds full stacks)
    capture_pageview: false,             // we fire virtual pageviews manually on route change
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '.ph-no-capture',
    },
  })

  // Flush anything captured before the SDK finished loading, in order.
  const pending = preloadQueue.splice(0)
  for (const fn of pending) {
    try { fn(posthog) } catch { /* ignore a single bad buffered call */ }
  }
}

// Attach the signed-in staff member's identity to their events. `userId` is the
// stable Clerk user id (same person across sessions/devices), used as the distinct
// id; `properties` sets person props (email, name) so an adoption/usage view can
// name who's using Bernard instead of only showing an opaque id. posthog-js stitches
// the pre-login anonymous events to this identity on the first identify() call, so
// no manual alias() is needed. Only the staff user's own Clerk identity is sent —
// never patient data.
export function posthogIdentify(userId, properties) {
  withPosthog((ph) => ph.identify(userId, properties))
}

// Clear the identified person on sign-out so a shared browser doesn't attribute
// the next user's activity to the previous one.
export function posthogReset() {
  withPosthog((ph) => ph.reset())
}

export function posthogGroup(workspaceId, workspaceSlug, workspaceName) {
  withPosthog((ph) => ph.group('workspace', workspaceId, {
    slug: workspaceSlug,
    name: workspaceName,
  }))
}

// Call on every React Router location change to fire a virtual $pageview
// and gate session recording based on the route.
export function posthogPageview(pathname) {
  const href = window.location.href // snapshot now; may flush after further navigation
  withPosthog((ph) => {
    ph.capture('$pageview', { $current_url: href })
    const excluded = REPLAY_EXCLUDE_PREFIXES.some(p => pathname.startsWith(p))
    if (excluded) {
      ph.stopSessionRecording()
    } else {
      ph.startSessionRecording()
    }
  })
}

export function posthogCapture(event, properties) {
  withPosthog((ph) => ph.capture(event, properties))
}
