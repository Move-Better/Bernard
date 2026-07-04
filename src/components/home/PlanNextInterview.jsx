import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, ChevronDown } from 'lucide-react'

// "What to talk about next" — merged surface for patient question gaps.
// Shows high-search topics with no content yet, filterable by patient archetype.
// Props:
//   gaps              — array of { topic, priority } from getSuggestedTopics
//   isEmpty           — true when no interviews exist yet (changes copy)
//   prototypes        — array of { id, label, emoji, description }
//   activePrototypeId — currently selected archetype id (or null for all)
//   onPrototypeChange — setter for activePrototypeId
//   compact           — collapse to a one-line summary + expand toggle, used
//                        whenever a hero card already owns the page's primary
//                        attention (see Home.jsx heroState)
export default function PlanNextInterview({
  gaps,
  isEmpty = false,
  prototypes = [],
  activePrototypeId = null,
  onPrototypeChange,
  compact = false,
}) {
  const [expanded, setExpanded] = useState(false)
  // Hide the chip strip when the workspace hasn't defined any archetypes —
  // prototypesUi always returns at least one "All patients" sentinel, so
  // "no archetypes" means length <= 1.
  const showChips = prototypes.length > 1 && typeof onPrototypeChange === 'function'

  // Parent renders this whenever unfiltered gaps > 0, so we may legitimately
  // be called with gaps=[] when the active filter excludes everything. In
  // that case keep the card up so the user can clear the filter.
  const filteredEmpty = gaps.length === 0

  // Archetype grouping (D3): when no chip filter is active and the workspace
  // has real archetypes that actually tag some gaps, organize topics UNDER the
  // patient prototype that generates them ("For your XC-ski patients → …")
  // rather than a flat list. The patient population becomes the organizing
  // logic — "filling gaps for the people I see" — not an abstract calendar.
  // The sentinel "all patients" prototype has id === null, so real archetypes
  // are those with a non-null id. Falls back to the flat list + chips whenever
  // gaps carry no archetype tags (e.g. fresh tenants, custom topics).
  const realPrototypes = prototypes.filter((p) => p.id != null)
  const someTagged = gaps.some((g) => Array.isArray(g.prototypes) && g.prototypes.length > 0)
  const grouped = showChips && activePrototypeId == null && realPrototypes.length > 0 && someTagged

  const groups = grouped
    ? (() => {
        const buckets = realPrototypes.map((p) => ({ proto: p, items: [] }))
        const universal = { proto: null, items: [] }
        for (const g of gaps) {
          const tags = Array.isArray(g.prototypes) ? g.prototypes : []
          const b = buckets.find((x) => tags.includes(x.proto.id))
          ;(b || universal).items.push(g)
        }
        const out = buckets.filter((x) => x.items.length)
        if (universal.items.length) out.push(universal)
        return out
      })()
    : null

  if (compact && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground hover:bg-accent/30 transition-colors"
      >
        <span className="flex-1 min-w-0 text-left truncate">
          {isEmpty
            ? 'Pick a high-impact topic for your first interview'
            : `${gaps.length} topic ${gaps.length === 1 ? 'gap' : 'gaps'} found for your patients`}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-0.5 h-5 rounded-none bg-primary shrink-0" aria-hidden="true" />
            <h2 className="text-base font-bold tracking-tight text-foreground">
              {isEmpty ? 'Start with a high-impact topic' : 'What to talk about next'}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 pl-2.5">
            {isEmpty
              ? 'High-search topics in your area — pick one to kick off your first interview.'
              : 'Questions patients are searching — no content from you yet'}
          </p>
        </div>
        {showChips && !grouped && (
          <div className="flex flex-wrap gap-1 items-center shrink-0">
            {prototypes.map((p) => {
              const active = activePrototypeId === p.id
              return (
                <button
                  key={String(p.id)}
                  type="button"
                  onClick={() => onPrototypeChange(p.id)}
                  title={p.description || p.label}
                  className={`inline-flex items-center gap-1 text-2xs px-2.5 py-1 rounded-full border transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-accent border-primary/30 text-accent-foreground hover:bg-accent/80'
                  }`}
                >
                  {p.emoji && <span>{p.emoji}</span>}
                  {p.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Topic list */}
      {filteredEmpty ? (
        <p className="px-5 py-4 text-xs text-muted-foreground italic">
          No high-priority gaps for this group. Clear the filter to see all topics.
        </p>
      ) : grouped ? (
        // Grouped by patient archetype — the population is the organizing logic.
        <div className="divide-y divide-border">
          {groups.map((grp) => (
            <div key={grp.proto ? String(grp.proto.id) : 'all'} className="py-1.5">
              <div className="flex items-center gap-1.5 px-5 pt-2 pb-1">
                {grp.proto?.emoji && <span aria-hidden="true">{grp.proto.emoji}</span>}
                <span className="text-2xs font-bold uppercase tracking-wide text-primary">
                  {grp.proto ? `For your ${grp.proto.label} patients` : 'For all patients'}
                </span>
              </div>
              <ul>
                {grp.items.map((t) => (
                  <li key={t.topic}>
                    <Link
                      to={`/new?topic=${encodeURIComponent(t.topic)}`}
                      className="flex items-center gap-3 px-5 py-2.5 hover:bg-accent/30 transition-colors group"
                    >
                      <Plus className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 group-hover:text-primary transition-colors" aria-hidden="true" />
                      <span className="text-sm text-foreground flex-1 min-w-0">{t.topic}</span>
                      <span className="text-2xs text-muted-foreground/60 shrink-0 hidden sm:inline">
                        {t.priority === 'high' ? 'high demand' : t.priority === 'medium' ? 'medium' : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {gaps.map((t) => (
            <li key={t.topic}>
              <Link
                to={`/new?topic=${encodeURIComponent(t.topic)}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-accent/30 transition-colors group"
              >
                <Plus className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 group-hover:text-primary transition-colors" aria-hidden="true" />
                <span className="text-sm text-foreground flex-1 min-w-0">{t.topic}</span>
                <span className="text-2xs text-muted-foreground/60 shrink-0 hidden sm:inline">
                  {t.priority === 'high' ? 'high demand' : t.priority === 'medium' ? 'medium' : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
