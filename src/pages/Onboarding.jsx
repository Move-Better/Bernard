// Phase 1E onboarding wizard. Lives at narraterx.ai/onboard (apex).
//
// Flow:
//   0. Capacity check — silent unless full (then we show a waitlist gate).
//      When spots are open we drop straight into the sign-in/sign-up step
//      with a small "X founding spots left" badge — direct visitors to
//      /onboard found the extra "Get started" interstitial confusing.
//   1. Sign in / sign up (Clerk hosted UI)
//   2. Business basics — display_name, website, location, optional website scan
//   3. Voice context — clinic_context, audience_short, brand_voice (pre-filled by scan)
//   4. Subdomain claim — live availability check
//   5. Channels — pick at least one (none pre-checked)
//   6. Capture setup — video capture is on by default; user sets their display
//      name for content (seeds the founding clinician row at claim time)
//   7. Review + submit
//   8. "Setting up your workspace…" loader → redirect to <slug>.narraterx.ai/settings/workspace
//
// The component does NOT use the WorkspaceProvider (no workspace exists yet)
// and does NOT use OrgGate (Clerk Org is created server-side at the claim step).
// Just <ClerkProvider> + a plain isLoaded/isSignedIn conditional (Clerk v6's
// <Show> is an authorization gate, not a boolean conditional — see AuthScreen).

import { useState, useEffect, useCallback, useRef } from 'react'
import { SignIn, SignUp, useAuth, useUser, useOrganizationList } from '@clerk/react'
import { Loader2, CheckCircle2, AlertCircle, ArrowRight, Sparkles, Plus, X, Clapperboard, Smartphone, FileText, Mail, MapPin, Instagram, Film, Facebook, Linkedin, Music2, Youtube, Twitter, AtSign, Cloud, Globe, Megaphone, LayoutTemplate, Check, Info, Share2, BarChart3, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  OUTPUT_CHANNELS,
  DEFAULT_PUBLISH_INTENT,
  channelOneClickReadyForIntent,
  channelHiddenForIntent,
} from '@/lib/outputChannels'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function Onboarding() {
  useDocumentTitle('Get started')
  const [step, setStep] = useState('loading')
  const [capacity, setCapacity] = useState(null)        // {cap, used, remaining, full}
  const [form, setForm] = useState({
    display_name: '',
    website: '',
    // First entry is the primary location. Additional rows for multi-location
    // practices (e.g. a clinic with two physical sites) — each becomes its own
    // workspace_locations row at claim time.
    locations: [{ label: '', city: '', region: '' }],
    clinic_context: '',
    audience_short: '',
    brand_voice: '',
    // social: handles per platform, collected from the website scan, the
    // "find my profiles" lookup, or typed by hand. Bare handles (no @, no URL);
    // written to workspaces.social at claim time. Empty string = not set.
    social: { instagram: '', facebook: '', linkedin: '', youtube: '', tiktok: '', twitter: '' },
    slug: '',
    // publish_intent: answers to the "How do you publish today?" step (runs
    // BEFORE channels). Tailors which integrations are surfaced later and which
    // channels show a one-click-ready badge. Pre-filled with the recommended
    // path. See src/lib/outputChannels.js for the shape + semantics.
    publish_intent: { ...DEFAULT_PUBLISH_INTENT },
    enabled_outputs: [],
    // capture_name: the founding user's display name for content — seeds the
    // clinicians row at claim time. Defaults to their Clerk firstName + lastName;
    // editable in the Capture step. video_pipeline_enabled is always true for
    // new tenants; the wizard just makes it visible and configurable.
    capture_name: '',
  })
  const [scanState, setScanState] = useState({ status: 'idle', error: null, sources: [], recent_topics: [], services: [] })
  // socialLookup: results of the AI "find my profiles" lookup for platforms the
  // website scan didn't surface. status: idle|searching|done|error; candidates
  // is { platform: [{handle, url, confidence}] } the user confirms (never auto-saved).
  const [socialLookup, setSocialLookup] = useState({ status: 'idle', error: null, candidates: {} })
  const [slugCheck, setSlugCheck] = useState({ status: 'idle', available: null, reason: null })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [redirectUrl, setRedirectUrl] = useState(null)

  // 0. Capacity check — runs once on mount. We only block on the response
  //    when spots are full; otherwise we drop straight to the auth step.
  useEffect(() => {
    // eslint-disable-next-line narraterx/no-raw-api-fetch -- public capacity check; runs before sign-in (api/onboarding/capacity.js)
    fetch('/api/onboarding/capacity')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const cap = data || { cap: 10, used: 0, remaining: 10, full: false }
        setCapacity(cap)
        setStep(prev => (prev === 'loading' ? (cap.full ? 'capacity-full' : 'auth') : prev))
      })
      .catch(() => {
        setCapacity({ cap: 10, used: 0, remaining: 10, full: false })
        setStep(prev => (prev === 'loading' ? 'auth' : prev))
      })
  }, [])

  const setField = useCallback((key) => (val) => setForm(f => ({ ...f, [key]: val })), [])

  // Merge website-scan results into the form. Scan values fill blanks and
  // override the voice fields (the user reviews them on the Voice step), but
  // detected social handles only fill EMPTY slots so a hand-typed handle is
  // never clobbered by a re-scan.
  const applyScan = useCallback((scan) => setForm(f => {
    const services = Array.isArray(scan.services) ? scan.services : []
    const base = scan.clinic_context || f.clinic_context
    const ctx = services.length ? `${base}\n\nServices: ${services.join(', ')}`.trim() : base
    const scannedSocial = (scan.social && typeof scan.social === 'object') ? scan.social : {}
    const social = { ...f.social }
    for (const [platform, handle] of Object.entries(scannedSocial)) {
      if (platform in social && !social[platform] && typeof handle === 'string' && handle.trim()) {
        social[platform] = handle.trim()
      }
    }
    return {
      ...f,
      display_name: scan.display_name || f.display_name,
      clinic_context: ctx,
      audience_short: scan.audience_short || f.audience_short,
      brand_voice: scan.brand_voice || f.brand_voice,
      social,
    }
  }), [])

  // Run the website scan against form.website. Shared by the ScanScreen (first
  // step) and the BusinessScreen re-scan affordance. Resets any prior social
  // lookup so stale "is this you?" candidates don't linger across a re-scan.
  const runScan = useCallback(async () => {
    setScanState({ status: 'scanning', error: null, sources: [], recent_topics: [], services: [] })
    setSocialLookup({ status: 'idle', error: null, candidates: {} })
    try {
      // eslint-disable-next-line narraterx/no-raw-api-fetch -- public onboarding scan; rate-limited, not auth-gated (api/onboarding/scan-website.js)
      const r = await fetch('/api/onboarding/scan-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: form.website }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setScanState({ status: 'error', error: err.error || 'scan-failed', sources: [], recent_topics: [], services: [] })
        return false
      }
      const data = await r.json()
      applyScan(data)
      setScanState({
        status: 'done',
        error: null,
        sources: data.source_pages || [],
        recent_topics: Array.isArray(data.recent_topics) ? data.recent_topics : [],
        services: Array.isArray(data.services) ? data.services : [],
      })
      return true
    } catch {
      setScanState({ status: 'error', error: 'network-error', sources: [], recent_topics: [], services: [] })
      return false
    }
  }, [form.website, applyScan])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="w-full px-6 sm:px-10 lg:px-16 py-10 space-y-6">
        <ProgressBar step={step} />

        {step === 'loading' && <LoadingScreen />}

        {step === 'capacity-full' && (
          <CapacityFullScreen capacity={capacity} />
        )}

        {step === 'auth' && (
          <AuthScreen
            capacity={capacity}
            onSignedIn={() => setStep('scan')}
          />
        )}

        {step === 'scan' && (
          <ScanScreen
            form={form}
            setField={setField}
            scanState={scanState}
            runScan={runScan}
            onContinue={() => setStep('business')}
          />
        )}

        {step === 'business' && (
          <BusinessScreen
            form={form}
            setForm={setForm}
            setField={setField}
            scanState={scanState}
            runScan={runScan}
            socialLookup={socialLookup}
            setSocialLookup={setSocialLookup}
            onBack={() => setStep('scan')}
            onContinue={() => setStep('voice')}
          />
        )}

        {step === 'voice' && (
          <VoiceScreen
            form={form}
            setField={setField}
            scanState={scanState}
            onBack={() => setStep('business')}
            onContinue={() => setStep('subdomain')}
          />
        )}

        {step === 'subdomain' && (
          <SubdomainScreen
            form={form}
            setField={setField}
            slugCheck={slugCheck}
            setSlugCheck={setSlugCheck}
            onBack={() => setStep('voice')}
            onContinue={() => setStep('publish')}
          />
        )}

        {step === 'publish' && (
          <PublishIntentScreen
            form={form}
            setForm={setForm}
            onBack={() => setStep('subdomain')}
            onContinue={() => setStep('channels')}
          />
        )}

        {step === 'channels' && (
          <ChannelsScreen
            form={form}
            setForm={setForm}
            onBack={() => setStep('publish')}
            onContinue={() => setStep('capture')}
          />
        )}

        {step === 'capture' && (
          <CaptureScreen
            form={form}
            setField={setField}
            onBack={() => setStep('channels')}
            onContinue={() => setStep('review')}
          />
        )}

        {step === 'review' && (
          <ReviewScreen
            form={form}
            submitting={submitting}
            submitError={submitError}
            onBack={() => setStep('channels')}
            onSubmit={async (token) => {
              setSubmitting(true)
              setSubmitError(null)
              try {
                const r = await fetch('/api/onboarding/claim', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    slug: form.slug,
                    display_name: form.display_name,
                    website: form.website,
                    locations: form.locations
                      .map(l => ({
                        label: (l.label || '').trim(),
                        city: (l.city || '').trim(),
                        region: (l.region || '').trim(),
                      }))
                      .filter(l => l.city),
                    clinic_context: form.clinic_context,
                    audience_short: form.audience_short,
                    brand_voice: form.brand_voice,
                    social: Object.fromEntries(
                      Object.entries(form.social || {}).filter(([, v]) => v && v.trim())
                    ),
                    enabled_outputs: form.enabled_outputs,
                    publish_intent: form.publish_intent,
                    capture_name: form.capture_name || form.display_name,
                  }),
                })
                if (!r.ok) {
                  const err = await r.json().catch(() => ({}))
                  setSubmitError(err.error || 'claim-failed')
                  setSubmitting(false)
                  return
                }
                const data = await r.json()
                setRedirectUrl(data.redirect_url)
                setStep('launching')
              } catch {
                setSubmitError('network-error')
                setSubmitting(false)
              }
            }}
          />
        )}

        {step === 'launching' && (
          <LaunchingScreen redirectUrl={redirectUrl} />
        )}
      </main>
    </div>
  )
}

