import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Mic, MessageSquareText, Link as LinkIcon, FileText, Camera, Mail, PenSquare, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useSmartBack } from '@/lib/useSmartBack'
import { useWorkspace } from '@/lib/WorkspaceContext'

/**
 * CapturePicker — entry point at /new. One start (a call with Bernard), then
 * the other ways to add underneath (simplicity audit C, 2026-11-10). The
 * sidebar's "Talk to Bernard" skips this page; "Other ways to add" lands here.
 *
 *   /new              → this picker
 *   /new/interview    → existing NewInterview form (AI-led chat)
 *   /new/voice-memo   → quick voice recording (new in Phase 1)
 *   /new/seminar      → long-talk upload (Phase 2, disabled today)
 *
 * Query params (e.g. ?topic=, ?topicBacklogId=) are forwarded to whichever
 * mode the user picks so deep links from suggestions / backlog still work.
 */
export default function CapturePicker() {
  useDocumentTitle('Start something')
  const navigate = useNavigate()
  const goBack = useSmartBack('/')
  const [searchParams] = useSearchParams()
  const workspace = useWorkspace()
  // Patient handouts lane (Phase 5 Feature 4) — gated on per-workspace
  // patient_handouts_enabled flag. Default false; on for workspaces
  // actively dogfooding the in-clinic handout workflow.
  const handoutsEnabled = workspace?.patient_handouts_enabled === true
  const realtimeEnabled = workspace?.realtime_voice_enabled === true

  // Preserve any incoming query params (?topic=…, ?topicBacklogId=…) when
  // routing into the chosen mode — these come from suggestion links and
  // topic-backlog cards.
  const qs = searchParams.toString()
  const suffix = qs ? `?${qs}` : ''

  function go(path) {
    navigate(`${path}${suffix}`)
  }

  // Probe WebRTC + mic availability WITHOUT requesting permission.
  // Returns false if HTTPS is missing, RTCPeerConnection is absent, media API
  // is absent, or the microphone permission was previously denied. Any other
  // uncertainty resolves to true — the real mic prompt happens inside PhoneCall.
  async function supportsLiveInterview() {
    try {
      if (!window.isSecureContext) return false
      if (!window.RTCPeerConnection) return false
      if (!navigator.mediaDevices?.getUserMedia) return false
      const perm = await navigator.permissions.query({ name: 'microphone' })
      return perm.state !== 'denied'
    } catch {
      return !!(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia)
    }
  }

  async function handleInterviewClick() {
    if (realtimeEnabled && (await supportsLiveInterview())) {
      go('/new/live-interview')
    } else {
      go('/new/interview')
    }
  }

  // The other ways to add, below the call. Order follows use: posts and
  // photos are the next most common after the call (90-day counts in
  // .claude/simplicity-audit-2026-11-09.md, item C).
  const otherWays = [
    { key: 'post', path: '/new/brief', icon: PenSquare, tone: 'action', label: 'Write a post', hint: 'Announcements, promotions, quick shares' },
    // "Record from your phone" used to be its own bar here; it opened this
    // same page, so the two are one row now.
    { key: 'media', path: '/capture', icon: Camera, label: 'Add photos or video', hint: 'Upload from any device, or record from your phone' },
    { key: 'import', path: '/new/import', icon: LinkIcon, label: 'Import writing', hint: 'Paste a link to something you\u2019ve written' },
    // The text interview was only reachable after the live call failed.
    { key: 'text', path: '/new/interview', icon: MessageSquareText, label: 'Type instead of talking', hint: 'The same interview, as a text chat' },
    { key: 'newsletter', path: '/new/newsletter', icon: Mail, label: 'Write a newsletter', hint: 'Pick a goal and talk it through' },
    { key: 'memo', path: '/new/voice-memo', icon: Mic, label: 'Voice memo', hint: 'Hit record, say what happened, save' },
    // Gated on workspace.patient_handouts_enabled (Phase 5 Feature 4).
    ...(handoutsEnabled
      ? [{ key: 'handout', path: '/new/handout', icon: FileText, label: 'Patient handout', hint: 'Say what just happened; Bernard writes a one-page handout', beta: true }]
      : []),
  ]

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={goBack} aria-label="Back">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Start something</h1>
      </div>

      {/* The one start: a call with Bernard. supportsLiveInterview() checks
          capability silently before navigating, so no mic prompt fires here,
          and a browser that can't do the live call gets the text chat. */}
      <Card className="border-primary/25">
        <CardContent className="p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-7">
          <div className="h-14 w-14 shrink-0 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
            <Mic className="h-7 w-7" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight">Talk to Bernard</h2>
            <p className="text-sm sm:text-base text-muted-foreground max-w-xl">
              Pick a topic and Bernard asks the questions. What you say becomes this week&apos;s posts, blogs and clips.
            </p>
          </div>
          <Button size="lg" onClick={handleInterviewClick} className="w-full sm:w-auto shrink-0 gap-2">
            <Mic className="h-4 w-4" aria-hidden="true" />
            Start a call
          </Button>
        </CardContent>
      </Card>

      <section className="space-y-2.5" aria-labelledby="other-ways-heading">
        <h2 id="other-ways-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Other ways
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {otherWays.map(({ key, path, icon: Icon, tone, label, hint, beta }) => (
            <button
              key={key}
              type="button"
              onClick={() => go(path)}
              className="flex items-center gap-3.5 min-h-16 rounded-lg border bg-card px-4 py-3 text-left transition hover:border-primary hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className={`h-8 w-8 shrink-0 rounded-md flex items-center justify-center ${tone === 'action' ? 'bg-action/10 text-action' : 'bg-primary/10 text-primary'}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {label}
                  {beta && (
                    <span className="text-3xs font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border text-muted-foreground">Beta</span>
                  )}
                </span>
                <span className="block text-sm text-muted-foreground">{hint}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
