import { describe, it, expect } from 'vitest'
import { htmlToRecapText, parseAppleRecapText } from '../../api/_lib/appleInsights.js'
import { parseAppleRecapInput } from '../../api/_lib/appleImport.js'

// GUARD — Apple's recap markup puts every number in its own isolated
// element, with ZERO literal whitespace between adjacent tags. A plaintext
// conversion that doesn't synthesize whitespace at block boundaries glues a
// metric's value straight onto its own YoY percentage — "223" + "91%"
// becomes "22391%" — on every metric whose YoY change isn't phrased as
// "Over 100%" (confirmed 2026-10-07 against two live September recaps: it
// corrupted 4 of 6 metrics for one location and 4 of 5 parseable metrics for
// the other, with zero warnings raised, because the concatenated digit run
// still looks like a plausible integer).
//
// htmlToRecapText fixes this structurally — reinsert a real separator at
// every block-level tag boundary before stripping tags — rather than trying
// to guess where a glued digit run should split, which is NOT reliably
// recoverable from the plaintext alone (see the real-world numbers below:
// "22391" could be 223+91 or, with no other signal, several other splits).

// A condensed but structurally faithful fragment of a real recap's HTML —
// same tag types and boundaries Apple actually emits, confirmed against two
// live September 2026 recaps (Move Better, Portland + Vancouver). A metric
// with no YoY to show (confirmed real for "Website"/"Call" in some months)
// renders with NO trailing div at all, not an empty one — matched here by
// simply omitting the yoy div block when the field is falsy.
function fixtureHtml({ placeCardViews, placeCardYoy, taps, tapsYoy, directions, directionsYoy, photos, photosYoy, website, call, callYoy }) {
  const yoyDiv = (v) => (v ? `<div>${v} from September last year</div>` : '')
  return `<!doctype html><html><head><style>.bar-chart-total{color:red}</style></head><body>
<a>Sign In</a>
<strong class="location-name">Move Better</strong><br class="hidden"/><span class="location-address">237 NE Broadway
Portland, OR 97232
</span>
<div class="insights-recap-title">Insights Summary</div><div class="insights-recap-period">Sep 1 - 30</div>
<div class="bar-chart-total"><div class="bar-chart-total-title">PLACE CARD VIEWS</div><span class="bar-chart-total-value">${placeCardViews}</span></div>
<div class="bar-chart-native"><img src="x"/></div>
<div class="bar-chart-additional-info">${yoyDiv(placeCardYoy)}</div>
<div class="bar-chart-total"><div class="bar-chart-total-title">TAPS FROM SEARCH</div><span class="bar-chart-total-value">${taps}</span></div>
<div class="bar-chart-additional-info">${yoyDiv(tapsYoy)}</div>
<ul>
<li><span data-automation-id="x-ACTION_DIRECTIONS__title"><strong>Directions</strong></span><span data-automation-id="x-ACTION_DIRECTIONS__value"><span>${directions}</span></span><br class="hidden"/>${yoyDiv(directionsYoy)}</li>
<li><span data-automation-id="x-ACTION_GALLERY_ENGAGEMENT__title"><strong>Photos</strong></span><span data-automation-id="x-ACTION_GALLERY_ENGAGEMENT__value"><span>${photos}</span></span><br class="hidden"/>${yoyDiv(photosYoy)}</li>
<li><span data-automation-id="x-ACTION_WEBSITE__title"><strong>Website</strong></span><span data-automation-id="x-ACTION_WEBSITE__value"><span>${website}</span></span><br class="hidden"/></li>
<li><span data-automation-id="x-ACTION_CALL__title"><strong>Call</strong></span><span data-automation-id="x-ACTION_CALL__value"><span>${call}</span></span><br class="hidden"/>${yoyDiv(callYoy)}</li>
</ul>
</body></html>`
}

// The real Portland, September 2026 recap — reproduced verbatim from the
// live email's HTML (place-card views: 223/91%, taps: 113/Over 100%,
// directions: 85/70%, photos: 57/Over 100%, website: 24, call: 8/Over 100%).
const PORTLAND_SEPT = {
  placeCardViews: 223, placeCardYoy: '91%',
  taps: 113, tapsYoy: 'Over 100%',
  directions: 85, directionsYoy: '70%',
  photos: 57, photosYoy: 'Over 100%',
  website: 24,
  call: 8, callYoy: 'Over 100%',
}

