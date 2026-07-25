import { describe, it, expect } from 'vitest'
import { buildKaraokeAss } from '../../api/_lib/karaokeCaptions.js'

// `glow` used to draw an accent halo. Karaoke fills the SPOKEN word with the
// accent too, so a spoken word was an accent fill inside an accent stroke 15% of
// the font size thick, and the glyph dissolved into a solid blob.
//
// The invariant is not "don't use that alpha" or "don't use that width" — making
// the halo translucent did not fix it, because the same hue at any alpha is
// still no contrast. It is: A HALO MUST NOT BE THE SAME COLOUR AS THE FILL IT
// SURROUNDS. That is what these pin, for every style, so a future style cannot
// reintroduce it.

const ACCENT = '#E36525'
const words = [{ word: 'a', start: 0, end: 0.3 }, { word: 'little', start: 0.3, end: 0.7 }]

// Style line: Name,Font,Size,Primary,Secondary,Outline,Back,... (0-indexed)
function styleFields(style, fontSizePx = 73) {
  const doc = buildKaraokeAss({ words, width: 1080, height: 1920, accentColor: ACCENT, style, fontSizePx })
  const line = doc.split('\n').find((l) => l.startsWith('Style:'))
  const f = line.split(',')
  return { primary: f[3], secondary: f[4], outline: f[5], back: f[6], outlineW: Number(f[16]) }
}

// &HAABBGGRR — drop the alpha to compare hue alone.
const rgbOf = (assColor) => String(assColor).replace(/^&H/, '').slice(2).toUpperCase()

const STYLES = ['bold', 'word_box', 'accent_fill', 'glow', 'underline', 'pop']

describe('caption styles — the halo must contrast with the fill', () => {
  it.each(STYLES)('%s does not draw an outline in the same colour as the spoken fill', (style) => {
    const s = styleFields(style)
    // BorderStyle=3 styles use the outline as a filled BOX behind the text, which
    // is a different relationship — matching there is intended (accent_fill).
    const doc = buildKaraokeAss({ words, width: 1080, height: 1920, accentColor: ACCENT, style })
    const isBox = /,3,\d/.test(doc.split('\n').find((l) => l.startsWith('Style:')))
    if (isBox) return
    expect(rgbOf(s.outline)).not.toBe(rgbOf(s.primary))
  })

  it('glow specifically: dark halo, accent fill, white upcoming', () => {
    const s = styleFields('glow')
    expect(rgbOf(s.primary)).toBe('2565E3')   // accent, BGR
    expect(rgbOf(s.outline)).toBe('000000')   // dark
    expect(rgbOf(s.secondary)).toBe('FFFFFF')
  })

  it('glow keeps a translucent halo — an opaque one reads as a sticker', () => {
    expect(styleFields('glow').outline.startsWith('&H00')).toBe(false)
  })

  it('glow stays visually distinct from bold via halo weight', () => {
    expect(styleFields('glow').outlineW).toBeGreaterThan(styleFields('bold').outlineW)
  })

  it('the halo is a constant fraction of type size, so no size is a special case', () => {
    // This is why the original bug was NOT a scale bug: it was equally wrong at
    // every size and merely more obvious when large.
    const small = styleFields('glow', 50).outlineW
    const large = styleFields('glow', 150).outlineW
    expect(large / small).toBeCloseTo(3, 0)
  })

  it('every style still renders a usable document', () => {
    for (const style of STYLES) {
      expect(buildKaraokeAss({ words, width: 1080, height: 1920, accentColor: ACCENT, style })).toBeTruthy()
    }
  })
})
