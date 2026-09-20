// ── INSPECTOR ────────────────────────────────────────────────────────────────
export function InspectorShell({ icon: Icon, title, right, children }) {
  return (
    <>
      <div className="mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 bg-primary/[0.08]">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold text-primary">{title}</span>
        {right ? <span className="ml-auto text-3xs text-muted-foreground">{right}</span> : null}
      </div>
      {children}
    </>
  )
}

export const segBtn = (on) => on
  ? { borderColor: 'hsl(var(--primary))', background: 'hsl(var(--primary)/0.08)', color: 'hsl(var(--primary))' }
  : { borderColor: 'hsl(var(--border))' }

// Module-scope so it isn't re-created each render (react-hooks/static-components).
export function MusicToggle({ on, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-muted'}`} role="switch" aria-checked={on}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}
