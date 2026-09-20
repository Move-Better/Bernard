// Edit-by-transcript cut math for the video editor.
//
// Extracted verbatim from VideoEditor.jsx so it can be tested — it is a
// documented client mirror of api/_lib/transcriptCuts and had no tests at all.
// Pure: numbers and plain objects in, plain objects out. No React, no DOM.

// Client mirror of api/_lib/transcriptCuts (keep in lockstep). Cuts are clip-
// relative {start,end} ranges removed from the clip; the render trims+concats the
// kept ranges and re-times the captions onto the compacted timeline.
export const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'hmm', 'mm', 'mhm'])
export const SILENCE_GAP = 0.6
export const fillerKey = (w) => w.toLowerCase().replace(/[^a-z]/g, '')
export function normCutsCli(cuts, dur) {
  const cs = (cuts || []).map((c) => ({ start: Math.max(0, Math.min(dur, +c.start || 0)), end: Math.max(0, Math.min(dur, +c.end || 0)) }))
    .filter((c) => c.end - c.start > 0.02).sort((a, b) => a.start - b.start)
  const out = []
  for (const c of cs) { const last = out[out.length - 1]; if (last && c.start <= last.end + 0.01) last.end = Math.max(last.end, c.end); else out.push({ ...c }) }
  return out
}
export const totalCutCli = (cuts, dur) => normCutsCli(cuts, dur).reduce((s, c) => s + (c.end - c.start), 0)
export const addRange = (cuts, r, dur) => normCutsCli([...cuts, r], dur)
export function subRange(cuts, r, dur) {
  const out = []
  for (const c of normCutsCli(cuts, dur)) {
    if (r.end <= c.start || r.start >= c.end) { out.push(c); continue }
    if (c.start < r.start) out.push({ start: c.start, end: r.start })
    if (r.end < c.end) out.push({ start: r.end, end: c.end })
  }
  return out
}
export const inCut = (t, cuts) => cuts.some((c) => t >= c.start && t < c.end)
export function silenceRanges(words, dur) {
  const out = []
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].start - words[i].end
    if (gap > SILENCE_GAP) out.push({ start: +(words[i].end + 0.05).toFixed(2), end: +(words[i + 1].start - 0.05).toFixed(2) })
  }
  return out.filter((r) => r.end - r.start > 0.1 && r.end <= dur)
}
