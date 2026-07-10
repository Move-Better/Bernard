import { TEXT_COLORS } from './shared'

// Floating contextual toolbar — appears above (or below, near the top edge) the
// selected text block, carrying the PRIMARY per-element controls (font · weight ·
// italic · align · colour). Advanced controls (size, width, underline, role) stay
// in the side panel. `stop` swallows pointerdown so clicking the toolbar doesn't
// start a drag on the block box beneath it.
export default function FloatingTextToolbar({ block, idx, below, onSetStyle, stop }) {
  const btn = (active) => `flex h-7 min-w-[26px] items-center justify-center rounded px-1 text-sm font-semibold transition-colors ${active ? 'bg-primary/15 text-primary' : 'text-foreground/80 hover:bg-muted'}`
  const set = (k, v) => (e) => { e.stopPropagation(); onSetStyle(idx, k, v) }
  const div = <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
  return (
    <div
      onPointerDown={stop}
      className={`absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-lg ${below ? 'top-full mt-2' : 'bottom-full mb-2'}`}
    >
      <button onPointerDown={stop} onClick={set('font', block.font === 'body' ? 'heading' : 'body')} className={btn(false)} title="Toggle font">{block.font === 'body' ? 'Body' : 'Head'}</button>
      {div}
      <button onPointerDown={stop} onClick={set('fontWeight', block.fontWeight === '700' ? null : '700')} className={btn(block.fontWeight === '700')} title="Bold" style={{ fontWeight: 800 }}>B</button>
      <button onPointerDown={stop} onClick={set('italic', block.italic ? null : true)} className={btn(block.italic === true)} title="Italic" style={{ fontStyle: 'italic' }}>I</button>
      {div}
      <button onPointerDown={stop} onClick={set('align', 'left')} className={btn(block.align === 'left')} title="Align left" aria-label="Align left">⇤</button>
      <button onPointerDown={stop} onClick={set('align', null)} className={btn(!block.align || block.align === 'center')} title="Align center" aria-label="Align center">⇔</button>
      <button onPointerDown={stop} onClick={set('align', 'right')} className={btn(block.align === 'right')} title="Align right" aria-label="Align right">⇥</button>
      {div}
      {TEXT_COLORS.slice(0, 3).map((c) => (
        <button key={c.value} onPointerDown={stop} onClick={set('color', c.value)} title={c.label} aria-label={`Colour ${c.label}`}
          className={`h-5 w-5 rounded-full border ${block.color === c.value ? 'ring-2 ring-primary' : 'border-border'}`} style={{ background: c.value }} />
      ))}
    </div>
  )
}
