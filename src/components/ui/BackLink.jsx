import { ArrowLeft } from 'lucide-react'
import { useSmartBack } from '@/lib/useSmartBack'

/**
 * Standard back-navigation affordance for the Stories → Storyboard → Publish
 * spine. One component so "go back" looks and reads the same at every step
 * (previously each page hand-rolled its own link with drifting labels and
 * styling — "Back to Stories" / "Back to Publish" / "Back to media").
 *
 * `to` is a FALLBACK, not the always-destination — when real in-app history
 * exists (the page was actually reached by navigating, not a direct link),
 * this returns to wherever the user came from via useSmartBack. `to` only
 * fires for a direct link / fresh tab with no history to go back to.
 *
 * The negative left margin keeps the text visually flush with the content
 * column while giving the hover background a comfortable hit area.
 */
export default function BackLink({ to, children, className = '' }) {
  const goBack = useSmartBack(to)
  return (
    <button
      type="button"
      onClick={goBack}
      className={`inline-flex items-center gap-1.5 -ml-2 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground ${className}`}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" />
      {children}
    </button>
  )
}
