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
    <aside className="flex w-[58px] shrink-0 flex-col border-r bg-card py-1" style={{ borderColor: 'hsl(var(--border))' }}>
      {items.map(({ key, icon: Icon, label }) => {
        const on = active === key
        return (
          <button
            key={key}
            onClick={() => onPick(key)}
            className="flex w-full flex-col items-center gap-1 py-2.5"
            style={{ borderLeft: `2px solid ${on ? 'hsl(var(--primary))' : 'transparent'}`, background: on ? 'hsl(var(--primary)/0.07)' : undefined }}
            title={label}
          >
            <Icon className="h-4 w-4" style={{ color: on ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }} />
            <span className="text-3xs" style={{ color: on ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}>{label}</span>
          </button>
        )
      })}
    </aside>
  )
}
