import { Link } from 'react-router-dom'
import { PhoneCall, Mic, ArrowRight, CalendarClock } from 'lucide-react'

/**
 * WeeklyCallHero — F1 Phase A. The call-first Home hero.
 *
 * Promotes the realtime voice interview ("Live Interview", /new/live-interview)
 * from a buried Beta tile to Home's primary call-to-action. Rendered by Home
 * ONLY when the workspace has realtime_voice_enabled (so non-enabled tenants
 * keep today's "Start an interview" ribbon CTA with no broken link). The full
 * capture picker stays one click away via "All capture modes".
 *
 * "Schedule your call" (Phase B) and "Bernard calls you" (Phase C, outbound
 * telephony) aren't built yet — shown as explicit dashed "Coming soon" chips
 * below the primary CTA so they read as upcoming features, not broken/disabled
 * controls, without spending equal visual weight on unshipped features.
 *
 * @param {number|null} lastOwnCallAt - epoch ms of the current user's most
 *   recent completed interview, or null. Drives the "N days since your last"
 *   nudge; omitted when the user has never completed one.
 * @param {{days:number, gaps:Array<{id:string,topic:string}>}|null} restock -
 *   Moments IA ⑤ (mockup §04): the restock nudge, computed by
 *   restockNudgeState() — non-null ONLY while the workspace has started
 *   capturing AND runway is under 2 weeks. Null renders nothing new: no
 *   badge, no email, no recurring nag — the line simply exists while true.
 */
export default function WeeklyCallHero({ lastOwnCallAt = null, restock = null }) {
  const days =
    lastOwnCallAt != null
      ? Math.floor((Date.now() - lastOwnCallAt) / (24 * 60 * 60 * 1000))
      : null

  return (
    <div className="nx-card-hi p-6 md:p-7">
      <div className="flex items-start gap-5 flex-wrap">
        <div className="h-16 w-16 rounded-2xl nx-grad flex items-center justify-center shrink-0">
          <PhoneCall className="h-7 w-7 text-primary-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="nx-eyebrow">Your weekly call</span>
            {days != null && (
              <span className="nx-pill nx-pill-action-solid">
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
          {restock && (
            <div className="mb-4 max-w-xl rounded-r-lg border-l-2 border-action bg-action/[0.07] px-3 py-2">
              <p className="text-3xs font-bold uppercase tracking-wider text-action">Running low</p>
              <p className="mt-0.5 text-xs text-foreground">
                About <b>{restock.days} day{restock.days === 1 ? '' : 's'}</b> of content on hand.
                A 20-minute conversation restocks roughly a month.
              </p>
              {restock.gaps.length > 0 && (
                <p className="mt-1 text-2xs text-muted-foreground">
                  Patients keep asking about {restock.gaps.slice(0, 3).map((g) => g.topic).join(', ')} — nothing on hand yet.
                </p>
              )}
            </div>
          )}
          <div className="flex items-center gap-2.5 flex-wrap">
            <Link
              to="/new/live-interview"
              className="nx-btn-primary inline-flex items-center gap-2 px-5 py-3 text-base"
            >
              <Mic className="h-4 w-4" aria-hidden="true" />
              Start your weekly call
            </Link>
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            <Link
              to="/new"
              className="inline-flex items-center gap-1 hover:text-primary"
            >
              Prefer to type or upload? All capture modes
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
          {/* Unshipped features (scheduled + outbound calls) shown as explicit
              "coming soon" chips — dashed, tagged, non-interactive — so they read
              as upcoming rather than broken/disabled controls. */}
          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground/60">Coming soon</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-2xs text-muted-foreground/70">
              <CalendarClock className="h-3 w-3" aria-hidden="true" /> Schedule your call
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-2xs text-muted-foreground/70">
              <PhoneCall className="h-3 w-3" aria-hidden="true" /> Bernard calls you
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
