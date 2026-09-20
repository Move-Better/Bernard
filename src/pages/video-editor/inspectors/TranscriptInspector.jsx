import { fmt } from '../constants'
import { InspectorShell } from '../shared'
import { FILLERS, fillerKey, inCut, silenceRanges, totalCutCli } from '../cuts'
import { FileText, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function TranscriptInspector({ ctx }) {
  const { words, cuts, toggleWordCut, editWord, logCaptionCorrection, addCuts, clearCuts, durationSec, genCaptions, genCaptionsPending } = ctx
  const kept = Math.max(0, durationSec - totalCutCli(cuts, durationSec))
  const fillers = words.filter((w) => FILLERS.has(fillerKey(w.word)) && !inCut((w.start + w.end) / 2, cuts))
  const sils = silenceRanges(words, durationSec).filter((r) => !inCut((r.start + r.end) / 2, cuts))
  // Which word is being corrected inline (index into `words`), and a click timer
  // so a single click cuts while a double-click opens the editor (without the
  // single-click cut firing first).
  const [editingIdx, setEditingIdx] = useState(null)
  const clickTimerRef = useRef(null)
  useEffect(() => () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current) }, [])
  const onWordClick = (w) => {
    if (clickTimerRef.current) return
    clickTimerRef.current = setTimeout(() => { clickTimerRef.current = null; toggleWordCut(w) }, 210)
  }
  const onWordDbl = (i) => {
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null }
    setEditingIdx(i)
  }
  const commitEdit = (w, value, save) => {
    setEditingIdx(null)
    if (save) { editWord(w, value); logCaptionCorrection(w.word, value, 'word') }
  }
  return (
    <InspectorShell icon={FileText} title="Transcript" right={`${fmt(kept)} kept`}>
      {words.length === 0 ? (
        <>
          <p className="mb-2 text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>No transcript yet — generate captions first, then cut words here.</p>
          <button onClick={genCaptions} disabled={genCaptionsPending} className="flex w-full items-center justify-center gap-1.5 rounded-md border py-2 text-2xs disabled:opacity-60" style={{ borderColor: 'hsl(var(--action))', background: 'hsl(var(--action)/0.06)', color: 'hsl(var(--action))' }}>
            {genCaptionsPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Transcribing…</> : <><Sparkles className="h-3.5 w-3.5" />Generate captions</>}
          </button>
        </>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <button onClick={() => addCuts(fillers.map((w) => ({ start: w.start, end: w.end })))} disabled={!fillers.length} className="flex items-center gap-1 rounded-md border px-2 py-1 text-3xs disabled:opacity-40" style={{ borderColor: 'hsl(var(--border))' }}><span className="h-2 w-2 rounded-full" style={{ background: 'hsl(var(--action))' }} />Remove {fillers.length} fillers</button>
            <button onClick={() => addCuts(sils)} disabled={!sils.length} className="flex items-center gap-1 rounded-md border px-2 py-1 text-3xs disabled:opacity-40" style={{ borderColor: 'hsl(var(--border))' }}><span className="h-2 w-2 rounded-full" style={{ background: 'hsl(0 60% 55%)' }} />Remove {sils.length} silences</button>
            {cuts.length > 0 && <button onClick={clearCuts} className="ml-auto text-3xs underline-offset-2 hover:underline" style={{ color: 'hsl(var(--muted-foreground))' }}>Undo all</button>}
          </div>
          <p className="mb-2 rounded-md px-2 py-1 text-3xs bg-muted text-muted-foreground">Click a word to cut it. Double-click to fix a mis-heard word — the correction flows to the caption and export.</p>
          <div className="text-sm leading-loose">
            {words.map((w, i) => {
              if (editingIdx === i) {
                return (
                  <input
                    key={i}
                    autoFocus
                    defaultValue={w.word}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitEdit(w, e.target.value, true) }
                      else if (e.key === 'Escape') { e.preventDefault(); commitEdit(w, '', false) }
                    }}
                    onBlur={(e) => commitEdit(w, e.target.value, true)}
                    className="mx-0.5 rounded border px-1 py-0 text-sm"
                    style={{ width: `${Math.max(3, (w.word.length || 3) + 2)}ch`, borderColor: 'hsl(var(--ring))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))', outline: 'none', boxShadow: '0 0 0 3px hsl(var(--ring)/0.18)' }}
                  />
                )
              }
              const cut = inCut((w.start + w.end) / 2, cuts)
              const filler = FILLERS.has(fillerKey(w.word))
              return (
                <span key={i} onClick={() => onWordClick(w)} onDoubleClick={() => onWordDbl(i)}
                  title="Click to cut · double-click to fix the word"
                  className="cursor-pointer rounded px-0.5"
                  style={{
                    textDecoration: cut ? 'line-through' : w.edited ? 'underline' : 'none',
                    textDecorationColor: w.edited ? 'hsl(var(--primary))' : undefined,
                    textUnderlineOffset: w.edited ? '3px' : undefined,
                    color: cut ? 'hsl(var(--muted-foreground))' : filler ? 'hsl(var(--action))' : 'inherit',
                    opacity: cut ? 0.5 : 1,
                    background: !cut && w.edited ? 'hsl(var(--primary)/0.12)' : !cut && filler ? 'hsl(var(--action)/0.12)' : 'transparent',
                  }}>
                  {w.word}{' '}
                </span>
              )
            })}
          </div>
        </>
      )}
    </InspectorShell>
  )
}
