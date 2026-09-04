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

// ---------------------------------------------------------------------------
// A REAL Gmail-sourced recap does not render like the terse PDF fixture
// above. Gmail's plaintext conversion of Apple's HTML renders each
// interaction label's <strong> span as a literal markdown-style bold marker
// glued directly to the value with NO whitespace: "*Directions*74", not
// "Directions74" (PDF) or "Directions 74" (space-separated). The surrounding
// prose ("Add More Photos to Your Location", "[image: ACTION_CALL]") is also
// real — it exists specifically to prove the fix doesn't accidentally match
// an earlier, unrelated occurrence of the same word.
//
// These two fixtures are transcribed verbatim (quoted-printable soft-wraps
// removed, tracking URLs stripped) from the real August 2026 recap emails for
// Move Better's two locations — see project memory
// project-apple-business-insights.md for the source thread.

const EMAIL_RECAP_PORTLAND = [
  '---------- Forwarded message ---------',
  'From: Apple Business <noreply@apple.com>',
  'Date: Thu, Sep 3, 2026 at 4:27 PM',
  'Subject: Your August Insights for Move Better, 237 NE Broadway.',
  'To: <admin@movebetter.co>',
  'Sign In',
  '*Move Better*',
  '237 NE Broadway Portland, OR 97232',
  'Insights Summary',
  'Aug 1 - 31',
  'PLACE CARD VIEWS',
  '165',
  '[image: Chart]',
  '50% from August last year',
  'TAPS FROM SEARCH',
  '101',
  '[image: Chart]',
  '68% from August last year',
  'Trends',
  '- *101*',
  'This location reached an all-time high of *101* *monthly* taps from search results.',
  '- *68%*',
  'This location has *68%* *more* taps on search results compared to August last year.',
  '- *50%*',
  'This location has *50%* *more* views compared to August last year.',
  'Place cards with more than 15 photos average 70% more engagement. Add More',
  'Photos to Your Location',
  'Place Card Interactions',
  'See All',
  '- [image: ACTION_DIRECTIONS]*Directions*74',
  '40% from August last year',
  '- [image: ACTION_GALLERY_ENGAGEMENT]*Photos*36',
  '89% from August last year',
  '- [image: ACTION_WEBSITE]*Website*4',
  '0% from August last year',
  '- [image: ACTION_CALL]*Call*7',
  'To receive monthly insights for more locations or manage your emails,',
  'go to Email Settings.',
  'Sign in to see all your location’s data',
  'Sign In',
  'Sign In to Apple Business | Manage Email Settings | Support | Terms of Service',
  '| Privacy Policy',
  'Copyright © 2026 Apple Inc. All rights reserved.',
].join(' ')

const EMAIL_RECAP_VANCOUVER = [
  '---------- Forwarded message ---------',
  'From: Apple Business <noreply@apple.com>',
  'Date: Thu, Sep 3, 2026 at 4:27 PM',
  'Subject: Your August Insights for Move Better, 10303 NE Fourth Plain Blvd.',
  'To: <admin@movebetter.co>',
  'Sign In',
  '*Move Better*',
  '10303 NE Fourth Plain Blvd Vancouver, WA 98662',
  'Insights Summary',
  'Aug 1 - 31',
  'PLACE CARD VIEWS',
  '31',
  '[image: Chart]',
  '40% from August last year',
  'TAPS FROM SEARCH',
  '19',
  '[image: Chart]',
  '24% from August last year',
  'Trends',
  '- *24%*',
  'This location has *24%* *less* taps on search results compared to August last year.',
  'Place cards with more than 15 photos average 70% more engagement. Add More',
  'Photos to Your Location',
  'Place Card Interactions',
  'See All',
  '- [image: ACTION_DIRECTIONS]*Directions*20',
  '17% from August last year',
  '- [image: ACTION_GALLERY_ENGAGEMENT]*Photos*Not enough data',
  '- [image: ACTION_WEBSITE]*Website*4',
  '- [image: ACTION_CALL]*Call*Not enough data',
  'To receive monthly insights for more locations or manage your emails,',
  'go to Email Settings.',
  'Sign in to see all your location’s data',
  'Sign In',
  'Sign In to Apple Business | Manage Email Settings | Support | Terms of Service',
  '| Privacy Policy',
  'Copyright © 2026 Apple Inc. All rights reserved.',
].join(' ')