// ── Layout chrome ─────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="border-b">
      <div className="w-full px-6 sm:px-10 lg:px-16 py-4 flex items-center justify-between">
        <a href="/" className="font-semibold text-lg">
          <span>narrate</span>
          <span className="text-orange-600">Rx</span>
        </a>
        <a href="/" className="text-xs text-muted-foreground hover:underline">
          ← Back to home
        </a>
      </div>
    </header>
  )
}

const STEP_LABELS = {
  loading: 'Loading',
  'capacity-full': 'Waitlist',
  auth: 'Sign in',
  scan: 'Scan your site',
  business: 'Your business',
  voice: 'Brand voice',
  subdomain: 'Choose subdomain',
  publish: 'How you publish',
  channels: 'Pick channels',
  capture: 'Capture setup',
  review: 'Review',
  launching: 'Setting up',
}
const VISIBLE_STEPS = ['scan', 'business', 'voice', 'subdomain', 'publish', 'channels', 'capture', 'review']

function ProgressBar({ step }) {
  if (!VISIBLE_STEPS.includes(step)) return null
  const idx = VISIBLE_STEPS.indexOf(step)
  return (
    <div className="flex items-center gap-2">
      {VISIBLE_STEPS.map((s, i) => (
        <div key={s} className="flex-1 flex items-center gap-2">
          <div
            className={`h-1.5 flex-1 rounded-full ${i <= idx ? 'bg-orange-600' : 'bg-muted'}`}
          />
        </div>
      ))}
      <span className="text-2xs text-muted-foreground ml-2 shrink-0">
        Step {idx + 1} of {VISIBLE_STEPS.length} — {STEP_LABELS[step]}
      </span>
    </div>
  )
}

function Card({ title, subtitle, children, footer }) {
  return (
    <div className="border rounded-xl bg-card text-card-foreground shadow-sm">
      <div className="p-6 space-y-1.5">
        {title && <h1 className="text-xl font-semibold tracking-tight">{title}</h1>}
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="px-6 pb-6 space-y-4">{children}</div>
      {footer && <div className="px-6 pb-6 pt-2 border-t">{footer}</div>}
    </div>
  )
}

// ── 0. Loading + capacity-full ───────────────────────────────────────────────

function LoadingScreen() {
  return (
    <Card title="Just a moment…" subtitle="Checking if founding-owner spots are still open.">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-orange-600" />
        Loading
      </div>
    </Card>
  )
}

function CapacityFullScreen({ capacity }) {
  const cap = capacity?.cap ?? 10
  return (
    <Card
      title="Founding owner spots are full"
      subtitle={`The first ${cap} founding spots are taken. NarrateRx is invite-only beyond founding — drop a note and you'll be first in line when the next cohort opens.`}
    >
      <a
        className="inline-flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:underline"
        href="mailto:drq@narraterx.ai?subject=Waitlist%20%E2%80%94%20NarrateRx"
      >
        Email Dr. Q to join the waitlist <ArrowRight className="h-4 w-4" />
      </a>
    </Card>
  )
}

// ── 1. Auth ───────────────────────────────────────────────────────────────────

// Default mode is 'signup' (most /onboard visitors are new). If the URL hash
// is `#signin` (e.g., from the landing page's "Sign in" link), start on the
// sign-in tab instead.
function initialAuthMode() {
  if (typeof window === 'undefined') return 'signup'
  return window.location.hash.toLowerCase().includes('signin') ? 'signin' : 'signup'
}

