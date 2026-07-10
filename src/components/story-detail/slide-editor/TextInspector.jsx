import { useEffect, useState } from 'react'
import { Type } from 'lucide-react'
import BlockRow from './BlockRow'
import TextStyleControls from './TextStyleControls'
import { paletteFromImage } from './imageSampling'

// ── TEXT inspector body — single block via the shared BlockRow ───────────────

export default function TextInspector({ slide, blockIdx, photoUrl, onChange, onRemoved, onCenter }) {
  const block = slide.blocks[blockIdx]
  const [photoPalette, setPhotoPalette] = useState([])
  useEffect(() => {
    let live = true
    if (!photoUrl) { setPhotoPalette([]); return }
    paletteFromImage(photoUrl).then((p) => { if (live) setPhotoPalette(p) })
    return () => { live = false }
  }, [photoUrl])
  if (!block) return null
  function updateBlock(next) {
    const blocks = slide.blocks.slice()
    blocks[blockIdx] = next
    onChange({ ...slide, blocks })
  }
  function setStyle(key, val) {
    const next = { ...block }
    if (val == null || val === '' || (key === 'fontScale' && val === 1)) delete next[key]
    else next[key] = val
    updateBlock(next)
  }
  function removeBlock() {
    const blocks = slide.blocks.slice()
    blocks.splice(blockIdx, 1)
    onChange({ ...slide, blocks })
    if (onRemoved) onRemoved()
  }
  function alignBlock(h, v) {
    const cur = (typeof block.position === 'object' && block.position) ? block.position : { x: 0.5, y: 0.5 }
    updateBlock({ ...block, position: { x: h ? 0.5 : cur.x, y: v ? 0.5 : cur.y } })
    onCenter?.()
  }
  const alignBtnCls = 'flex h-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary'
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5" style={{ background: 'hsl(var(--primary)/.08)' }}>
        <Type className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold text-primary">Text layer</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => alignBlock(true, false)} title="Center horizontally" className={`${alignBtnCls} w-8`} aria-label="Center horizontally">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5"/><rect x="2" y="5" width="10" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
          <button type="button" onClick={() => alignBlock(false, true)} title="Center vertically" className={`${alignBtnCls} w-8`} aria-label="Center vertically">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5"/><rect x="5" y="2" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
          <button type="button" onClick={() => alignBlock(true, true)} title="Center on canvas" className={`${alignBtnCls} gap-1 px-2.5 text-sm font-semibold text-primary`} style={{ borderColor: 'hsl(var(--primary)/.35)', background: 'hsl(var(--primary)/.06)' }} aria-label="Center on canvas">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><line x1="6" y1="0" x2="6" y2="12" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5"/><line x1="0" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5"/><circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>
            Center
          </button>
        </div>
      </div>
      <BlockRow
        block={block}
        onChange={updateBlock}
        onRemove={removeBlock}
      />
      <TextStyleControls block={block} onSet={setStyle} photoPalette={photoPalette} />
    </div>
  )
}
