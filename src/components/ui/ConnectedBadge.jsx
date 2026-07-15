import { CheckCircle2 } from 'lucide-react'

// Solid "connected" state chip — the single source for connected-state badges
// on integration surfaces (Settings → Integrations, Apple Insights card).
// `upper` renders the compact uppercase card-header tag; default renders the
// icon row chip used in account/location lists.
export default function ConnectedBadge({ upper = false, children = 'Connected' }) {
  if (upper) {
    return (
      <span className="text-3xs uppercase tracking-wide font-bold bg-success text-success-foreground px-2 py-0.5 rounded shadow-sm">
        {children}
      </span>
    )
  }
  return (
    <span className="text-2xs inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded bg-success text-success-foreground shadow-sm">
      <CheckCircle2 className="h-3.5 w-3.5" />
      {children}
    </span>
  )
}
