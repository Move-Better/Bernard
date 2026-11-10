// "See Bernard as" — lets an owner look at the producer or team-member screen
// (Q, 2026-11-09). Renders nothing for anyone who is not an owner. Changes only
// what is drawn; permissions stay the owner's.
import { useExperience, setViewAs } from '@/lib/useExperience'
import { EXPERIENCE_OWNER, EXPERIENCE_PRODUCER, EXPERIENCE_TEAM } from '@/lib/experience'

const OPTIONS = [
  { value: EXPERIENCE_OWNER, label: 'Owner' },
  { value: EXPERIENCE_PRODUCER, label: 'Producer' },
  { value: EXPERIENCE_TEAM, label: 'Team member' },
]

const LABEL = { [EXPERIENCE_PRODUCER]: 'a producer', [EXPERIENCE_TEAM]: 'a team member' }

export function ViewAsSwitch() {
  const { actual, experience } = useExperience()
  if (actual !== EXPERIENCE_OWNER) return null
  return (
    <div role="group" aria-label="See Bernard as" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-muted-foreground">See Bernard as</span>
      <div className="flex gap-0.5 rounded-lg border border-border bg-muted p-0.5">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={experience === o.value}
            onClick={() => setViewAs(o.value === EXPERIENCE_OWNER ? null : o.value)}
            className={`min-h-9 rounded-md px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              experience === o.value ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Shown on every page while an owner is looking as another role, so the way back is never lost. */
export function ViewAsBanner() {
  const { actual, experience } = useExperience()
  if (actual !== EXPERIENCE_OWNER || experience === EXPERIENCE_OWNER) return null
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm sm:px-6 lg:px-8">
      <span className="font-semibold text-foreground">You are seeing Bernard as {LABEL[experience]}.</span>
      <span className="text-muted-foreground">Your own data, their screen. Your permissions are still the owner&rsquo;s.</span>
      <button
        type="button"
        onClick={() => setViewAs(null)}
        className="ml-auto min-h-9 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Back to owner view
      </button>
    </div>
  )
}
