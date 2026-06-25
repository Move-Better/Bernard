import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUpdateContentItem } from '@/lib/queries'

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

// Rewrite the first three `[ON SCREEN TEXT: …]` markers in `content` to the
// supplied hook / subhead / cta values, preserving any extra markers beyond
// the third. If the body has fewer than three markers, append the missing
// ones on their own lines so the body stays the source of truth.
export function applyOverlayToBody(content, overlay) {
  const values = [overlay.hook, overlay.subhead, overlay.cta]
  const src = typeof content === 'string' ? content : ''
  let i = 0
  let replaced = src.replace(MARKER_RE, (match) => {
    if (i >= values.length) { i++; return match }
    const next = (values[i] ?? '').trim()
    i++
    return next ? `[ON SCREEN TEXT: ${next}]` : ''
  })
  const trailing = []
  for (let j = i; j < values.length; j++) {
    const v = (values[j] ?? '').trim()
    if (v) trailing.push(`[ON SCREEN TEXT: ${v}]`)
  }
  if (trailing.length) {
    replaced = replaced.replace(/\s*$/, '') + '\n\n' + trailing.join('\n')
  }
  return replaced
}

function Field({ label, value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <label className="shrink-0 text-2xs font-medium uppercase tracking-wide text-muted-foreground w-14">
        {label}
      </label>
      <Input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs"
      />
    </div>
  )
}

/**
 * OverlayTextEditor — editable hook / subhead / cta for the Instagram
 * overlay. Saving writes the new values to `overlay_text` AND rewrites the
 * `[ON SCREEN TEXT: …]` markers in the draft body so the two stay in sync.
 */
export default function OverlayTextEditor({ piece }) {
  const stored = piece?.overlay_text || null
  const markers = useMemo(() => extractMarkerSuggestions(piece?.content), [piece?.content])
  const live = markersToOverlay(markers)

  const initial = useMemo(() => ({
    hook:    stored?.hook    || live.hook    || '',
    subhead: stored?.subhead || live.subhead || '',
    cta:     stored?.cta     || live.cta     || '',
  }), [stored?.hook, stored?.subhead, stored?.cta, live.hook, live.subhead, live.cta])

  const [draft, setDraft] = useState(initial)
  useEffect(() => { setDraft(initial) }, [initial])

  const dirty =
    draft.hook    !== initial.hook ||
    draft.subhead !== initial.subhead ||
    draft.cta     !== initial.cta

  const updateItem = useUpdateContentItem()
  const saving = updateItem.isPending

  const handleSave = async () => {
    try {
      const overlay = {
        hook:    draft.hook.trim(),
        subhead: draft.subhead.trim(),
        cta:     draft.cta.trim(),
      }
      const nextContent = applyOverlayToBody(piece.content, overlay)
      await updateItem.mutateAsync({
        id: piece.id,
        patch: { content: nextContent, overlayText: overlay },
      })
      toast.success('Saved')
    } catch (e) {
      toast.error('Save failed', { description: e.message })
    }
  }

  const handleReset = () => setDraft(initial)

  return (
    <div className="rounded-md border bg-card p-3 space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        On-screen text
      </p>
      <p className="text-2xs text-muted-foreground -mt-1">
        Edits here update the <code className="font-mono">[ON SCREEN TEXT: …]</code> markers in the draft.
      </p>
      <div className="pt-1 space-y-1.5">
        <Field label="Hook"    value={draft.hook}    onChange={(v) => setDraft((d) => ({ ...d, hook: v }))} />
        <Field label="Subhead" value={draft.subhead} onChange={(v) => setDraft((d) => ({ ...d, subhead: v }))} />
        <Field label="CTA"     value={draft.cta}     onChange={(v) => setDraft((d) => ({ ...d, cta: v }))} />
      </div>
      {dirty && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={handleReset} disabled={saving}>
            Reset
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  )
}
