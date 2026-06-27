// Renders a brand brief (territory / not-this / emotional promise / the tension
// / visual anchors). Shared by the brand-discovery completion reveal and the
// Settings → Brand identity page so the two surfaces stay WYSIWYG. Read-only;
// editing lives on the Settings page as a separate concern.
import { X, Bookmark } from 'lucide-react'

function SectionLabel({ children }) {
  return (
    <div className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
      {children}
    </div>
  )
}

export default function BrandBriefView({ brief, hideVisualAnchors = false }) {
  if (!brief || typeof brief !== 'object') return null
  const territory = Array.isArray(brief.territory) ? brief.territory : []
  const notThis = Array.isArray(brief.notThis) ? brief.notThis : []
  const visualAnchors = (!hideVisualAnchors && Array.isArray(brief.visualAnchors)) ? brief.visualAnchors : []

  return (
    <div className="space-y-3 text-left">
      {territory.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionLabel>Territory</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {territory.map((t, i) => (
              <span
                key={i}
                className="text-sm font-semibold rounded-full px-3 py-1"
                style={{ background: 'hsl(var(--primary) / 0.10)', color: 'hsl(var(--primary))' }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {notThis.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionLabel>Not this</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {notThis.map((t, i) => (
              <span
                key={i}
                className="text-sm font-medium rounded-full px-3 py-1 inline-flex items-center gap-1"
                style={{ background: 'hsl(var(--destructive) / 0.08)', color: 'hsl(var(--destructive))' }}
              >
                <X className="h-3 w-3" aria-hidden="true" />
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {(brief.emotionalPromise || brief.tension) && (
        <div className="grid sm:grid-cols-2 gap-3">
          {brief.emotionalPromise && (
            <div className="rounded-xl border border-border bg-card p-4">
              <SectionLabel>Emotional promise</SectionLabel>
              <p className="text-sm">{brief.emotionalPromise}</p>
            </div>
          )}
          {brief.tension && (
            <div className="rounded-xl border border-border bg-card p-4">
              <SectionLabel>The tension</SectionLabel>
              <p className="text-sm">{brief.tension}</p>
            </div>
          )}
        </div>
      )}

      {visualAnchors.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionLabel>Visual anchors</SectionLabel>
          <ul className="space-y-1.5 text-sm">
            {visualAnchors.map((a, i) => (
              <li key={i} className="flex gap-2">
                <Bookmark className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" aria-hidden="true" />
                <span>
                  <span className="font-semibold">{a.reference}</span>
                  {a.why ? <span className="text-muted-foreground"> — {a.why}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
