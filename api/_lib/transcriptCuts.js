// Pure helpers for edit-by-transcript (WS4). A "cut" is a clip-relative time
// range removed from the clip; the render trims+concats the KEPT ranges and the
// captions/overlays are remapped onto the compacted timeline. Pure + node-tested;
// the trim+concat ffmpeg mechanism was locally verified (10s → remove [3,6] → 7s).
//
// The client (src/lib/transcriptCuts client copy) mirrors normalizeCuts/keptRanges
// for its preview; keep the two in lockstep the way gradeParams is.

const EPS = 0.02   // ignore sub-frame slivers / floating dust

// Merge + clamp raw cut ranges into a sorted, non-overlapping list within [0,dur].
export function normalizeCuts(cuts, dur) {
  const d = Math.max(0, Number(dur) || 0)
  const cs = (Array.isArray(cuts) ? cuts : [])
    .map((c) => ({
      start: Math.max(0, Math.min(d, Number(c?.start) || 0)),
      end: Math.max(0, Math.min(d, Number(c?.end) || 0)),
    }))
    .filter((c) => c.end - c.start > EPS)
    .sort((a, b) => a.start - b.start)
  const out = []
  for (const c of cs) {
    const last = out[out.length - 1]
    if (last && c.start <= last.end + 0.01) last.end = Math.max(last.end, c.end)
    else out.push({ ...c })
  }
  return out
}

// The complement of the cuts — the ranges to KEEP, as [start,end] pairs.
export function keptRanges(cuts, dur) {
  const d = Math.max(0, Number(dur) || 0)
  const cs = normalizeCuts(cuts, d)
  const keep = []
  let cur = 0
  for (const c of cs) {
    if (c.start > cur + 0.001) keep.push([+cur.toFixed(4), +c.start.toFixed(4)])
    cur = c.end
  }
  if (cur < d - 0.001) keep.push([+cur.toFixed(4), +d.toFixed(4)])
  return keep
}

export function totalCut(cuts, dur) {
  return normalizeCuts(cuts, dur).reduce((s, c) => s + (c.end - c.start), 0)
}

// Map an original clip-time onto the compacted timeline; null if t lands inside
// a cut (i.e. that moment no longer exists).
export function remapTime(t, cuts, dur) {
  const cs = normalizeCuts(cuts, dur)
  let removed = 0
  for (const c of cs) {
    if (c.end <= t) removed += c.end - c.start
    else if (c.start < t) return null
    else break
  }
  return +(t - removed).toFixed(4)
}

// Remap word timestamps; drop words that fall inside a cut.
export function remapWords(words, cuts, dur) {
  const cs = normalizeCuts(cuts, dur)
  if (!cs.length) return Array.isArray(words) ? words : []
  return (Array.isArray(words) ? words : [])
    .map((w) => {
      const s = remapTime(w.start, cs, dur)
      const e = remapTime(w.end, cs, dur)
      if (s == null || e == null || e <= s) return null
      return { ...w, start: s, end: e }
    })
    .filter(Boolean)
}

// Remap timed overlays {in,out,...}; drop any that touch a cut (v1 — endpoints
// inside a cut are dropped rather than clamped).
export function remapOverlays(overlays, cuts, dur) {
  const cs = normalizeCuts(cuts, dur)
  if (!cs.length) return Array.isArray(overlays) ? overlays : []
  return (Array.isArray(overlays) ? overlays : [])
    .map((o) => {
      const i = remapTime(o.in, cs, dur)
      const out = remapTime(o.out, cs, dur)
      if (i == null || out == null || out <= i) return null
      return { ...o, in: i, out }
    })
    .filter(Boolean)
}

// Build the ffmpeg filter_complex for the cut pass: trim+concat every KEPT range
// (video, + audio when present) into one compacted stream. Returns the filter
// string and the output pad labels. Locally verified on a real clip.
export function buildCutFilter(kept, hasAudio) {
  const parts = []
  kept.forEach(([s, e], i) => {
    parts.push(`[0:v]trim=${s}:${e},setpts=PTS-STARTPTS[v${i}]`)
    if (hasAudio) parts.push(`[0:a]atrim=${s}:${e},asetpts=PTS-STARTPTS[a${i}]`)
  })
  const n = kept.length
  if (hasAudio) {
    const inter = kept.map((_, i) => `[v${i}][a${i}]`).join('')
    parts.push(`${inter}concat=n=${n}:v=1:a=1[vc][ac]`)
    return { filter: parts.join(';'), v: '[vc]', a: '[ac]' }
  }
  parts.push(`${kept.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[vc]`)
  return { filter: parts.join(';'), v: '[vc]', a: null }
}
