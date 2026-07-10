import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Move } from 'lucide-react'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { ColorPickerPopover } from '@/components/ColorPickerPopover'
import { brandSwatches } from '@/lib/brandSwatches'
import { BLOCK_ROLES } from '@/lib/overlayTemplates'
import { ROLE_META, richRunsToHTML, serializeRichCE, runsHaveStyle, sanitizeRun } from './shared'

// ── Block row ─────────────────────────────────────────────────────────────────

export default function BlockRow({ block, onChange, onRemove }) {
  const meta = ROLE_META[block.role] || ROLE_META.body
  const workspace = useWorkspace()
  const ceRef = useRef(null)
  const [toolbarPos, setToolbarPos] = useState(null)
  const savedRangeRef = useRef(null)
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
    // per-word size/weight/italic/underline/strike/case set on the canvas — the
    // old colour-only serialize would have silently clobbered them.
    const runs = serializeRichCE(el)
    const text = runs.map((r) => r.text).join('')
    const result = { ...block, text }
    if (runsHaveStyle(runs)) result.runs = runs.map(sanitizeRun)
    else delete result.runs
    onChange(result)
  }

  function checkSelection() {
    const sel = window.getSelection()
    const el = ceRef.current
    if (!sel || sel.isCollapsed || !sel.toString().trim() || !el?.contains(sel.anchorNode)) {
      setToolbarPos(null); return
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    const mid = rect.left + rect.width / 2
    setToolbarPos({ top: rect.top - 52, left: Math.max(8, Math.min(mid - 130, window.innerWidth - 268)) })
  }

  function applyColor(color) {
    const sel = window.getSelection()
    if (savedRangeRef.current) { sel.removeAllRanges(); sel.addRange(savedRangeRef.current.cloneRange()) }
    ceRef.current?.focus()
    document.execCommand('styleWithCSS', false, true) // emit <span style="color:…">, which serializeRichCE reads
    document.execCommand('foreColor', false, color)
    savedRangeRef.current = null
    serializeAndSync()
    setToolbarPos(null)
  }

  function clearColor() {
    const sel = window.getSelection()
    if (savedRangeRef.current) { sel.removeAllRanges(); sel.addRange(savedRangeRef.current.cloneRange()) }
    ceRef.current?.focus()
    document.execCommand('removeFormat', false, null)
    savedRangeRef.current = null
    serializeAndSync()
    setToolbarPos(null)
  }

  const bSwatches = useMemo(() => brandSwatches(workspace), [workspace])

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

        {/* Floating colour toolbar — fixed above the text selection */}
        {toolbarPos && (
          <div
            className="fixed z-50 flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1.5 shadow-xl"
            style={{ top: toolbarPos.top, left: toolbarPos.left }}
            onMouseDown={(e) => {
              const sel = window.getSelection()
              if (sel && sel.rangeCount > 0 && sel.toString().trim()) {
                savedRangeRef.current = sel.getRangeAt(0).cloneRange()
              }
              // Prevent focus steal for all children except the ColorPickerPopover trigger
              if (!e.target.closest('[data-picker-trigger]')) e.preventDefault()
            }}
          >
            {bSwatches.length > 0 && (
              <span className="pr-0.5 text-3xs font-semibold uppercase tracking-wider text-zinc-500">Brand</span>
            )}
            {bSwatches.slice(0, 5).map((color) => (
              <button
                key={color} type="button" aria-label={color} onClick={() => applyColor(color)}
                className="h-5 w-5 rounded-full border border-zinc-600 transition-all hover:ring-2 hover:ring-white/40 hover:ring-offset-1"
                style={{ background: color }}
              />
            ))}
            {bSwatches.length > 0 && <span className="mx-0.5 h-4 w-px bg-zinc-700" />}
            {['#FFFFFF', '#000000'].map((c) => (
              <button
                key={c} type="button" aria-label={c === '#FFFFFF' ? 'White' : 'Black'} onClick={() => applyColor(c)}
                className="h-5 w-5 rounded-full border border-zinc-600 transition-all hover:ring-2 hover:ring-white/40 hover:ring-offset-1"
                style={{ background: c }}
              />
            ))}
            <span className="mx-0.5 h-4 w-px bg-zinc-700" />
            <button
              type="button" onClick={clearColor}
              className="px-1 text-3xs font-medium text-zinc-400 transition-colors hover:text-white"
            >Clear</button>
            <span data-picker-trigger>
              <ColorPickerPopover
                value="#888888"
                onChange={applyColor}
                swatches={bSwatches}
                swatchClassName="h-5 w-5 rounded-full"
                ariaLabel="Custom colour"
              />
            </span>
          </div>
        )}

        <div
          ref={ceRef}
          contentEditable
          suppressContentEditableWarning
          onInput={serializeAndSync}
          onMouseUp={checkSelection}
          onKeyUp={checkSelection}
          onBlur={() => { setTimeout(() => setToolbarPos(null), 150) }}
          onPaste={(e) => {
            e.preventDefault()
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
          }}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/50 empty:before:text-muted-foreground/50 empty:before:content-[attr(data-placeholder)]"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '2.5rem' }}
          data-placeholder={`${meta.label} text…`}
        />
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Move className="h-4 w-4 shrink-0" /> Drag the text on the canvas to place it. Highlight text to pick a colour.
        </p>
      </div>
    </div>
  )
}