function AuthScreen({ capacity, onSignedIn }) {
  const { isSignedIn, isLoaded } = useUser()
  const [mode, setMode] = useState(initialAuthMode)
  const remaining = capacity?.remaining
  const showBadge = typeof remaining === 'number' && remaining > 0

  useEffect(() => {
    if (isSignedIn) onSignedIn()
  }, [isSignedIn, onSignedIn])

  return (
    <Card
      title="Create your account"
      subtitle="One account. Sign back in any time at your workspace's subdomain."
    >
      {showBadge && (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
          <Sparkles className="h-3.5 w-3.5" />
          {remaining} founding {remaining === 1 ? 'spot' : 'spots'} left · founding price locked in for life
        </div>
      )}
      {/* Clerk v6's <Show> is an authorization gate, not a boolean conditional —
          a boolean `when` falls through to the signed-out fallback and renders
          nothing, so we gate on isLoaded/isSignedIn directly. (PR fixing the
          onboarding first-screen blank state after the Core 3 upgrade.) */}
      {!isLoaded ? null : !isSignedIn ? (
        <>
        {/* "What you'll need" pre-screen so brand-new users don't bail mid-flow.
            Shown only to signed-out users — returning users skip it. */}
        {/* Read-only checklist — left-rule note, not a bordered card, so it
            reads as passive guidance rather than a tappable surface. */}
        <div className="border-l-2 border-primary/50 pl-3.5 py-0.5 text-xs space-y-1.5">
          <div className="font-semibold text-foreground inline-flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-primary" /> Before you start
          </div>
          <ul className="text-muted-foreground space-y-1">
            <li className="flex gap-2"><Check className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" /> About 5 minutes to fill in your business + voice setup</li>
            <li className="flex gap-2"><Check className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" /> Your website URL (we&apos;ll auto-extract what we can)</li>
            <li className="flex gap-2"><Check className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" /> A subdomain you want (e.g. <code className="px-1 py-0.5 rounded bg-background border text-3xs">yourclinic</code>.narraterx.ai)</li>
            <li className="flex gap-2"><Check className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" /> Logo + brand colors come later — not blocking</li>
          </ul>
        </div>
        {/* Toggle — shared pill background makes it read as a toggle, not two separate buttons */}
        <div className="inline-flex items-center rounded-full bg-muted p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={`px-3 py-1.5 rounded-full transition-colors ${mode === 'signup' ? 'bg-background text-foreground shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Sign up
          </button>
          <button
            type="button"
            onClick={() => setMode('signin')}
            className={`px-3 py-1.5 rounded-full transition-colors ${mode === 'signin' ? 'bg-background text-foreground shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Already have an account
          </button>
        </div>
        <div>
          {mode === 'signup'
            ? <SignUp routing="hash" appearance={{ elements: { rootBox: 'mx-auto', card: 'shadow-none border' } }} />
            : <SignIn routing="hash" appearance={{ elements: { rootBox: 'mx-auto', card: 'shadow-none border' } }} />}
        </div>
        </>
      ) : (
        <SignedInPrompt onContinue={onSignedIn} />
      )}
    </Card>
  )
}

function SignedInPrompt({ onContinue }) {
  const { user } = useUser()
  const { getToken } = useAuth()
  // Client-side view of the user's org memberships. Clerk hydrates this from the
  // session immediately, well before the server-side getOrganizationMembershipList
  // API (used by /api/onboarding/my-workspaces) reflects a just-accepted invite.
  // We use it to tell "membership hasn't propagated to the server yet" (poll)
  // apart from "genuinely brand-new user" (go straight to the wizard, no delay).
  const { isLoaded: orgsLoaded, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  })
  const clientMemberCount = userMemberships?.data?.length ?? 0
  const [state, setState] = useState({ status: 'loading', workspaces: [], suggested: [] })
  // One-shot guard: the poll runs exactly once per mount. Without it, the
  // paginated useOrganizationList subscription updating clientMemberCount
  // mid-poll would re-enter the effect, cancel the in-flight run, and restart
  // from attempt 0 — extending latency or settling on the wrong state.
  const startedRef = useRef(false)

  useEffect(() => {
    // Wait until Clerk's client-side membership list has loaded before deciding
    // anything. Bailing while !orgsLoaded would route a just-invited user (whose
    // memberships haven't hydrated yet) straight to the wizard. The effect
    // re-runs when orgsLoaded flips true; startedRef ensures the loop body below
    // executes only once.
    if (!orgsLoaded || startedRef.current) return
    startedRef.current = true

    // Snapshot the client membership count at start — its later mutation must
    // not affect a poll already in flight.
    const hasClientMembership = clientMemberCount > 0
    let cancelled = false

    async function fetchOnce() {
      const token = await getToken()
      const r = await fetch('/api/onboarding/my-workspaces', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) throw new Error(`status ${r.status}`)
      const data = await r.json()
      return { workspaces: data.workspaces || [], suggested: data.suggested || [] }
    }

    ;(async () => {
      // Right after accepting a Clerk org invite, the server's membership list
      // can lag the client's by a few seconds, so a single check returns zero
      // workspaces and strands the invited user in the new-tenant wizard. When
      // the client session shows the user DOES belong to an org but the server
      // hasn't caught up, poll briefly before falling through. A truly new user
      // (no client memberships) skips the poll entirely — no added latency.
      const MAX_ATTEMPTS = 6        // 1 immediate check + up to 5×1s retries ≈ 5s
      const RETRY_MS = 1000
      try {
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const { workspaces, suggested } = await fetchOnce()
          if (cancelled) return

          // Happy path: exactly one membership means we know where they belong.
          // Skip the click-through entirely — the user just accepted an org
          // invite and shouldn't have to think about "your workspace" pickers or
          // "create another workspace" buttons that historically lured them into
          // the new-tenant wizard.
          if (workspaces.length === 1) {
            setState({ status: 'redirecting', workspaces, suggested })
            window.location.href = workspaces[0].url
            return
          }

          // Multiple memberships, a domain suggestion, or a settled brand-new
          // user — nothing to wait for; show the appropriate UI.
          if (workspaces.length > 1 || suggested.length > 0) {
            setState({ status: 'done', workspaces, suggested })
            return
          }

          // workspaces.length === 0. Only keep polling if the client session
          // says the user belongs to an org the server hasn't surfaced yet.
          const shouldPoll = hasClientMembership && attempt < MAX_ATTEMPTS - 1
          if (!shouldPoll) {
            setState({ status: 'done', workspaces, suggested })
            return
          }
          await new Promise((resolve) => { setTimeout(resolve, RETRY_MS) })
          if (cancelled) return
        }
      } catch {
        // On error, fall through to the wizard — better to let them create a
        // new workspace than to strand them.
        if (!cancelled) setState({ status: 'done', workspaces: [], suggested: [] })
      }
    })()
    return () => { cancelled = true }
  }, [getToken, orgsLoaded, clientMemberCount])

  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking your workspaces…
      </div>
    )
  }

  if (state.status === 'redirecting') {
    const ws = state.workspaces[0]
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Taking you to {ws?.display_name || ws?.slug || 'your workspace'}…
      </div>
    )
  }

  const hasWorkspaces = state.workspaces.length > 0
  const hasSuggested = state.suggested.length > 0

  // Domain match found but user isn't a member yet: this is the
  // "alli@movebetter.co signing up while movebetter-people already exists"
  // path. Show "your team already has a workspace — ask the admin" and do NOT
  // offer a continue-to-wizard button. Server-side guard in /api/onboarding/claim
  // also blocks the POST, so a determined user can't bypass this UI.
  if (hasSuggested && !hasWorkspaces) {
    return (
      <div className="space-y-4 text-sm">
        <p>Signed in as <span className="font-mono text-xs">{user?.primaryEmailAddress?.emailAddress}</span>.</p>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Your team already has a workspace
          </p>
          <div className="space-y-1.5">
            {state.suggested.map(ws => (
              <div
                key={ws.slug}
                className="flex items-center justify-between gap-3 rounded-md border border-input px-3 py-2 bg-muted/30"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate" title={ws.display_name || ws.slug}>{ws.display_name || ws.slug}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">{ws.slug}.narraterx.ai</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed pt-1">
            We can&apos;t put you on this workspace automatically — your team admin needs to invite you. Ask them to add{' '}
            <span className="font-mono">{user?.primaryEmailAddress?.emailAddress}</span> from their settings, then sign in at the workspace URL above. Stuck?{' '}
            <a className="underline" href="mailto:support@narraterx.ai">support@narraterx.ai</a>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 text-sm">
      <p>Signed in as <span className="font-mono text-xs">{user?.primaryEmailAddress?.emailAddress}</span>.</p>

      {hasWorkspaces && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Your workspace{state.workspaces.length === 1 ? '' : 's'}
          </p>
          <div className="space-y-1.5">
            {state.workspaces.map(ws => (
              <a
                key={ws.slug}
                href={ws.url}
                className="flex items-center justify-between gap-3 rounded-md border border-input px-3 py-2 hover:bg-accent/30"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate" title={ws.display_name || ws.slug}>{ws.display_name || ws.slug}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate" title={`${ws.slug}.narraterx.ai`}>{ws.slug}.narraterx.ai</div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>
      )}

      <Button onClick={onContinue} variant={hasWorkspaces ? 'secondary' : 'default'}>
        {hasWorkspaces ? 'Create another workspace' : 'Continue'}
        <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  )
}

// ── 1.5 Website scan (first real step) ───────────────────────────────────────

const SCAN_STATUS_MESSAGES = [
  'Fetching your home page…',
  'Looking for services, treatments, and program pages…',
  'Reading your about and approach pages…',
  'Pulling recent blog posts and articles…',
  'Studying your voice and vocabulary…',
  'Finding your social profiles…',
  'Drafting your starter brand context…',
  'Almost done — finalizing suggestions…',
]

// Shared scanning indicator — owns its own elapsed/message timer so both the
// dedicated ScanScreen and the BusinessScreen re-scan affordance can reuse it.
function ScanningIndicator() {
  const [idx, setIdx] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const tick = setInterval(() => {
      const sec = Math.floor((Date.now() - started) / 1000)
      setElapsed(sec)
      setIdx(Math.min(Math.floor(sec / 5), SCAN_STATUS_MESSAGES.length - 1))
    }, 500)
    return () => clearInterval(tick)
  }, [])
  return (
    <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5 space-y-2">
      <div className="flex items-start gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-orange-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-orange-900">{SCAN_STATUS_MESSAGES[idx]}</p>
          <p className="text-2xs text-orange-700 mt-0.5">
            This usually takes 20–60 seconds. We&apos;re reading up to 15 pages from your site.
            {elapsed > 0 && ` (${elapsed}s elapsed)`}
          </p>
        </div>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-orange-100">
        <div className="h-full w-1/3 animate-pulse bg-orange-500 rounded-full" />
      </div>
    </div>
  )
}

const URL_LIKE = (s) => /^https?:\/\/.+\..+/.test(s.trim()) || /^[^\s]+\.[^\s]+/.test(s.trim())

// The opening step: paste a website, we scan it, and everything downstream comes
// in pre-filled. A "no website" path skips straight to the manual form. The scan
// endpoint is public, so this runs before any workspace exists.
function ScanScreen({ form, setField, scanState, runScan, onContinue }) {
  const isScanning = scanState.status === 'scanning'
  const canScan = URL_LIKE(form.website) && !isScanning

  async function handleScan() {
    const ok = await runScan()
    if (ok) onContinue()
  }

  return (
    <Card
      title="Let's start with your website"
      subtitle="Paste your site and we'll read it for you — your services, who you serve, how you write, and your social profiles — then pre-fill the rest of setup so you're mostly reviewing, not typing. Don't have a site yet? Skip it and fill in a few lines by hand."
    >
      <FieldRow label="Your website" hint="We read your home, services, about, and a few blog pages.">
        <div className="flex gap-2">
          <Input
            type="url"
            value={form.website}
            onChange={e => setField('website')(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && canScan) handleScan() }}
            placeholder="https://yourpractice.com"
            autoComplete="url"
            autoFocus
          />
          <Button type="button" onClick={handleScan} disabled={!canScan} className="shrink-0">
            {isScanning ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
            {isScanning ? 'Scanning…' : 'Scan'}
          </Button>
        </div>
      </FieldRow>

      <div className="flex gap-2.5 border-l-2 border-primary/50 pl-3 py-0.5 text-xs text-muted-foreground leading-relaxed">
        <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <span>
          The scan only drafts <strong className="text-foreground font-medium">starting points</strong> — you review and edit
          everything on the next few steps. Nothing is published or saved until you finish setup.
        </span>
      </div>

      {isScanning && <ScanningIndicator />}

      {scanState.status === 'error' && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            {scanState.error === 'fetch-failed' || scanState.error === 'invalid-url'
              ? "We couldn't load that URL. Double-check it, or skip and fill in the basics by hand."
              : 'The scan ran into a problem. You can try again, or skip and continue manually.'}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onContinue}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          I don&apos;t have a website — skip
        </button>
        <Button onClick={handleScan} disabled={!canScan}>
          {isScanning ? 'Scanning…' : 'Scan & continue'} <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  )
}

// ── 2. Business basics ───────────────────────────────────────────────────────

// Platform metadata for the social-handles section: icon, label, the URL prefix
// we build a profile link from (handles round-trip — linkedin/youtube keep their
// path prefix), and the manual-entry placeholder.
const SOCIAL_META = {
  instagram: { label: 'Instagram', Icon: Instagram, base: 'https://instagram.com/', ph: 'yourhandle' },
  facebook:  { label: 'Facebook',  Icon: Facebook,  base: 'https://facebook.com/', ph: 'YourPage' },
  linkedin:  { label: 'LinkedIn',  Icon: Linkedin,  base: 'https://linkedin.com/', ph: 'company/your-practice' },
  youtube:   { label: 'YouTube',   Icon: Youtube,   base: 'https://youtube.com/', ph: '@yourchannel' },
  tiktok:    { label: 'TikTok',    Icon: Music2,    base: 'https://tiktok.com/@', ph: 'yourhandle' },
  twitter:   { label: 'X / Twitter', Icon: Twitter, base: 'https://x.com/', ph: 'yourhandle' },
}
const SOCIAL_ORDER = ['instagram', 'facebook', 'linkedin', 'youtube', 'tiktok', 'twitter']

function SocialHandlesSection({ form, setForm, socialLookup, setSocialLookup }) {
  const setHandle = (platform, val) =>
    setForm(f => ({ ...f, social: { ...f.social, [platform]: val } }))

  const detectedCount = SOCIAL_ORDER.filter(p => (form.social[p] || '').trim()).length
  const missing = SOCIAL_ORDER.filter(p => !(form.social[p] || '').trim())
  const isSearching = socialLookup.status === 'searching'
  // We can only look profiles up if we have a name to search for.
  const canLookup = !isSearching && missing.length > 0 && form.display_name.trim().length > 1

  async function runSocialLookup() {
    setSocialLookup({ status: 'searching', error: null, candidates: {} })
    try {
      // eslint-disable-next-line narraterx/no-raw-api-fetch -- public onboarding lookup; rate-limited, not auth-gated (api/onboarding/find-socials.js)
      const r = await fetch('/api/onboarding/find-socials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: form.display_name,
          website: form.website,
          location: form.locations?.[0]
            ? [form.locations[0].city, form.locations[0].region].filter(Boolean).join(', ')
            : '',
          missing,
        }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setSocialLookup({ status: 'error', error: err.error || 'lookup-failed', candidates: {} })
        return
      }
      const data = await r.json()
      setSocialLookup({ status: 'done', error: null, candidates: data.candidates || {} })
    } catch {
      setSocialLookup({ status: 'error', error: 'network-error', candidates: {} })
    }
  }

  function acceptCandidate(platform, handle) {
    setHandle(platform, handle)
    // Drop the accepted platform's candidates so the prompt collapses.
    setSocialLookup(s => {
      const next = { ...s.candidates }
      delete next[platform]
      return { ...s, candidates: next }
    })
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Your social profiles</Label>
        {detectedCount > 0 && (
          <span className="text-2xs text-green-600 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> {detectedCount} found on your site
          </span>
        )}
      </div>
      <p className="text-2xs text-muted-foreground">
        We auto-fill any we found linked on your website. Add or fix the rest — just the handle is fine
        (no full URL needed). These let you connect one-click posting later.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SOCIAL_ORDER.map(platform => {
          const meta = SOCIAL_META[platform]
          const { Icon } = meta
          const val = form.social[platform] || ''
          return (
            <div key={platform} className="flex items-center gap-2 rounded-md border border-input px-2.5 py-1.5">
              <Icon className={`h-4 w-4 shrink-0 ${val ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className="text-2xs text-muted-foreground w-16 shrink-0">{meta.label}</span>
              <input
                value={val}
                onChange={e => setHandle(platform, e.target.value)}
                placeholder={meta.ph}
                className="flex-1 min-w-0 bg-transparent text-xs outline-none"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck="false"
              />
            </div>
          )
        })}
      </div>

      {/* "Find my profiles" — for clinics whose handles aren't linked on their
          site. Surfaces AI-found candidates to CONFIRM; never auto-saves. */}
      {missing.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={runSocialLookup} disabled={!canLookup}>
              {isSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Search className="h-3.5 w-3.5 mr-1.5" />}
              {isSearching ? 'Searching…' : 'Find my missing profiles'}
            </Button>
            {!canLookup && missing.length > 0 && form.display_name.trim().length <= 1 && (
              <span className="text-2xs text-muted-foreground">Add your business name first</span>
            )}
            {socialLookup.status === 'error' && (
              <span className="text-2xs text-destructive inline-flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" /> Couldn&apos;t search — add handles by hand
              </span>
            )}
          </div>

          {socialLookup.status === 'done' && Object.keys(socialLookup.candidates).length === 0 && (
            <p className="text-2xs text-muted-foreground">
              No confident matches found — add any handles by hand above.
            </p>
          )}

          {Object.entries(socialLookup.candidates).map(([platform, list]) => {
            if (!Array.isArray(list) || !list.length) return null
            const meta = SOCIAL_META[platform]
            if (!meta) return null
            const { Icon } = meta
            return (
              <div key={platform} className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 space-y-1.5">
                <p className="text-2xs font-medium text-orange-900 inline-flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" /> Is this your {meta.label}?
                </p>
                {list.slice(0, 3).map((c, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-2xs text-orange-900 underline truncate min-w-0"
                      title={c.url}
                    >
                      {c.handle}
                    </a>
                    <button
                      type="button"
                      onClick={() => acceptCandidate(platform, c.handle)}
                      className="shrink-0 inline-flex items-center gap-1 rounded-full bg-white border border-orange-300 px-2 py-0.5 text-2xs font-medium text-orange-800 hover:bg-orange-100"
                    >
                      <Check className="h-3 w-3" /> Yes, that&apos;s me
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function BusinessScreen({ form, setForm, setField, scanState, runScan, socialLookup, setSocialLookup, onBack, onContinue }) {
  const isScanning = scanState.status === 'scanning'
  const scanned = scanState.status === 'done'
  const canContinue = form.display_name.trim().length > 0
    && form.locations.length > 0 && form.locations[0].city.trim().length > 0
    && !isScanning
  const canScan = URL_LIKE(form.website) && !isScanning

  function updateLocation(idx, key, value) {
    setForm(f => ({
      ...f,
      locations: f.locations.map((loc, i) => i === idx ? { ...loc, [key]: value } : loc),
    }))
  }
  function addLocation() {
    setForm(f => ({ ...f, locations: [...f.locations, { label: '', city: '', region: '' }] }))
  }
  function removeLocation(idx) {
    setForm(f => ({
      ...f,
      locations: f.locations.length > 1 ? f.locations.filter((_, i) => i !== idx) : f.locations,
    }))
  }

  return (
    <Card
      title="Tell us about your business"
      subtitle={scanned
        ? "We pre-filled what we could from your website — give it a quick once-over and fix anything that's off. Nothing is locked in; you can edit all of it later in settings."
        : "A few basics — we use these to set up your workspace and make your content sound like it's genuinely from your practice, not generic AI. Nothing here is locked in; you can edit all of it later in settings."}
    >
      {scanned && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Read {scanState.sources.length} page{scanState.sources.length === 1 ? '' : 's'} from your site and pre-filled the fields below.</span>
        </div>
      )}

      <FieldRow label="Business name *" hint="What you'd put on a sign.">
        <Input value={form.display_name} onChange={e => setField('display_name')(e.target.value)} placeholder="Acme Movement" autoComplete="organization" />
      </FieldRow>
      <FieldRow label="Website" hint="Used to draft your voice and find your social profiles.">
        <div className="flex gap-2">
          <Input type="url" value={form.website} onChange={e => setField('website')(e.target.value)} placeholder="https://yourpractice.com" autoComplete="url" />
          <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={runScan} disabled={!canScan}>
            {isScanning && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {isScanning ? 'Scanning…' : scanned ? 'Re-scan' : 'Scan'}
          </Button>
        </div>
      </FieldRow>
      {isScanning && <ScanningIndicator />}

      <div className="space-y-2">
        <Label className="text-xs">Where is your practice? *</Label>
        <p className="text-2xs text-muted-foreground">
          Your city and state. We use this so your posts mention the right area
          and help nearby patients find you. The optional short name is just a
          nickname for the location (like &quot;PDX&quot;) we use as shorthand.
          Have more than one office? Add each one below.
        </p>
        <div className="space-y-2">
          {form.locations.map((loc, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-5">
                <Input
                  value={loc.city}
                  onChange={e => updateLocation(idx, 'city', e.target.value)}
                  placeholder={idx === 0 ? 'Portland' : 'Vancouver'}
                  autoComplete="address-level2"
                />
                {idx === 0 && (
                  <p className="text-3xs text-muted-foreground mt-1">City (primary)</p>
                )}
              </div>
              <div className="col-span-3">
                <Input
                  value={loc.region}
                  onChange={e => updateLocation(idx, 'region', e.target.value)}
                  placeholder={idx === 0 ? 'OR' : 'WA'}
                  autoComplete="address-level1"
                />
                {idx === 0 && (
                  <p className="text-3xs text-muted-foreground mt-1">State</p>
                )}
              </div>
              <div className="col-span-3">
                <Input
                  value={loc.label}
                  onChange={e => updateLocation(idx, 'label', e.target.value)}
                  placeholder={idx === 0 ? 'e.g. PDX' : 'e.g. Vancouver'}
                />
                {idx === 0 && (
                  <p className="text-3xs text-muted-foreground mt-1">Short name (optional)</p>
                )}
              </div>
              <div className="col-span-1 flex items-center justify-end pt-1">
                {form.locations.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLocation(idx)}
                    className="text-muted-foreground hover:text-destructive p-1"
                    aria-label="Remove location"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLocation}
          className="inline-flex items-center gap-1 text-xs text-orange-600 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add another location
        </button>
      </div>

      <SocialHandlesSection
        form={form}
        setForm={setForm}
        socialLookup={socialLookup}
        setSocialLookup={setSocialLookup}
      />

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onContinue} disabled={!canContinue}>
          Continue <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  )
}

// ── 3. Voice context ─────────────────────────────────────────────────────────

const VOICE_PLACEHOLDERS = {
  clinic_context: "We help [audience] with [outcome]. Our approach is [method]. We serve [location/region].",
  audience_short: "Active adults navigating persistent injuries",
  brand_voice: "Plain, direct, conversational. Expert without jargon. We avoid hype words and corporate-speak. We sound like a thoughtful clinician talking — not a marketer pitching.",
}

function VoiceScreen({ form, setField, scanState, onBack, onContinue }) {
  const topics = scanState?.recent_topics || []
  // Require at least "what you do" — it drives every generated post and the
  // onboarding interview context. audience_short and brand_voice are strongly
  // encouraged but skippable (the interview refines them). Without this guard
  // a tenant can click straight through and get blank-context content.
  const canContinue = form.clinic_context.trim().length >= 10
  return (
    <Card
      title="How you sound"
      subtitle="This is the most important step — it's what makes every draft sound like you and not generic AI. Don't worry about getting it perfect; you can change all of it later."
    >
      {/* Voice-fidelity promise — sets the right expectation before the user
          touches any fields. Everything generated traces back to these inputs. */}
      <div className="rounded-xl border-2 border-orange-300 bg-orange-50 px-4 py-4 flex items-start gap-3 -mt-1 shadow-sm">
        <span className="text-2xl mt-0.5 shrink-0">🎙</span>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-orange-900">
            Why this matters most
          </p>
          <p className="text-xs text-orange-900 leading-relaxed">
            Everything NarrateRx writes traces back to what you and your team actually say. The few lines below are what keep your drafts sounding like your practice — your words, your tone — instead of generic AI content. When you review a draft, you&apos;ll see exactly which phrases came from your own answers and which the AI filled in.
          </p>
        </div>
      </div>

      <FieldRow label="What you do" hint="1–3 sentences. Your method, who you serve, what makes you distinct.">
        <Textarea
          value={form.clinic_context}
          onChange={e => setField('clinic_context')(e.target.value)}
          rows={3}
          placeholder={VOICE_PLACEHOLDERS.clinic_context}
          className="text-sm"
        />
      </FieldRow>
      <FieldRow label="Audience (short)" hint="One tight phrase. ~10 words.">
        <Input
          value={form.audience_short}
          onChange={e => setField('audience_short')(e.target.value)}
          placeholder={VOICE_PLACEHOLDERS.audience_short}
        />
      </FieldRow>
      <FieldRow label="Brand voice" hint="3–5 sentences on tone, vocabulary, things you avoid.">
        <Textarea
          value={form.brand_voice}
          onChange={e => setField('brand_voice')(e.target.value)}
          rows={5}
          placeholder={VOICE_PLACEHOLDERS.brand_voice}
          className="text-sm"
        />
      </FieldRow>
      {topics.length > 0 && (
        <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5">
          <p className="text-xs font-medium text-orange-900 mb-1.5">
            We saw you write about:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {topics.map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full bg-white border border-orange-200 px-2 py-0.5 text-2xs text-orange-900"
              >
                {t}
              </span>
            ))}
          </div>
          <p className="text-2xs text-orange-700 mt-1.5">
            These are topics pulled from your blog. We&apos;ll use them later to seed post ideas — you don&apos;t need to edit anything here.
          </p>
        </div>
      )}
      {!canContinue && form.clinic_context.trim().length > 0 && (
        <p className="text-2xs text-destructive">
          Add a bit more detail about what you do (at least 10 characters).
        </p>
      )}
      <p className="text-2xs text-muted-foreground">
        You can edit all of this any time in Settings — and the quick founder
        interview after setup sharpens it for you automatically.
      </p>
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onContinue} disabled={!canContinue}>
          Continue <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  )
}

// ── 4. Subdomain ─────────────────────────────────────────────────────────────

function SubdomainScreen({ form, setField, slugCheck, setSlugCheck, onBack, onContinue }) {
  const [debounced, setDebounced] = useState(form.slug)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(form.slug), 300)
    return () => clearTimeout(t)
  }, [form.slug])

  useEffect(() => {
    if (!debounced) {
      setSlugCheck({ status: 'idle', available: null, reason: null })
      return
    }
    let cancelled = false
    setSlugCheck({ status: 'checking', available: null, reason: null })
    // eslint-disable-next-line narraterx/no-raw-api-fetch -- public slug-availability check during onboarding (api/onboarding/check-slug.js)
    fetch('/api/onboarding/check-slug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: debounced }),
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        setSlugCheck({ status: 'done', available: data.available, reason: data.reason || null })
      })
      .catch(() => {
        if (cancelled) return
        setSlugCheck({ status: 'done', available: false, reason: 'network-error' })
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const reasonText = {
    'required': 'Required',
    'too-short': 'At least 3 characters',
    'too-long': 'At most 32 characters',
    'invalid-format': 'Lowercase letters, numbers, and hyphens only',
    'reserved': 'That address is reserved',
    'taken': 'That address is taken',
    'db-error': 'Could not check — try again',
    'network-error': 'Network error — try again',
  }

  return (
    <Card
      title="Pick your private workspace address"
      subtitle="This is the web address you and your team use to sign in — like your own private login page. Patients and the public never see it. Pick something stable: it can't be changed later."
    >
      <FieldRow label="Your workspace address *">
        <div className="flex items-stretch border rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-ring">
          <input
            value={form.slug}
            onChange={e => setField('slug')(e.target.value.toLowerCase())}
            placeholder="acme-movement"
            className="flex-1 px-3 py-2 text-sm bg-transparent outline-none"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck="false"
          />
          <span className="px-3 py-2 text-sm text-muted-foreground bg-muted border-l">
            .narraterx.ai
          </span>
        </div>
        <div className="text-xs h-5 mt-1">
          {slugCheck.status === 'checking' && (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking…
            </span>
          )}
          {slugCheck.status === 'done' && slugCheck.available && (
            <span className="text-green-600 inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Available
            </span>
          )}
          {slugCheck.status === 'done' && !slugCheck.available && slugCheck.reason && (
            <span className="text-destructive inline-flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" /> {reasonText[slugCheck.reason] || slugCheck.reason}
            </span>
          )}
        </div>
      </FieldRow>
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onContinue} disabled={!slugCheck.available}>
          Continue <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  )
}

// ── 5. How you publish ───────────────────────────────────────────────────────
//
// Runs BEFORE Pick Channels. Plain-language "what tools do you already use?"
// The answers (a) tailor which integration connect-options show in onboarding +
// /settings/integrations and (b) annotate the channel picker with one-click
// badges. Nothing here blocks anyone — every group has a "not yet / I'll paste
// myself" path, and every channel still works as a clean export regardless.

function IntentOption({ selected, title, body, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition ${
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-input hover:border-primary/40 hover:bg-accent/30'
      }`}
    >
      <span className="text-sm font-medium leading-snug">{title}</span>
      <span className="text-xs text-muted-foreground leading-snug">{body}</span>
    </button>
  )
}

function IntentGroup({ icon: Icon, title, colsClass, children }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-orange-600" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className={`grid grid-cols-1 ${colsClass} gap-2.5`}>{children}</div>
    </div>
  )
}

function PublishIntentScreen({ form, setForm, onBack, onContinue }) {
  const intent = form.publish_intent || {}
  const set = (key, val) =>
    setForm(f => ({ ...f, publish_intent: { ...(f.publish_intent || {}), [key]: val } }))

  return (
    <Card
      title="How do you publish today?"
      subtitle="NarrateRx works as a clean copy-and-paste export from day one — you never need any of this. But if you tell us the tools you already use, we'll skip the ones you don't and show you exactly how to connect the ones you do. You can change all of this later in settings."
    >
      <IntentGroup icon={Globe} title="Your website — where blog posts go" colsClass="sm:grid-cols-3">
        <IntentOption selected={intent.website === 'wordpress'} onClick={() => set('website', 'wordpress')}
          title="WordPress" body="Connect via an application password." />
        <IntentOption selected={intent.website === 'astro'} onClick={() => set('website', 'astro')}
          title="Custom / Astro / static site" body="Connect via a publish webhook." />
        <IntentOption selected={intent.website === 'none'} onClick={() => set('website', 'none')}
          title="No site yet / not sure" body="Fine — blog posts still export as clean text." />
      </IntentGroup>

      <IntentGroup icon={Share2} title="Social media — Instagram, Facebook, LinkedIn, GBP…" colsClass="sm:grid-cols-2">
        <IntentOption selected={intent.social === 'buffer'} onClick={() => set('social', 'buffer')}
          title="Yes — set up one-click posting" body="We use a free tool called Buffer that posts to all your accounts at once." />
        <IntentOption selected={intent.social === 'manual'} onClick={() => set('social', 'manual')}
          title="I'll copy & paste myself for now" body="You can switch on one-click any time later." />
      </IntentGroup>

      <IntentGroup icon={Mail} title="Email newsletter" colsClass="sm:grid-cols-3">
        <IntentOption selected={intent.newsletter === 'beehiiv'} onClick={() => set('newsletter', 'beehiiv')}
          title="I use Beehiiv" body="Push drafts straight into Beehiiv." />
        <IntentOption selected={intent.newsletter === 'other'} onClick={() => set('newsletter', 'other')}
          title="Another tool / Mailchimp / none" body="Newsletters export as ready-to-send HTML to paste anywhere." />
        <IntentOption selected={intent.newsletter === 'skip'} onClick={() => set('newsletter', 'skip')}
          title="No newsletter" body="We'll hide the newsletter channel." />
      </IntentGroup>

      <div className="flex items-start gap-3 rounded-lg border border-input bg-accent/40 px-3.5 py-2.5">
        <BarChart3 className="h-4 w-4 text-info shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Optional:</strong> Connect Google Analytics later so NarrateRx can see which
          posts actually drew traffic and aim future content at what&apos;s working. Read-only — set it up in settings whenever you&apos;re ready.
        </p>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onContinue}>
          Continue <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  )
}

// ── 6. Channels ──────────────────────────────────────────────────────────────

function ChannelsScreen({ form, setForm, onBack, onContinue }) {
  function toggle(id) {
    setForm(f => {
      const has = f.enabled_outputs.includes(id)
      return {
        ...f,
        enabled_outputs: has
          ? f.enabled_outputs.filter(x => x !== id)
          : [...f.enabled_outputs, id],
      }
    })
  }
  const ok = form.enabled_outputs.length > 0
  // Per-channel icon for the graphic picker grid. Keyed by OUTPUT_CHANNELS id.
  const CHANNEL_ICON = {
    blog: FileText,
    email: Mail,
    gbp: MapPin,
    instagram_post: Instagram,
    instagram_reel: Film,
    facebook: Facebook,
    linkedin: Linkedin,
    tiktok: Music2,
    youtube_short: Youtube,
    youtube: Youtube,
    twitter: Twitter,
    threads: AtSign,
    bluesky: Cloud,
    mastodon: Globe,
    google_ads: Megaphone,
    ig_ads: Megaphone,
    landing_page: LayoutTemplate,
  }
  // Human label for the export affordance each channel produces by default.
  const EXPORT_LABEL = {
    markdown: 'Copy & paste anywhere',
    html_email: 'Copy a ready-to-send email',
    social_compose: 'Copy the caption + download the image',
  }
  // Channels whose publishMode can be upgraded to one-click publishing once an
  // integration is connected (Buffer for social/GBP, WordPress/Astro for blog,
  // newsletter for email). null publishMode = export-only by design.
  const UPGRADE_HINT = {
    buffer: 'Auto-posts once a scheduler is connected',
    website: 'Publishes to your site once connected',
    tdc: 'Sends via your newsletter once connected',
  }
  // Tailor the picker to the "How you publish" answers: hide the newsletter
  // tile if they said "no newsletter", and badge each channel whose tool they
  // told us they use as one-click-ready. No channel is hidden for lacking an
  // integration — export always works.
  const intent = form.publish_intent || {}
  const visibleChannels = Object.values(OUTPUT_CHANNELS).filter(
    c => !channelHiddenForIntent(c.id, intent)
  )
  // If they came back and a now-hidden channel is still selected, prune it so
  // we never silently enable something they opted out of.
  useEffect(() => {
    setForm(f => {
      const next = f.enabled_outputs.filter(id => !channelHiddenForIntent(id, intent))
      return next.length === f.enabled_outputs.length ? f : { ...f, enabled_outputs: next }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent.newsletter])
  return (
    <Card
      title="Pick your channels"
      subtitle="Where should your content go? Pick the formats this workspace should create — each interview drafts the ones you choose here so you're never staring at a blank page. You can change this any time in settings."
    >
      {/* Read-only notes — left-rule treatment, no full border box, so they're
          clearly passive and don't compete with the tappable channel toggles below. */}
      <div className="flex gap-2.5 border-l-2 border-primary/50 pl-3 py-0.5 text-xs text-muted-foreground leading-relaxed">
        <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <span>Every channel works as a <strong>clean export</strong> from day one — copy the caption, download the image, paste it wherever you post. Later, you can connect a <strong>social scheduling tool</strong> (we use one called Buffer) and those channels upgrade to one-click publishing.</span>
      </div>
      <div className="flex gap-2.5 border-l-2 border-border pl-3 py-0.5 text-xs text-muted-foreground leading-relaxed">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>Picking a <strong>blog or website</strong> channel? When NarrateRx publishes to your site, it fills in the SEO details for you — the page title, meta description, URL slug, and tags — so you don&apos;t have to.</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
        {visibleChannels.map(channel => {
          const checked = form.enabled_outputs.includes(channel.id)
          const upgrade = channel.publishMode ? UPGRADE_HINT[channel.publishMode] : null
          const Icon = CHANNEL_ICON[channel.id] || Globe
          const ready = channelOneClickReadyForIntent(channel.id, intent)
          return (
            <button
              type="button"
              key={channel.id}
              onClick={() => toggle(channel.id)}
              aria-pressed={checked}
              title={`${EXPORT_LABEL[channel.exportShape] || 'Copy & paste anywhere'}${upgrade ? ` · ${upgrade}` : ''}${ready ? ' · one-click ready with your connected tools' : ''}`}
              className={`group flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition ${
                checked
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-transparent bg-muted hover:bg-accent'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${checked ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
              <span className="flex-1 min-w-0 truncate text-xs font-medium leading-tight">{channel.label}</span>
              {ready && (
                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-2xs font-semibold leading-none text-primary">1-click</span>
              )}
              {checked && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Pick at least one. Once connected, a social scheduling tool (we use Buffer — a free service that pushes to all your social accounts at once) will automatically send posts to Instagram, Facebook, LinkedIn, Twitter/X, Threads, and more. You don&apos;t need any of this set up to start — export works immediately.
      </p>
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onContinue} disabled={!ok}>
          Continue <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  )
}

// ── 6. Capture setup ─────────────────────────────────────────────────────────

function CaptureScreen({ form, setField, onBack, onContinue }) {
  const { user } = useUser()

  // Pre-fill capture_name from Clerk on first render if still empty.
  useEffect(() => {
    if (!form.capture_name) {
      const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
      if (name) setField('capture_name')(name)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Your capture companion is ready</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Video capture is included for all workspaces. Add NarrateRx to your iPhone home
          screen and start capturing clips in seconds — no separate app to install.
        </p>
      </div>

      {/* How-it-works — informational, NOT interactive. Rendered as a plain
          icon+text list inside one soft panel (no per-item border) so these
          read-only steps can't be mistaken for tappable cards on the iPhone
          capture screen, where there's no hover to disambiguate. */}
      <div className="rounded-lg bg-muted/30 px-4 py-3.5">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">How it works</p>
        <ul className="space-y-3.5">
          {[
            { icon: Smartphone, label: 'Capture', body: 'Add NarrateRx to your iPhone home screen via Safari — it opens straight to the camera.' },
            { icon: Clapperboard, label: 'Drafts', body: 'Your clips turn into ready-to-review draft posts you can check each morning.' },
            { icon: CheckCircle2, label: 'Approval', body: 'Nothing publishes without your sign-off. Auto-publish is opt-in, channel by channel.' },
            { icon: Sparkles, label: 'Your voice', body: 'Drafts keep your words, your views, and your tone — and point out anything that doesn\'t sound like you before it goes out.' },
          ].map(({ icon: Icon, label, body }) => (
            <li key={label} className="flex gap-3">
              <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium leading-snug">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Capture name */}
      <div className="space-y-1.5">
        <Label htmlFor="capture-name">Your name in content</Label>
        <Input
          id="capture-name"
          value={form.capture_name}
          onChange={e => setField('capture_name')(e.target.value)}
          placeholder="e.g. Dr. Smith"
          maxLength={80}
        />
        <p className="text-xs text-muted-foreground">
          How your name appears in captions, social posts, and GBP updates.
          You can change this later from your staff profile.
        </p>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button
          onClick={onContinue}
          disabled={!form.capture_name.trim()}
        >
          Continue <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ── 7. Review ────────────────────────────────────────────────────────────────

function ReviewScreen({ form, submitting, submitError, onBack, onSubmit }) {
  const { getToken } = useAuth()
  // `submitting` (parent state) only flips inside onSubmit, which runs AFTER the
  // `await getToken()` below — leaving a window where the button is still
  // enabled. A second click in that window fires a second /claim, which is how
  // onboarding minted two Clerk orgs. Gate the whole handler on a local ref so
  // it can fire at most once until the parent resets (on error) or unmounts.
  const startingRef = useRef(false)
  const [starting, setStarting] = useState(false)
  const busy = submitting || starting
  return (
    <Card
      title="Review and create"
      subtitle="Last check. Subdomain can't be changed later — everything else is editable in settings."
    >
      <ReviewRow label="Workspace name" value={form.display_name} />
      <ReviewRow label="Subdomain" value={`${form.slug}.narraterx.ai`} mono />
      {form.website && <ReviewRow label="Website" value={form.website} />}
      {form.locations.filter(l => l.city.trim()).length > 0 && (
        <ReviewRow
          label={form.locations.filter(l => l.city.trim()).length > 1 ? 'Locations' : 'Location'}
          value={form.locations
            .filter(l => l.city.trim())
            .map(l => [l.city.trim(), l.region.trim()].filter(Boolean).join(', '))
            .join(' · ')}
        />
      )}
      {form.audience_short && <ReviewRow label="Audience" value={form.audience_short} />}
      <ReviewRow label="Channels" value={`${form.enabled_outputs.length} selected`} />
      {submitError && (
        <div className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" />
          {submitError === 'slug-taken' && 'That subdomain was just taken. Go back and pick another.'}
          {submitError === 'founding-spots-full' && 'Founding spots filled while you were filling this out. Email us to join the waitlist.'}
          {submitError === 'no-channels-selected' && 'Pick at least one channel.'}
          {submitError === 'org-create-failed' && 'Could not create your workspace org — please try again.'}
          {submitError === 'domain-registration-failed' && 'Could not register your subdomain with our hosting provider. Please try again, or email drq@narraterx.ai if it keeps failing.'}
          {submitError === 'domain-already-claimed' && 'A workspace at this domain already exists. Ask your team admin to invite you, or email support@narraterx.ai.'}
          {!['slug-taken','founding-spots-full','no-channels-selected','org-create-failed','domain-registration-failed','domain-already-claimed'].includes(submitError) && submitError}
        </div>
      )}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack} disabled={busy}>← Back</Button>
        <Button
          onClick={async () => {
            if (startingRef.current || submitting) return
            startingRef.current = true
            setStarting(true)
            try {
              const token = await getToken()
              onSubmit(token)
            } finally {
              // On success the parent advances to 'launching' and unmounts us;
              // on error it resets `submitting` and we re-enable for a retry.
              startingRef.current = false
              setStarting(false)
            }
          }}
          disabled={busy}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
          Create my workspace <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  )
}

function ReviewRow({ label, value, mono }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm border-b border-input/50 pb-2 last:border-0">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      <span className={mono ? 'font-mono' : ''}>{value}</span>
    </div>
  )
}

// ── 7. Launching ─────────────────────────────────────────────────────────────

// Probes the new subdomain via an Image load. Browsers won't resolve the host
// (or will fail TLS) until both DNS and cert provisioning complete, so a
// successful image load is a reliable signal that redirect is safe. Image
// onerror also fires on 404 — fine, since 404 means the cert is good and the
// host responded.
function LaunchingScreen({ redirectUrl }) {
  const [elapsed, setElapsed] = useState(0)
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [probeKey, setProbeKey] = useState(0)

  useEffect(() => {
    if (!redirectUrl) return
    const host = new URL(redirectUrl).host
    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 60          // 60 attempts × 1s = ~60s ceiling
    const INTERVAL_MS = 1000

    setElapsed(0)
    setTimedOut(false)

    const tick = () => {
      if (cancelled || ready) return
      attempts += 1
      setElapsed(attempts)
      const img = new Image()
      img.onload = img.onerror = () => {
        if (cancelled) return
        // onload = cert + host both good. onerror with attempts > 1 typically
        // means the cert is good but favicon doesn't exist (404) — still a
        // successful TLS handshake, so safe to redirect.
        if (attempts >= 2 || img.complete) {
          setReady(true)
        }
      }
      img.src = `https://${host}/favicon.ico?probe=${attempts}-${Date.now()}`
      if (attempts < MAX_ATTEMPTS) {
        setTimeout(tick, INTERVAL_MS)
      } else {
        // Out of attempts and still not ready — surface a clear error so the
        // user isn't stuck staring at the spinner.
        setTimeout(() => { if (!cancelled && !ready) setTimedOut(true) }, INTERVAL_MS)
      }
    }
    tick()
    return () => { cancelled = true }
  }, [redirectUrl, ready, probeKey])

  useEffect(() => {
    if (!ready || !redirectUrl) return
    const t = setTimeout(() => { window.location.href = redirectUrl }, 400)
    return () => clearTimeout(t)
  }, [ready, redirectUrl])

  if (timedOut) {
    return (
      <Card
        title="Setup is taking longer than expected"
        subtitle="Your workspace was created, but the SSL certificate for your subdomain isn't responding yet. This usually resolves in another minute or two."
      >
        <div className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" />
          Subdomain activation is taking longer than expected — try again or check your connection.
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            onClick={() => {
              setReady(false)
              setTimedOut(false)
              setProbeKey((k) => k + 1)
            }}
          >
            Retry
          </Button>
          {redirectUrl && (
            <a className="text-xs underline text-orange-600" href={redirectUrl}>
              Continue manually
            </a>
          )}
        </div>
      </Card>
    )
  }

  return (
    <Card
      title="Setting up your workspace…"
      subtitle="Provisioning your subdomain and wiring up your voice context. This usually takes 5–15 seconds."
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-orange-600" />
        <span>
          {ready
            ? `Redirecting to ${redirectUrl ? new URL(redirectUrl).host : ''}…`
            : `Waiting for SSL certificate (${elapsed}s)…`}
        </span>
      </div>
      {!ready && elapsed >= 25 && redirectUrl && (
        <p className="text-xs text-muted-foreground">
          Taking longer than usual? You can also{' '}
          <a className="underline text-orange-600" href={redirectUrl}>continue manually</a>.
        </p>
      )}
    </Card>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function FieldRow({ label, hint, children }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-2xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
