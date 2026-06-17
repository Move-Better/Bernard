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
export function buildKaraokeAss({ words, width, height, captionPos = 'top', accentColor = '#FFFFFF', fontSizePx, fontName = 'Inter' }) {
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

  const events = ['Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
  for (const line of groupWordsIntoLines(usable)) {
    const start = line[0].start
    const end = line[line.length - 1].end + 0.12   // brief tail so the last word lingers
    const text = line
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
