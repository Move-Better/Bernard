// Segmented single-choice row — label + a row of mutually-exclusive pills.
// Used across the text-style controls (Weight / Font / Align / Text effect).
export default function SegRow({ label, options, value, onPick }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex gap-1.5">
        {options.map((o) => {
          const active = value === o.value || (value == null && o.value == null)
          return (
            <button
              key={o.label}
              type="button"
              onClick={() => onPick(o.value)}
              className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
