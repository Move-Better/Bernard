import { useEffect, useRef, useState } from 'react'
import {
  TEXT_COLORS,
  richRunsToHTML,
  serializeRichCE,
  runsHaveStyle,
  richFlagsAt,
  wrapSelectionInSpan,
  unwrapIfBare,
  RICH_SIZE_STEPS,
  RICH_CASES,
  RICH_CASE_CSS,
  RICH_FONTS,
  RICH_FONT_CSS,
} from './shared'

// The on-canvas inline rich-text editor. Double-click a block → this replaces
// its canvas text (suppressed while editing) and shows a Canva-style selection
// toolbar for per-word font / size / colour / B·I·U·S / case. Serializes to
// block.runs on every change so the canvas + publish bake stay WYSIWYG.
export default function RichTextEditOverlay({ block, idx, baseStyle, onCommit, onDone }) {
  const ceRef = useRef(null)
  const toolbarRef = useRef(null)
  const savedRangeRef = useRef(null)
  const initRef = useRef(false)
  const [tb, setTb] = useState(null)
  const [flags, setFlags] = useState({})

  useEffect(() => {
    const el = ceRef.current
    if (!el || initRef.current) return
    initRef.current = true
    el.innerHTML = richRunsToHTML(block.runs, block.text)
    el.focus()
    const sel = window.getSelection()
    const r = document.createRange()
    r.selectNodeContents(el); r.collapse(false)
    sel.removeAllRanges(); sel.addRange(r)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function commit() {
    const el = ceRef.current
    if (!el) return
    const runs = serializeRichCE(el)
    const text = runs.map((r) => r.text).join('')
    onCommit(idx, { text, runs: runsHaveStyle(runs) ? runs : null })
  }
  function showToolbar() {
    const el = ceRef.current
    const sel = window.getSelection()
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim() || !el.contains(sel.anchorNode)) {
      setTb(null); return
    }
    savedRangeRef.current = sel.getRangeAt(0).cloneRange()
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    setTb({ top: Math.max(8, rect.top - 46), left: Math.max(8, Math.min(rect.left + rect.width / 2 - 150, window.innerWidth - 308)) })
    setFlags(richFlagsAt(el))
  }
  function restoreRange() {
    const r = savedRangeRef.current
    if (!r) return
    const sel = window.getSelection()
    sel.removeAllRanges(); sel.addRange(r.cloneRange())
  }
  function styleSel(mutator) {
    const el = ceRef.current
    if (!el) return
    restoreRange()
    const span = wrapSelectionInSpan()
    if (!span) return
    mutator(span)
    unwrapIfBare(span)
    el.focus()
    commit()
    requestAnimationFrame(showToolbar)
  }
  function bumpSize(dir) {
    const cur = richFlagsAt(ceRef.current).scale || 1
    let i = RICH_SIZE_STEPS.reduce((best, s, k) => (Math.abs(s - cur) < Math.abs(RICH_SIZE_STEPS[best] - cur) ? k : best), 0)
    i = Math.max(0, Math.min(RICH_SIZE_STEPS.length - 1, i + dir))
    const v = RICH_SIZE_STEPS[i]
    styleSel((s) => { if (v === 1) s.style.fontSize = ''; else s.style.fontSize = `${v}em` })
  }
  function cycleCase() {
    const cur = richFlagsAt(ceRef.current).case || 'none'
    const next = RICH_CASES[(RICH_CASES.indexOf(cur) + 1) % RICH_CASES.length]
    styleSel((s) => {
      if (next === 'none') { s.style.textTransform = ''; delete s.dataset.case }
      else { s.style.textTransform = RICH_CASE_CSS[next]; s.dataset.case = next }
    })
  }
  function cycleFont() {
    const cur = richFlagsAt(ceRef.current).font || 'default'
    const next = RICH_FONTS[(RICH_FONTS.indexOf(cur) + 1) % RICH_FONTS.length]
    styleSel((s) => {
      if (next === 'default') { s.style.fontFamily = ''; delete s.dataset.font }
      else { s.style.fontFamily = RICH_FONT_CSS[next]; s.dataset.font = next }
    })
  }
  function toggleDeco(which) {
    const fl = richFlagsAt(ceRef.current)
    const u = which === 'u' ? !fl.underline : !!fl.underline
    const st = which === 's' ? !fl.strike : !!fl.strike
    const parts = [u && 'underline', st && 'line-through'].filter(Boolean)
    styleSel((s) => { s.style.textDecorationLine = parts.join(' ') || 'none' })
  }
  const btn = (active) => `flex h-7 min-w-[26px] items-center justify-center rounded px-1 text-sm font-semibold transition-colors ${active ? 'bg-primary/15 text-primary' : 'text-foreground/80 hover:bg-muted'}`
  const stopMouse = (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault() }
  const fontLabel = flags.font && flags.font !== 'default' ? flags.font[0].toUpperCase() + flags.font.slice(1, 4) : 'Aa'

  return (
    <>
      <div
        ref={ceRef}
        contentEditable
        suppressContentEditableWarning
        onPointerDown={(e) => e.stopPropagation()}
        onInput={() => { commit(); showToolbar() }}
        onMouseUp={() => setTimeout(showToolbar, 0)}
        onKeyUp={showToolbar}
        onBlur={() => setTimeout(() => {
          if (toolbarRef.current?.contains(document.activeElement)) return
          commit(); onDone()
        }, 160)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); onDone() }
          else if (e.key === 'Escape') { commit(); onDone() }
        }}
        className="w-full rounded px-1 text-lg outline-none"
        style={baseStyle}
        aria-label="Edit text — highlight a word to style it"
      />
      {tb && (
        <div
          ref={toolbarRef}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={stopMouse}
          className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-lg"
          style={{ top: tb.top, left: tb.left }}
        >
          <button onClick={cycleFont} className={btn(!!flags.font && flags.font !== 'default')} title="Font" style={{ minWidth: 34 }}>{fontLabel}</button>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          <button onClick={() => bumpSize(-1)} className={btn(false)} title="Smaller">−</button>
          <button onClick={() => bumpSize(1)} className={btn(false)} title="Bigger">+</button>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          <button onClick={() => styleSel((s) => { s.style.fontWeight = richFlagsAt(ceRef.current).bold ? '400' : '800' })} className={btn(flags.bold === true)} title="Bold" style={{ fontWeight: 800 }}>B</button>
          <button onClick={() => styleSel((s) => { s.style.fontStyle = richFlagsAt(ceRef.current).italic ? 'normal' : 'italic' })} className={btn(flags.italic === true)} title="Italic" style={{ fontStyle: 'italic' }}>I</button>
          <button onClick={() => toggleDeco('u')} className={btn(flags.underline === true)} title="Underline" style={{ textDecoration: 'underline' }}>U</button>
          <button onClick={() => toggleDeco('s')} className={btn(flags.strike === true)} title="Strikethrough" style={{ textDecoration: 'line-through' }}>S</button>
          <button onClick={cycleCase} className={btn(!!flags.case)} title="Case">aA</button>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          {TEXT_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => styleSel((s) => { s.style.color = c.value })}
              className={`h-5 w-5 shrink-0 rounded-full border ${flags.color?.toLowerCase() === c.value.toLowerCase() ? 'ring-2 ring-primary' : 'border-border'}`}
              style={{ background: c.value }}
              title={c.label}
              aria-label={`Colour ${c.label}`}
            />
          ))}
        </div>
      )}
    </>
  )
}
