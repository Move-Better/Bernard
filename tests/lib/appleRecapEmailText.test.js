import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseAppleRecapText, prepareRecapEmailText } from '../../api/_lib/appleInsights.js'

// The Apple monthly recap can now arrive two ways — the uploaded PDF, or the
// body of the email Apple sends. Both feed the SAME parser; only the year
// resolution differs, because a PDF's text layer carries its own send date and
// an email body may not.
//
// A recap is always for the PRIOR calendar month, so the send date is what
// separates "December 2026" from "December 2025" when a December recap is read
// in January. parseAppleRecapText takes the FIRST "<Month> <D>, <YYYY>" it sees,
// which is why the send date is APPENDED rather than prepended: a date genuinely
// present in the body must always win. Prepending would let the mail envelope
// silently override the document — a wrong year on a real metric, with nothing
// to notice it by.

const RECAP = [
  'Apple Business Connect Sign In Move Better 237 NE Broadway Portland, OR 97232',
  'Insights Summary Jun 1 - 30',
  'PLACE CARD VIEWS 143 42% from June last year',
  'TAPS FROM SEARCH 72 29% from June last year',
  'Trends 29% This location has 29% more taps in search results',
  '42% This location has 42% more views of its place card',
  'Directions65 8% from June last year Photos55 Over 100% from June last year',
  'Website3 Call8 100% from June last year',
].join(' ')

describe('prepareRecapEmailText', () => {
  it('appends the send date so an email body with no date still resolves a year', () => {
    const parsedBare = parseAppleRecapText(RECAP)
    expect(parsedBare.ok).toBe(false)
    expect(parsedBare.error).toBe('no_period')

    const parsed = parseAppleRecapText(prepareRecapEmailText(RECAP, '2026-07-07T12:00:00Z'))
    expect(parsed.ok).toBe(true)
    expect(parsed.periodMonth).toBe('2026-06-01')
  })

  it('is a FALLBACK ONLY — a date already in the body wins over the send date', () => {
    // Body says July 7 2026 (so: June 2026 recap). Envelope claims a year later.
    // Appending keeps the body's date first, so the body must win.
    const withOwnDate = `${RECAP} July 7, 2026`
    const parsed = parseAppleRecapText(prepareRecapEmailText(withOwnDate, '2027-07-07T12:00:00Z'))
    expect(parsed.periodMonth).toBe('2026-06-01')
  })

  it('resolves the prior year when a recap is read in the following January', () => {
    const dec = RECAP.replace(/Jun 1 - 30/, 'Dec 1 - 31').replace(/June last year/g, 'December last year')
    const parsed = parseAppleRecapText(prepareRecapEmailText(dec, '2027-01-06T12:00:00Z'))
    expect(parsed.ok).toBe(true)
    expect(parsed.periodMonth).toBe('2026-12-01')
  })

  it('passes the text through unchanged when there is no usable send date', () => {
    expect(prepareRecapEmailText(RECAP, null)).toBe(RECAP)
    expect(prepareRecapEmailText(RECAP, 'not-a-date')).toBe(RECAP)
  })

  it('reads the same six metrics from an email body as from the PDF text', () => {
    const parsed = parseAppleRecapText(prepareRecapEmailText(RECAP, '2026-07-07T12:00:00Z'))
    expect(parsed.metrics).toEqual({
      placeCardViews: 143, tapsFromSearch: 72, directions: 65, photos: 55, website: 3, call: 8,
    })
    expect(parsed.yoy.viewsPct).toBe(42)
    expect(parsed.yoy.tapsPct).toBe(29)
  })

  it('still rejects a non-Apple email rather than inventing a row', () => {
    const parsed = parseAppleRecapText(prepareRecapEmailText('Your Amazon order has shipped', '2026-07-07T12:00:00Z'))
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('not_apple_recap')
  })
})

describe('apple import route wiring', () => {
  const SRC = readFileSync(fileURLToPath(new URL('../../api/_routes/integrations/apple/import.js', import.meta.url)), 'utf8')

  it('routes the email body through the shared helper, not an inline copy', () => {
    expect(SRC).toMatch(/prepareRecapEmailText\(/)
    // An inline re-implementation would drift from the tested contract above.
    expect(SRC).not.toMatch(/MONTH_NAMES/)
  })

  it('records which shape produced the row so a bad source can be traced', () => {
    expect(SRC).toMatch(/source: hasText \? 'email_recap' : 'pdf_recap'/)
  })

  it('caps email text so a huge body cannot be pushed through the parser', () => {
    expect(SRC).toMatch(/MAX_TEXT_CHARS/)
    expect(SRC).toMatch(/invalid_text_size/)
  })
})