describe('a real Gmail-forwarded recap (asterisk-glued labels)', () => {
  it('parses all four interaction breakdown numbers, not just the two headline metrics', () => {
    const parsed = parseAppleRecapText(prepareRecapEmailText(EMAIL_RECAP_PORTLAND, '2026-09-03T23:30:00Z'))
    expect(parsed.ok).toBe(true)
    expect(parsed.periodMonth).toBe('2026-08-01')
    expect(parsed.metrics).toEqual({
      placeCardViews: 165, tapsFromSearch: 101, directions: 74, photos: 36, website: 4, call: 7,
    })
    // Nothing was actually missing, so no false "Missing metric" warnings.
    expect(parsed.warnings).toEqual([])
  })

  it('does not confuse "*Directions*74" for the unrelated "ACTION_DIRECTIONS" / "Add More Photos" text nearby', () => {
    const parsed = parseAppleRecapText(prepareRecapEmailText(EMAIL_RECAP_PORTLAND, '2026-09-03T23:30:00Z'))
    expect(parsed.metrics.directions).toBe(74)
    expect(parsed.metrics.photos).toBe(36)
  })

  it('leaves a metric null (never fabricated) when Apple itself says "Not enough data", with no warning', () => {
    const parsed = parseAppleRecapText(prepareRecapEmailText(EMAIL_RECAP_VANCOUVER, '2026-09-03T23:30:00Z'))
    expect(parsed.ok).toBe(true)
    expect(parsed.metrics).toEqual({
      placeCardViews: 31, tapsFromSearch: 19, directions: 20, photos: null, website: 4, call: null,
    })
    expect(parsed.warnings).toEqual([])
  })

  it('DOES warn when a number is genuinely missing (not an Apple "Not enough data" case)', () => {
    // Drop the entire Directions bullet (label, value, and its YoY line) out
    // of an otherwise-normal recap: this is a real parse gap, not Apple
    // declaring the metric unavailable, so it must surface in warnings
    // instead of silently vanishing the way it did before this fix.
    const broken = EMAIL_RECAP_PORTLAND.replace(
      '- [image: ACTION_DIRECTIONS]*Directions*74 40% from August last year ',
      '',
    )
    expect(broken).not.toBe(EMAIL_RECAP_PORTLAND) // guard against a silently-no-op replace
    expect(broken).not.toMatch(/directions/i)

    const parsed = parseAppleRecapText(prepareRecapEmailText(broken, '2026-09-03T23:30:00Z'))
    expect(parsed.ok).toBe(true)
    expect(parsed.metrics.directions).toBeNull()
    expect(parsed.metrics.photos).toBe(36) // the other three metrics are unaffected
    expect(parsed.warnings).toContain('Missing metric: directions.')
  })
})

