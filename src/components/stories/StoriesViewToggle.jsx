import { useSearchParams } from 'react-router-dom'

const VIEWS = [
  { key: 'cards',    label: 'Cards' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'themes',   label: 'Themes' },
]

/**
 * Segmented control that reads/writes `?view=` in the URL.
 * Default (no param) falls back to the `defaultView` prop so the highlighted
 * pill matches what the page actually renders.
 */
export default function StoriesViewToggle({ defaultView = 'cards' }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const current = searchParams.get('view') || defaultView

  function setView(key) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('view', key)
      return next
    }, { replace: true })
  }

  return (
    <div role="tablist" aria-label="Stories view" className="inline-flex items-center bg-muted border border-border rounded-xl p-1 gap-0.5">
      {VIEWS.map(({ key, label }) => {
        const isActive = current === key
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => setView(key)}
            className={
              isActive
                ? 'px-3 py-1.5 text-sm font-semibold text-foreground bg-card shadow-sm rounded-lg transition-all ring-1 ring-border/60'
                : 'px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg transition-all'
            }
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