describe('htmlToRecapText', () => {
  it('separates a metric value from its own YoY percentage across a block boundary', () => {
    const text = htmlToRecapText(fixtureHtml(PORTLAND_SEPT))
    // The defect this guards: without block-boundary whitespace, "223" and
    // "91%" collapse into the single run "22391%".
    expect(text).not.toMatch(/22391/)
    expect(text).not.toMatch(/8570/)
    expect(text).toMatch(/PLACE CARD VIEWS\s*223\b/)
    expect(text).toMatch(/91%/)
  })

  it('strips style/script content so it cannot leak into the flattened text', () => {
    const text = htmlToRecapText(fixtureHtml(PORTLAND_SEPT))
    expect(text).not.toMatch(/color:\s*red/)
  })

  it('leaves inline label+value glue alone (labelNumber already tolerates it)', () => {
    // "Directions" and its value sit in sibling SPANs with no div between
    // them — htmlToRecapText must not force a split there; it only touches
    // genuine block boundaries.
    const text = htmlToRecapText(fixtureHtml(PORTLAND_SEPT))
    expect(text).toMatch(/Directions\s*85/)
  })
})

describe('parseAppleRecapText via htmlToRecapText — end to end on real recap shapes', () => {
  it('parses every metric correctly for the real Portland September recap', () => {
    const text = htmlToRecapText(fixtureHtml(PORTLAND_SEPT))
    const parsed = parseAppleRecapText(`${text} October 5, 2026`)
    expect(parsed.ok).toBe(true)
    expect(parsed.warnings).toEqual([])
    expect(parsed.metrics).toEqual({
      placeCardViews: 223,
      tapsFromSearch: 113,
      directions: 85,
      photos: 57,
      website: 24,
      call: 8,
    })
    expect(parsed.yoy.interactions.directions).toEqual({ magnitudePct: 70, atLeast: false })
  })

  it('parses the real Vancouver September recap, including a "Not enough data" field', () => {
    const vancouver = fixtureHtml({
      placeCardViews: 25, placeCardYoy: '52%',
      taps: 19, tapsYoy: '37%',
      directions: 16, directionsYoy: '24%',
      photos: 4, photosYoy: '43%',
      website: 'Not enough data',
      call: 4, callYoy: '',
    })
    const text = htmlToRecapText(vancouver)
    const parsed = parseAppleRecapText(`${text} October 5, 2026`)
    expect(parsed.ok).toBe(true)
    expect(parsed.metrics.placeCardViews).toBe(25)
    expect(parsed.metrics.tapsFromSearch).toBe(19)
    expect(parsed.metrics.directions).toBe(16)
    expect(parsed.metrics.photos).toBe(4)
    expect(parsed.metrics.website).toBeNull()
    expect(parsed.metrics.call).toBe(4)
    // "Not enough data" is a legitimate null, not a missing-metric warning.
    expect(parsed.warnings).toEqual([])
  })
})

describe('parseAppleRecapInput — emailHtml wins over emailText', () => {
  it('uses emailHtml and ignores a conflicting emailText when both are supplied', async () => {
    const html = fixtureHtml(PORTLAND_SEPT)
    const wrongText = 'Insights Summary Sep 1 - 30 PLACE CARD VIEWS 999 from September last year'
    const r = await parseAppleRecapInput({
      emailHtml: html,
      emailText: wrongText,
      sentAt: '2026-10-05T03:36:15Z',
    })
    expect(r.status).toBe('ok')
    expect(r.parsed.ok).toBe(true)
    expect(r.parsed.metrics.placeCardViews).toBe(223)
  })

  it('still accepts a plaintext-only input unchanged (backward compatible)', async () => {
    const r = await parseAppleRecapInput({
      emailText: 'Insights Summary Sep 1 - 30 PLACE CARD VIEWS 223 91% from September last year TAPS FROM SEARCH 113 Over 100% from September last year',
      sentAt: '2026-10-05T03:36:15Z',
    })
    expect(r.status).toBe('ok')
    expect(r.parsed.metrics.placeCardViews).toBe(223)
    expect(r.parsed.metrics.tapsFromSearch).toBe(113)
  })

  it('rejects an oversized emailHtml payload', async () => {
    const r = await parseAppleRecapInput({ emailHtml: 'x'.repeat(1_000_001) })
    expect(r.status).toBe('invalid_text_size')
  })
})
