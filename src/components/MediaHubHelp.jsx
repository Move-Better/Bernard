import { useEffect, useState } from 'react'
import { HelpCircle, X, Camera, Sparkles, Pencil, Upload, Send, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/Icon'

const WELCOME_KEY = 'mediahub:welcomed:v1'

// MediaHub help affordance. Two ways to surface:
//   1. First-visit auto-open (page-scoped via localStorage flag)
//   2. "?" icon next to the page title
//
// Open to everyone — clinicians, admin staff, editors — anyone who lands on
// the Media page. Content adapts to who they are by emphasising the
// shared workflow rather than role-gating sections.
export default function MediaHubHelp() {
  const [open, setOpen] = useState(false)

  // First-visit auto-open.
  useEffect(() => {
    try {
      const seen = localStorage.getItem(WELCOME_KEY)
      if (!seen) {
        setOpen(true)
        localStorage.setItem(WELCOME_KEY, new Date().toISOString())
      }
    } catch { /* empty */ }
  }, [])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
        title="How the Media Hub works"
        aria-label="Help"
      >
        <Icon as={HelpCircle} size="sm" />
        <span>How it works</span>
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="Help" className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-background rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
              <h2 className="font-semibold text-sm">Media Hub — how it works</h2>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setOpen(false)}><Icon as={X} size="md" aria-hidden="true" /></Button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
              {/* Recall hint — surfaced first so it's seen before users scroll. */}
              <div className="rounded-md border-2 border-primary/40 bg-primary/5 p-3 flex items-start gap-2.5">
                <BookOpen className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-semibold text-foreground">You can come back to this guide anytime.</p>
                  <p className="text-muted-foreground mt-0.5">
                    Look for the <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary font-medium"><Icon as={HelpCircle} size="xs" />How it works</span> button at the top of the Media Hub page, just below the title. Click it any time you need a refresher.
                  </p>
                </div>
              </div>

              <p className="text-muted-foreground">
                Raw clinic footage and finished edits live here together. Bernard suggests what each clip could become; your editor cuts, captions, and brand-wraps the good ones in the built-in editor, then attaches them to posts in Content Hub.
              </p>

              <ol className="space-y-3">
                <Step icon={<Icon as={Camera} size="md" />} num={1} title="Capture in clinic">
                  Film 30–90s treatment moments, demos, or explanations — anything where something specific is taught or shown. Get patient consent for anything that&apos;ll go public.
                </Step>
                <Step icon={<Icon as={Upload} size="md" />} num={2} title="Upload">
                  Drop files into the uploader above and pick who&apos;s speaking — Clinician, Admin staff, or Patient guest. Bernard tags and transcribes within ~60s.
                </Step>
                <Step icon={<Icon as={Sparkles} size="md" />} num={3} title="Review AI briefs">
                  Bernard surfaces 1–5 edit briefs per clip, each with a draft caption, suggested platform, and source quote. Accept the strong ones, reject the rest.
                </Step>
                <Step icon={<Icon as={Pencil} size="md" />} num={4} title="Add one AI missed">
                  Spotted a moment AI didn&apos;t surface? Open the clip and click &quot;New brief&quot; to add your own caption, platform, and source range.
                </Step>
                <Step icon={<Icon as={Pencil} size="md" />} num={5} title="Edit in Bernard">
                  Open an accepted brief&apos;s clip in the built-in editor to cut, caption, brand-wrap, and add music — no external app. The brief waits in the queue.
                </Step>
                <Step icon={<Icon as={Upload} size="md" />} num={6} title="Save or publish">
                  The editor saves the finished clip to your Library and can publish it straight to a post — or click &quot;Upload final&quot; to attach it back to the brief.
                </Step>
                <Step icon={<Icon as={Send} size="md" />} num={7} title="Reuse in Content Hub">
                  Finished media is reusable — the same clip can power a Reel today and a newsletter banner next month. Attach it from the Library tab in any post&apos;s media picker.
                </Step>
              </ol>

              <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
                <div className="font-medium">Patient consent</div>
                <p className="text-muted-foreground">
                  Every clinic-capture clip involves a patient on camera or audible. Verify written or recorded consent before publishing anything that includes them. The brief detail panel surfaces a reminder on every patient-involved source.
                </p>
              </div>

              <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
                <div className="font-medium">For staff</div>
                <p className="text-muted-foreground">
                  You&apos;ll see this page if you&apos;re curious or want to flag a clip for the team. Browse, search by patient pseudonym or condition, and add a note on a clip if you spot something the team should turn into content. Your editor handles the editing side.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end px-5 py-3 border-t shrink-0">
              <Button size="sm" onClick={() => setOpen(false)}>Got it</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Step({ icon, num, title, children }) {
  return (
    <li className="flex gap-3">
      <div className="shrink-0 h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
        {num}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium">
          {icon}
          <span>{title}</span>
        </div>
        <p className="text-muted-foreground mt-0.5">{children}</p>
      </div>
    </li>
  )
}
