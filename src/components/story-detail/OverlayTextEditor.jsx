import { useMemo } from 'react'

// Pull `[ON SCREEN TEXT: ...]` lines out of a draft body. The atom prompts
// emit these markers; we surface them as the rendered overlay text.
const MARKER_RE = /\[ON\s*SCREEN\s*TEXT:\s*([^\]]+)\]/gi

export function extractMarkerSuggestions(content) {
  if (typeof content !== 'string') return []
  const out = []
  let m
  while ((m = MARKER_RE.exec(content)) !== null) {
    const line = m[1].trim()
    if (line) out.push(line)
  }
  return out
}

export function markersToOverlay(markers) {
  return {
    hook:    markers[0] || '',
    subhead: markers[1] || '',
    cta:     markers[2] || '',
  }
}

function Row({ label, value }) {
  if (!value) return null
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 text-2xs font-medium uppercase tracking-wide text-muted-foreground w-14">{label}</span>
      <span className="text-xs text-foreground/90 break-words">{value}</span>
    </div>
  )
}

/**
 * OverlayTextEditor — read-only display of the Instagram overlay (hook /
 * subhead / cta) derived from `[ON SCREEN TEXT: …]` markers in the draft body.
 *
 * The body is the single source of truth: ContentEditor.handleSave parses
 * markers and writes `overlay_text` alongside `content`. Edit the body to
 * change the overlay. This panel is intentionally non-interactive — the
 * earlier hook/subhead/cta inputs duplicated the body markers and routinely
 * drifted out of sync.
 */
export default function OverlayTextEditor({ piece }) {
  const stored = piece?.overlay_text || null
  const markers = useMemo(() => extractMarkerSuggestions(piece?.content), [piece?.content])

  // Prefer stored overlay, fall back to live-parsed markers.
  const live = markersToOverlay(markers)
  const hook    = stored?.hook    || live.hook
  const subhead = stored?.subhead || live.subhead
  const cta     = stored?.cta     || live.cta

  if (!hook && !subhead && !cta) return null

  return (
    <div className="rounded-md border bg-card p-3 space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        On-screen text
      </p>
      <p className="text-2xs text-muted-foreground -mt-1">
        Auto-derived from <code className="font-mono">[ON SCREEN TEXT: …]</code> markers in the draft. Edit the body to change.
      </p>
      <div className="pt-1 space-y-1">
        <Row label="Hook"    value={hook} />
        <Row label="Subhead" value={subhead} />
        <Row label="CTA"     value={cta} />
      </div>
    </div>
  )
}
