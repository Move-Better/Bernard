import { useEffect, useRef } from 'react'
import { X, Move } from 'lucide-react'
import { BLOCK_ROLES } from '@/lib/overlayTemplates'
import { ROLE_META, richRunsToHTML, serializeRichCE, runsHaveStyle, sanitizeRun } from './shared'

// ── Block row ─────────────────────────────────────────────────────────────────
//
// The left-panel Text box is a NEUTRAL words editor — it never paints the chosen
// display colour onto its own text. That's the way mature editors (Canva, Figma,
// Google Slides) handle it: colour is only ever shown against its true background,
// so it lives on the canvas (double-click a block → the on-canvas rich editor) and
// in the Style panel's swatches, never on a stand-in field that can happen to match
// the colour and swallow the text. Painting colour here white-on-white made typed
// text vanish (Feedback 8727193a).
//
// IMPORTANT: per-word colour is still RENDERED into the DOM (richRunsToHTML emits
// the inline `color:` spans) so that colours set on the canvas survive a text edit
// here — serializeRichCE reads them back off `node.style.color`. Only the *display*
// is neutralised, via `[&_*]:!text-foreground` (a stylesheet !important rule, which
// overrides the inline colour for painting but leaves `el.style.color` intact for
// serialization). Strip the colour from the DOM instead and every text edit would
// silently wipe the block's per-word colours.

export default function BlockRow({ block, onChange, onRemove }) {
  const meta = ROLE_META[block.role] || ROLE_META.body
  const ceRef = useRef(null)
  const initRef = useRef(false)
  const suppressRef = useRef(false)

  // Initialise contenteditable once on mount from block data
  useEffect(() => {
    if (initRef.current || !ceRef.current) return
    initRef.current = true
    ceRef.current.innerHTML = richRunsToHTML(block.runs, block.text)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync from EXTERNAL text changes (e.g. the on-canvas inline editor) when
  // this field isn't focused — keeps the side panel in step without clobbering
  // active typing here.
  useEffect(() => {
    const el = ceRef.current
    if (!el || !initRef.current || document.activeElement === el) return
    const html = richRunsToHTML(block.runs, block.text)
    if (el.innerHTML !== html) el.innerHTML = html
  }, [block.text, block.runs])

  function serializeAndSync() {
    if (suppressRef.current) return
    const el = ceRef.current
    if (!el) return
    // Rich serialize (all per-word dims), so editing text here NEVER drops
    // per-word colour/size/weight/italic/underline/strike/case set on the canvas
    // — the old colour-only serialize would have silently clobbered them.
    const runs = serializeRichCE(el)
    const text = runs.map((r) => r.text).join('')
    const result = { ...block, text }
    if (runsHaveStyle(runs)) result.runs = runs.map(sanitizeRun)
    else delete result.runs
    onChange(result)
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border bg-background/50 p-3">
      <div className="flex-1 min-w-0">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <select
            value={block.role}
            onChange={(e) => onChange({ ...block, role: e.target.value })}
            aria-label="Text block role"
            className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${meta.chip} border border-transparent cursor-pointer`}
          >
            {BLOCK_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_META[r]?.label || r}</option>
            ))}
          </select>
          <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive" aria-label="Delete block">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div
          ref={ceRef}
          contentEditable
          suppressContentEditableWarning
          onInput={serializeAndSync}
          onPaste={(e) => {
            e.preventDefault()
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
          }}
          // [&_*]:!text-foreground neutralises the DISPLAY colour of every run so
          // the words stay legible regardless of the chosen colour — the colour is
          // still in the DOM (see the header note) and shown truthfully on the canvas.
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground [&_*]:!text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 empty:before:text-muted-foreground/50 empty:before:content-[attr(data-placeholder)]"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '2.5rem' }}
          data-placeholder={`${meta.label} text…`}
        />
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Move className="h-4 w-4 shrink-0" /> Drag the text on the canvas to place it. Pick colours on the canvas or in Style below.
        </p>
      </div>
    </div>
  )
}
