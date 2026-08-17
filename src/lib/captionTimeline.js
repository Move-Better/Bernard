// Pure caption-timeline transforms shared by the reel editor's live preview and its
// export bake (VideoEditor.jsx). Extracted out of the component so the trim/caption
// re-timing can be unit-tested directly — the bug it guards (a trim baking captions
// MISALIGNED against the trimmed audio) is silent, so a test is the only cheap proof.

// Snap `value` to the NEAREST candidate within `tol`; return `value` unchanged when
// none is close enough. Used by the trim handles to land a cut on a transcript word
// boundary (so a word isn't sliced in half) as well as on the playhead / clip edges.
// `value` and every candidate are in the same coordinate space (source seconds).
export function nearestWithin(value, candidates, tol) {
  let best = value
  let bestD = tol
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!Number.isFinite(c)) continue
    const d = Math.abs(value - c)
    if (d < bestD) { bestD = d; best = c }
  }
  return best
}

// Transform stored caption lines into the words the preview draws and the bake
// burns. Two independent transforms in a single pass:
//
//   1. Per-word transcript corrections (`wordEdits`), keyed by ABSOLUTE source time.
//      A stored word.start is clip-relative to `captionWin`, so its correction key
//      is (word.start + captionWin). `userEdited` lines keep their typed text.
//
//   2. Window re-timing. Stored caption lines are clip-relative to `captionWin` — the
//      trim window they were seeded/edited in. When a trim MOVES the window while
//      captions are hand-edited, the editor leaves the edited lines frozen, so
//      captionWin LAGS the live startSec. Left alone, the bake would play those
//      captions at the wrong times against the trimmed audio, silently. So shift
//      every word by (captionWin - startSec) and drop what now falls outside
//      [0, durationSec] (clamping a straddler to the edge). In the common case
//      captionWin === startSec (shift 0) and this only applies corrections, and
//      returns the same array reference when there is nothing to do.
export function applyCaptionWindow(captionLines, { wordEdits, captionWin = 0, startSec = 0, durationSec = 0 } = {}) {
  const list = Array.isArray(captionLines) ? captionLines : []
  const cw = Math.max(0, captionWin || 0)
  const s = Math.max(0, startSec || 0)
  const shift = +(cw - s).toFixed(2)
  const dur = Math.max(0, durationSec || 0)
  const hasEdits = !!wordEdits && Object.keys(wordEdits).length > 0
  if (shift === 0 && !hasEdits) return list
  const out = []
  for (const l of list) {
    if (!Array.isArray(l?.words)) { out.push(l); continue }
    let changed = false
    const w = []
    for (const word of l.words) {
      let ww = word
      if (hasEdits && !l.userEdited) {
        const fix = wordEdits[(word.start + cw).toFixed(2)]
        if (fix != null && fix !== word.word) { ww = { ...ww, word: fix, edited: true }; changed = true }
      }
      if (shift !== 0) {
        const ns = +(ww.start + shift).toFixed(2)
        const ne = +(ww.end + shift).toFixed(2)
        if (ne <= 0 || ns >= dur) { changed = true; continue } // fell outside the trimmed window
        ww = { ...ww, start: Math.max(0, ns), end: Math.min(dur, ne) }
        changed = true
      }
      w.push(ww)
    }
    if (!w.length) { changed = true; continue } // whole line fell outside the window
    if (!changed) { out.push(l); continue }
    out.push({ ...l, words: w, start: w[0].start, end: w[w.length - 1].end, text: w.map((x) => x.word).join(' ') })
  }
  return out
}
