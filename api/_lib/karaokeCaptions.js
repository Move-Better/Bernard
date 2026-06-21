// Karaoke caption generator — turns Whisper word-timestamps into a burned-in
// ASS subtitle track where each word fills to the brand accent colour as it's
// spoken (the "animated caption" upgrade over the static SRT path). Pure string
// generation; no I/O. Consumed by brandRenderVideo.js (ffmpeg `ass=` filter)
// with the SRT path kept as a fallback.

function pad2(n) { return String(n).padStart(2, '0') }

// ASS timestamps are H:MM:SS.cs (centiseconds).
function assTime(sec) {
  const s = Math.max(0, sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  const cs = Math.floor((s - Math.floor(s)) * 100)
  return `${h}:${pad2(m)}:${pad2(ss)}.${pad2(cs)}`
}

// #RRGGBB → &HAABBGGRR (ASS is BGR with a leading alpha; 00 = fully opaque).
function assColor(hex, alpha = '00') {
  const m = String(hex || '').replace('#', '')
  if (m.length < 6) return '&H00FFFFFF'
  const rr = m.slice(0, 2), gg = m.slice(2, 4), bb = m.slice(4, 6)
  return `&H${alpha}${bb}${gg}${rr}`.toUpperCase()
}

// `{` / `}` start ASS override blocks, `\` is an escape — neutralise them in
// spoken text so a stray brace can't corrupt the dialogue line.
function assEscape(s) {
  return String(s).replace(/\\/g, '⧵').replace(/\{/g, '(').replace(/\}/g, ')')
}

// Greedy-group words into caption lines bounded by word count AND char width so
// lines stay legible across 9:16 / 1:1 / 16:9.
export function groupWordsIntoLines(words, maxWords = 5, maxChars = 26) {
  const lines = []
  let cur = []
  let chars = 0
  for (const w of words) {
    const wLen = (w?.word?.length ?? 0) + 1
    if (cur.length && (cur.length >= maxWords || chars + wLen > maxChars)) {
      lines.push(cur)
      cur = []
      chars = 0
    }
    cur.push(w)
    chars += wLen
  }
  if (cur.length) lines.push(cur)
  return lines
}

/**
 * Slice whole-source word timestamps to a clip window and REBASE them to a
 * 0-based clip timeline (so the karaoke ASS — whose timeline starts at 0 because
 * ffmpeg input-seeks the clip window — lines up with the spoken audio).
 *
 * Keeps any word that OVERLAPS [startSec, startSec+durationSec); each surviving
 * word's start/end are shifted by -startSec and clamped to [0, durationSec].
 * Pure + deterministic — this is the function the V1 caption harness asserts.
 *
 * @param {Array<{word:string,start:number,end:number}>} words — whole-source words
 * @param {number} startSec   — clip start in the source
 * @param {number} durationSec — clip length
 * @returns {Array<{word:string,start:number,end:number}>} window-relative words
 */
export function sliceWordsToWindow(words, startSec, durationSec) {
  if (!Array.isArray(words)) return []
  const s = Math.max(0, Number(startSec) || 0)
  const dur = Math.max(0, Number(durationSec) || 0)
  if (dur <= 0) return []
  const end = s + dur
  const out = []
  for (const w of words) {
    if (!w) continue
    const ws = Number(w.start)
    const we = Number(w.end)
    if (!Number.isFinite(ws) || !Number.isFinite(we)) continue
    if (we <= s || ws >= end) continue            // fully outside the window
    const word = String(w.word || '').trim()
    if (!word) continue
    const start = Math.max(0, ws - s)
    const wEnd = Math.min(dur, we - s)
    if (wEnd > start) out.push({ word, start, end: wEnd })
  }
  return out
}

/**
 * Build an ASS subtitle document from Whisper word-timestamps.
 *
 * @param {Object} p
 * @param {Array<{word:string,start:number,end:number}>} p.words
 * @param {number} p.width / p.height        — video dimensions (ASS PlayRes)
 * @param {'top'|'center'|'bottom'} p.captionPos
 * @param {string} p.accentColor             — #RRGGBB; spoken words fill to this
 * @param {number} [p.fontSizePx]            — defaults to ~5% of the min dimension
 * @param {string} [p.fontName='Inter']
 * @returns {string|null} ASS text, or null if there are no usable words
 */
// Per-line entrance override (ASS tag block prepended to each Dialogue line):
//   'none' — current behaviour, no entrance, per-word \k karaoke highlight.
//   'pop'  — line scales up from 72% with a soft overshoot + quick fade, \k kept.
//   'fade' — line cross-fades in/out, NO per-word highlight (forced white).
// Steady-state (the bulk of each line's on-screen time) is identical to 'none'
// for pop, so the editor's static karaoke preview still matches the bake outside
// the ~250ms entrance window.
function entrancePrefix(anim) {
  if (anim === 'pop') return '{\\fad(60,60)\\fscx72\\fscy72\\t(0,160,\\fscx106\\fscy106)\\t(160,240,\\fscx100\\fscy100)}'
  if (anim === 'fade') return '{\\fad(220,200)\\c&HFFFFFF&}'
  return ''
}

export function buildKaraokeAss({ words, width, height, captionPos = 'top', accentColor = '#FFFFFF', fontSizePx, fontName = 'Inter', anim = 'none' }) {
  if (!Array.isArray(words) || words.length === 0) return null
  const usable = words.filter((w) => w && w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
  if (usable.length === 0) return null

  const fontSize = Math.max(28, Math.round(fontSizePx || Math.min(width, height) * 0.05))
  const alignment = captionPos === 'bottom' ? 2 : captionPos === 'center' ? 5 : 8
  const marginV = captionPos === 'bottom' ? Math.round(height * 0.14)
    : captionPos === 'center' ? 0
      : Math.round(height * 0.10)
  const marginLR = Math.round(width * 0.08)
  const outlineW = Math.max(2, Math.round(fontSize * 0.08))

  const primary = assColor(accentColor)   // spoken words → accent
  const secondary = '&H00FFFFFF'           // upcoming words → white
  const outline = '&H00000000'             // black outline
  const back = '&H64000000'                // soft shadow box

  const styleBlock = [
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${fontName},${fontSize},${primary},${secondary},${outline},${back},-1,0,0,0,100,100,0,0,1,${outlineW},0,${alignment},${marginLR},${marginLR},${marginV},1`,
  ].join('\n')

  const prefix = entrancePrefix(anim)
  const events = ['Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
  for (const line of groupWordsIntoLines(usable)) {
    const start = line[0].start
    const end = line[line.length - 1].end + 0.12   // brief tail so the last word lingers
    // 'fade' has no per-word karaoke (a cross-fading line reads calmer); pop/none
    // keep the \k fill-to-accent timing.
    const text = anim === 'fade'
      ? prefix + line.map((w) => assEscape(w.word)).join(' ')
      : prefix + line
        .map((w) => `{\\k${Math.max(1, Math.round((w.end - w.start) * 100))}}${assEscape(w.word)} `)
        .join('')
        .trimEnd()
    events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${text}`)
  }

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    styleBlock,
    '',
    '[Events]',
    events.join('\n'),
    '',
  ].join('\n')
}