describe('apple import wiring', () => {
  // These originally scanned the route handler. The logic since moved into
  // _lib/appleImport.js so a second (cron) route could share it verbatim, so
  // they follow it there — the thing being guarded is unchanged: the send-date
  // append is not reimplemented, the source is recorded, and the body is capped.
  const SRC = readFileSync(fileURLToPath(new URL('../../api/_lib/appleImport.js', import.meta.url)), 'utf8')

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

// ---------------------------------------------------------------------------
// The Apple recap now has TWO entry points — the Clerk upload card and the
// headless monthly routine (POST /api/cron/apple-import). They must not drift.
//
// This is the Buffer-vs-bundle lesson applied before it can bite: two publish
// paths that were "byte-for-byte identical" per their own comment silently
// diverged, and a platform rule enforced in one simply did not exist in the
// other. So the parsing, the row shape and the upsert live in ONE module and
// these guards assert neither route grew its own copy.

describe('apple import — shared core, two routes', () => {
  const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
  const CLERK = read('../../api/_routes/integrations/apple/import.js')
  const CRON = read('../../api/_routes/cron/apple-import.js')
  const LIB = read('../../api/_lib/appleImport.js')

  it('keeps the upsert in exactly one place', () => {
    // Non-vacuity: the string must really be in the lib, or this guard passes
    // by matching nothing anywhere.
    expect(LIB).toContain("apple_insights?on_conflict=workspace_id,location_id,period_month")
    expect(CLERK).not.toContain('apple_insights?on_conflict')
    expect(CRON).not.toContain('apple_insights?on_conflict')
  })

  it('keeps the parser calls in exactly one place', () => {
    expect(LIB).toMatch(/parseAppleRecapText\(/)
    expect(LIB).toMatch(/parseAppleRecapPdf\(/)
    for (const [name, src] of [['clerk', CLERK], ['cron', CRON]]) {
      expect(`${name}:${/parseAppleRecap(Text|Pdf)\(/.test(src)}`).toBe(`${name}:false`)
    }
  })

  it('builds the stored row in exactly one place', () => {
    expect(LIB).toMatch(/place_card_views:/)
    expect(CLERK).not.toMatch(/place_card_views:/)
    expect(CRON).not.toMatch(/place_card_views:/)
  })

  it('checks the cron secret before reading the body', () => {
    // Anchor on the CALL, not the identifier: `verifyCronSecret` also appears
    // in the import line at the top of the file, so an identifier-position
    // check passes no matter where the call actually sits. That exact hollow
    // version survived its own mutation test before this comment existed.
    const authAt = CRON.indexOf('verifyCronSecret(req)')
    const bodyAt = CRON.indexOf('req.body')
    expect(authAt).toBeGreaterThan(-1)
    expect(bodyAt).toBeGreaterThan(-1)
    expect(bodyAt).toBeGreaterThan(authAt)
  })

  it('REQUIRES a locationId on the cron route — there it is the tenant key', () => {
    // The Clerk route resolves the tenant from the Host header and may take a
    // null location. The cron route has no Host, so the location is the only
    // thing identifying the workspace: accepting a null one would mean writing
    // a row with no tenant, or guessing at somebody's.
    expect(CRON).toMatch(/if \(!locationId \|\| !UUID_RE\.test\(locationId\)\)/)
    expect(CRON).toMatch(/workspaceIdForLocation\(/)
    expect(CRON).toMatch(/location_not_found/)
  })
})

describe('buildInsightsRow / parseAppleRecapInput', () => {
  it('maps all six metrics and tags the source by input shape', async () => {
    const { parseAppleRecapInput, buildInsightsRow } = await import('../../api/_lib/appleImport.js')
    const r = await parseAppleRecapInput({ emailText: RECAP, sentAt: '2026-07-07T12:00:00Z' })
    expect(r.status).toBe('ok')

    const row = buildInsightsRow({
      workspaceId: 'ws-1', locationId: 'loc-1', parsed: r.parsed, hasText: r.hasText, subject: 'Your June Insights',
    })
    expect(row).toMatchObject({
      workspace_id: 'ws-1',
      location_id: 'loc-1',
      period_month: '2026-06-01',
      place_card_views: 143,
      taps_from_search: 72,
      directions: 65,
      photos: 55,
      website: 3,
      call: 8,
      source: 'email_recap',
    })
    expect(row.raw_extract.subject).toBe('Your June Insights')
  })

  it('refuses an empty input rather than writing an empty row', async () => {
    const { parseAppleRecapInput } = await import('../../api/_lib/appleImport.js')
    expect((await parseAppleRecapInput({})).status).toBe('missing_pdf')
    expect((await parseAppleRecapInput({ emailText: '   ' })).status).toBe('missing_pdf')
  })

  it('caps an oversized body before it reaches the parser', async () => {
    const { parseAppleRecapInput, MAX_TEXT_CHARS } = await import('../../api/_lib/appleImport.js')
    const huge = 'x'.repeat(MAX_TEXT_CHARS + 1)
    expect((await parseAppleRecapInput({ emailText: huge })).status).toBe('invalid_text_size')
  })
})
