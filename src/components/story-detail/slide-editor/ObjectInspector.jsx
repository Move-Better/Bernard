import { BadgeCheck, Trash2 } from 'lucide-react'

// ── Object inspector (WS3.1) — logo/watermark controls ───────────────────────
export default function ObjectInspector({ slide, objIdx, onChange, onRemoved }) {
  const obj = (slide.objects || [])[objIdx]
  if (!obj) return null
  function update(patch) {
    const objects = (slide.objects || []).slice()
    objects[objIdx] = { ...obj, ...patch }
    onChange({ ...slide, objects })
  }
  function remove() {
    const objects = (slide.objects || []).slice()
    objects.splice(objIdx, 1)
    const next = { ...slide }
    if (objects.length) next.objects = objects
    else delete next.objects
    onChange(next)
    onRemoved?.()
  }
  const CORNERS = [
    { label: 'TL', x: 0.14, y: 0.12 }, { label: 'TR', x: 0.86, y: 0.12 },
    { label: 'Center', x: 0.5, y: 0.5 },
    { label: 'BL', x: 0.14, y: 0.9 }, { label: 'BR', x: 0.86, y: 0.9 },
  ]
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5" style={{ background: 'hsl(var(--primary)/.08)' }}>
        <BadgeCheck className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold text-primary">Logo / watermark</span>
        <button type="button" onClick={remove} className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive" title="Remove" aria-label="Remove logo">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-3">
        <img src={obj.src} alt="Logo" className="mx-auto max-h-14 w-auto" style={{ opacity: obj.opacity ?? 1 }} />
      </div>

      <div>
        <div className="mb-1 flex justify-between text-sm text-muted-foreground"><span>Size</span><span>{Math.round((obj.scale ?? 0.16) * 100)}%</span></div>
        <input type="range" min="6" max="60" step="1" value={Math.round((obj.scale ?? 0.16) * 100)}
          onChange={(e) => update({ scale: parseInt(e.target.value, 10) / 100 })}
          className="h-5 w-full accent-primary" aria-label="Logo size" />
      </div>
      <div>
        <div className="mb-1 flex justify-between text-sm text-muted-foreground"><span>Opacity</span><span>{Math.round((obj.opacity ?? 1) * 100)}%</span></div>
        <input type="range" min="20" max="100" step="1" value={Math.round((obj.opacity ?? 1) * 100)}
          onChange={(e) => update({ opacity: parseInt(e.target.value, 10) / 100 })}
          className="h-5 w-full accent-primary" aria-label="Logo opacity" />
      </div>
      <div>
        <p className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Position</p>
        <div className="flex gap-1.5">
          {CORNERS.map((c) => (
            <button key={c.label} type="button" onClick={() => update({ x: c.x, y: c.y })}
              className="flex-1 rounded-lg border border-border bg-muted/30 px-1 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
              {c.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">Or drag it anywhere on the slide — it snaps to the centre, edges, and your text.</p>
      </div>
    </div>
  )
}
