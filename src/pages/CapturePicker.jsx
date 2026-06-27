import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Mic, MessageSquareText, Presentation, Link as LinkIcon, FileText, Camera, Zap, Mail, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useWorkspace } from '@/lib/WorkspaceContext'

/**
 * CapturePicker — entry point at /new. Asks the user which capture mode they
 * want before sending them down the dedicated flow.
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
  useDocumentTitle('New')
  const navigate = useNavigate()
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New</h1>
          <p className="text-sm text-muted-foreground">
            What would you like to capture today?
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Interview — voice-first (live) with automatic text fallback when
            WebRTC or mic permission is unavailable. supportsLiveInterview()
            checks capability silently before navigating; no mic prompt fires
            here. The text path (/new/interview) is also reachable directly
            from the fallback link inside PhoneCall if the call fails to start. */}
        <button
          type="button"
          onClick={handleInterviewClick}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        >
          <Card className="h-full transition hover:border-primary hover:shadow-sm">
            <CardContent className="p-5 space-y-3">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <MessageSquareText className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium">Interview</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Bernard-led conversation. Best when you want to think out loud
                  about a topic and let prompts surface your thinking.
                </p>
              </div>
            </CardContent>
          </Card>
        </button>

        {/* Brief — written message → multi-channel posts, no interview required */}
        <button
          type="button"
          onClick={() => go('/new/brief')}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        >
          <Card className="h-full transition hover:border-primary hover:shadow-sm">
            <CardContent className="p-5 space-y-3">
              <div className="h-10 w-10 rounded-md bg-action/10 text-action flex items-center justify-center">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium">Brief</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Write it yourself — event announcements, promotions, updates. Bernard adapts your words for each channel.
                </p>
              </div>
            </CardContent>
          </Card>
        </button>

        {/* Write a newsletter — goal-steered conversation → email draft */}
        <button
          type="button"
          onClick={() => go('/new/newsletter')}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        >
          <Card className="h-full transition hover:border-primary hover:shadow-sm">
            <CardContent className="p-5 space-y-3">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium">Write a newsletter</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Pick a goal, talk it through, and we&apos;ll write the newsletter
                  in your voice — ready for your email template.
                </p>
              </div>
            </CardContent>
          </Card>
        </button>

        {/* Voice Memo — new in Phase 1 */}
        <button
          type="button"
          onClick={() => go('/new/voice-memo')}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        >
          <Card className="h-full transition hover:border-primary hover:shadow-sm">
            <CardContent className="p-5 space-y-3">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <Mic className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium">Voice memo</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Quick capture. Hit record, say what happened, save. For real
                  moments between patients or end-of-day reflections.
                </p>
              </div>
            </CardContent>
          </Card>
        </button>

        {/* Photos & Video — universal browser capture page (PWA). Routes to
            /capture, which resolves the signed-in staff id internally via
            useSelfStaffId (no params needed). This is the discoverable in-app
            entry point for the capture page, which otherwise was only reachable
            by direct URL or the StaffProfile help link. */}
        <button
          type="button"
          onClick={() => go('/capture')}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        >
          <Card className="h-full transition hover:border-primary hover:shadow-sm">
            <CardContent className="p-5 space-y-3">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <Camera className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium">Photos &amp; video</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Snap or upload photos and clips from any device — phone,
                  tablet, or computer. For in-clinic moments and b-roll.
                </p>
              </div>
            </CardContent>
          </Card>
        </button>

        {/* Patient handout — Phase 5 Feature 4. Gated on
            workspace.patient_handouts_enabled. Hidden entirely for
            workspaces that haven't been opted in. */}
        {handoutsEnabled && (
        <button
          type="button"
          onClick={() => go('/new/handout')}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        >
          <Card className="h-full transition hover:border-primary hover:shadow-sm">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                  <FileText className="h-5 w-5" />
                </div>
                <span className="text-3xs font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border text-muted-foreground">
                  Beta
                </span>
              </div>
              <div>
                <div className="font-medium">Patient handout</div>
                <p className="text-sm text-muted-foreground mt-1">
                  After a visit, say what just happened. Bernard writes a one-page handout in your voice.
                </p>
              </div>
            </CardContent>
          </Card>
        </button>
        )}

        {/* Import writing — URL import lane */}
        <button
          type="button"
          onClick={() => go('/new/import')}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        >
          <Card className="h-full transition hover:border-primary hover:shadow-sm">
            <CardContent className="p-5 space-y-3">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <LinkIcon className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium">Import writing</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Paste a URL from your blog or any article you&apos;ve written.
                  We pull the text and turn it into fresh content.
                </p>
              </div>
            </CardContent>
          </Card>
        </button>
      </div>

      {/* iOS Shortcut — links to the full /capture page which hosts the
          token-generation flow and install instructions. */}
      <button
        type="button"
        onClick={() => go('/capture')}
        className="w-full flex items-center gap-3 rounded-lg border border-dashed border-border bg-transparent px-4 py-3 text-left hover:border-primary/40 hover:bg-primary/5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Zap className="h-4 w-4 text-primary shrink-0" />
        <div>
          <p className="text-sm font-medium">Get iOS Shortcut</p>
          <p className="text-xs text-muted-foreground">Native 4K · one tap · no browser</p>
        </div>
      </button>

      {/* Seminar / Talk — Phase 2 placeholder. Visible-but-disabled so users
          know it's coming; prevents the picker from looking incomplete. */}
      <div>
        <div
          className="rounded-lg border border-dashed bg-muted/30 p-4 flex items-start gap-3 opacity-70"
          aria-disabled="true"
        >
          <div className="h-10 w-10 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0">
            <Presentation className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-foreground">Seminar / Talk <span className="ml-2 text-xs font-normal text-muted-foreground">— coming soon</span></div>
            <p className="text-sm text-muted-foreground mt-1">
              Upload a long recording (45+ min) from a seminar or public talk.
              Pipeline extracts chapters, audience Q&A, and ready-to-publish
              pieces. Available shortly after the June 25 capture.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
