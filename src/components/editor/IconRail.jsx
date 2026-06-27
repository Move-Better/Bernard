// IconRail — the shared left-edge tool rail for the unified editor shell. One
// presentational strip of icon+label buttons; each editor supplies its own
// section list (per the archetype's railFor()), the active key, and the pick
// handler. Extracted from VideoEditor's v3 rail so both editors render one
// consistent rail instead of two bespoke ones.
//
// items : [{ key, icon: Component, label }]
// active: the currently-selected key (string)
// onPick: (key) => void
export default function IconRail({ items, active, onPick }) {
  return (
    <aside className="flex w-[58px] shrink-0 flex-col border-r border-border bg-card py-1">
      {items.map(({ key, icon: Icon, label }) => {
        const on = active === key
        return (
          <button
            key={key}
            aria-label={label}
            onClick={() => onPick(key)}
            className={`flex w-full flex-col items-center gap-1 border-l-2 py-2.5 ${on ? 'border-primary bg-primary/7' : 'border-transparent'}`}
            title={label}
          >
            <Icon className={`h-4 w-4 ${on ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden="true" />
            <span className={`text-3xs ${on ? 'text-primary' : 'text-muted-foreground'}`}>{label}</span>
          </button>
        )
      })}
    </aside>
  )
}
