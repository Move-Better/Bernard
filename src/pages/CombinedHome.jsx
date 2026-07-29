// CombinedHome — the / landing for an owner who is ALSO a practicing
// clinician (has their own linked staff/clinician profile). Q, 2026-07-29:
// "I am literally both a clinician and a producer as the owner. This will
// be common for single-doc clinics. Needs either a combined home screen or
// literally both screens just in scroll to each other." Chose: both screens
// stacked on one scroll, producer queue first (immediate, ranked action
// items), practice/capture content below (see .claude/decisions.md same
// date). A sticky jump-nav lets either section be reached in one click.
//
// An owner with NO linked staff row (purely administrative, never captures
// content themselves) gets ProducerHome alone — see the fork in App.jsx.
import { useUser } from '@clerk/react'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { greetingFor } from '@/components/home/helpers'
import ProducerHome from '@/pages/ProducerHome'
import Home from '@/pages/Home'

export default function CombinedHome() {
  useDocumentTitle('Home')
  const { user } = useUser()
  const ws = useWorkspace()
  const greeting = greetingFor(user, ws)

  return (
    <div className="flex flex-col gap-8 py-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">{greeting}</h1>
        <nav className="flex gap-1 text-sm font-semibold" aria-label="Jump to section">
          <a href="#your-queue" className="rounded-md px-3 py-1.5 text-primary hover:bg-primary/10">Your queue</a>
          <a href="#your-practice" className="rounded-md px-3 py-1.5 text-primary hover:bg-primary/10">Your practice</a>
        </nav>
      </div>

      <div id="your-queue" className="scroll-mt-20">
        <ProducerHome embedded />
      </div>

      <hr className="border-border" />

      <div id="your-practice" className="scroll-mt-20">
        <Home embedded />
      </div>
    </div>
  )
}
