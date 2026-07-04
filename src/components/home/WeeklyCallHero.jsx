import { Link } from 'react-router-dom'
import { PhoneCall, Mic, CalendarClock, PhoneOutgoing, ArrowRight } from 'lucide-react'

/**
 * WeeklyCallHero — F1 Phase A. The call-first Home hero.
 *
 * Promotes the realtime voice interview ("Live Interview", /new/live-interview)
 * from a buried Beta tile to Home's primary call-to-action. Rendered by Home
 * ONLY when the workspace has realtime_voice_enabled (so non-enabled tenants
 * keep today's "Start an interview" ribbon CTA with no broken link). The full
 * capture picker stays one click away via "All capture modes".
 *
 * "Schedule it" and "Have Bernard call me" are seeded as disabled affordances —
 * they're Phase B (scheduling) and Phase C (outbound telephony). Shown so the
 * weekly-ritual intent reads, disabled so nothing is a dead click.
 *
 * @param {number|null} lastOwnCallAt - epoch ms of the current user's most
 *   recent completed interview, or null. Drives the "N days since your last"
 *   nudge; omitted when the user has never completed one.
 */
export default function WeeklyCallHero({ lastOwnCallAt = null }) {
  const days =
    lastOwnCallAt != null
      ? Math.floor((Date.now() - lastOwnCallAt) / (24 * 60 * 60 * 1000))
      : null

  return (
    <div className="rounded-[14px] border border-primary/30 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-18px_rgba(12,117,128,0.22)] p-6 md:p-7">
      <div className="flex items-start gap-5 flex-wrap">
        <div className="h-16 w-16 rounded-2xl nx-grad flex items-center justify-center shrink-0">
          <PhoneCall className="h-7 w-7 text-primary-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="nx-eyebrow">Your weekly call</span>
            {days != null && (
              <span className="nx-pill nx-pill-amber">
                {days <= 0
                  ? 'today'
                  : `${days} day${days === 1 ? '' : 's'} since your last`}
              </span>
            )}
          </div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight mb-1">
            Six minutes is your whole week.
          </h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-xl">
            Talk to Bernard about what you saw this week. When you hang up, your
            blog, social posts, carousels and email are already drafting — in
            your voice.
          </p>
          <div className="flex items-center gap-2.5 flex-wrap">
            <Link
              to="/new/live-interview"
              className="nx-btn-primary inline-flex items-center gap-2 px-5 py-3 text-base"
            >
              <Mic className="h-4 w-4" aria-hidden="true" />
              Start your weekly call
            </Link>
            <button
              type="button"
              disabled
              title="Coming soon"
              className="nx-btn-secondary inline-flex items-center gap-2 px-4 py-3 text-sm opacity-60 cursor-not-allowed"
            >
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              Schedule it
              <span className="nx-pill nx-pill-ink">Soon</span>
            </button>
            <button
              type="button"
              disabled
              title="Coming soon"
              className="nx-btn-secondary inline-flex items-center gap-2 px-4 py-3 text-sm opacity-60 cursor-not-allowed"
            >
              <PhoneOutgoing className="h-4 w-4" aria-hidden="true" />
              Have Bernard call me
              <span className="nx-pill nx-pill-ink">Soon</span>
            </button>
          </div>
          <div className="mt-3">
            <Link
              to="/new"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              Prefer to type or upload? All capture modes
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
