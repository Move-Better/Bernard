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
    autocapture: true,                   // breadth: heatmaps + rage/dead clicks everywhere
    capture_pageview: false,             // we fire virtual pageviews manually on route change
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '.ph-no-capture',
    },
  })
}

export function posthogIdentify(userId) {
  if (!posthog.__loaded) return
  posthog.identify(userId)
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
