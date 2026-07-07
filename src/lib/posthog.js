import posthog from 'posthog-js'

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

export function initPosthog() {
  const key = import.meta.env.VITE_POSTHOG_KEY
  const host = import.meta.env.VITE_POSTHOG_HOST
  if (!key || !host) return

  posthog.init(key, {
    api_host: host,
    person_profiles: 'identified_only', // no anonymous profiles — cost control
    autocapture: true,                   // breadth: heatmaps + rage clicks everywhere
    capture_dead_clicks: true,           // separate from autocapture — off by default in posthog-js
    capture_performance: true,           // enables $web_vitals capture
    capture_pageview: false,             // we fire virtual pageviews manually on route change
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '.ph-no-capture',
    },
  })
}

// Attach the signed-in staff member's identity to their events. `userId` is the
// stable Clerk user id (same person across sessions/devices), used as the distinct
// id; `properties` sets person props (email, name) so an adoption/usage view can
// name who's using Bernard instead of only showing an opaque id. posthog-js stitches
// the pre-login anonymous events to this identity on the first identify() call, so
// no manual alias() is needed. Only the staff user's own Clerk identity is sent —
// never patient data.
export function posthogIdentify(userId, properties) {
  if (!posthog.__loaded) return
  posthog.identify(userId, properties)
}

// Clear the identified person on sign-out so a shared browser doesn't attribute
// the next user's activity to the previous one.
export function posthogReset() {
  if (!posthog.__loaded) return
  posthog.reset()
}

export function posthogGroup(workspaceId, workspaceSlug, workspaceName) {
  if (!posthog.__loaded) return
  posthog.group('workspace', workspaceId, {
    slug: workspaceSlug,
    name: workspaceName,
  })
}

// Call on every React Router location change to fire a virtual $pageview
// and gate session recording based on the route.
export function posthogPageview(pathname) {
  if (!posthog.__loaded) return
  posthog.capture('$pageview', { $current_url: window.location.href })

  const excluded = REPLAY_EXCLUDE_PREFIXES.some(p => pathname.startsWith(p))
  if (excluded) {
    posthog.stopSessionRecording()
  } else {
    posthog.startSessionRecording()
  }
}

export function posthogCapture(event, properties) {
  if (!posthog.__loaded) return
  posthog.capture(event, properties)
}
