// Apple Business Connect — monthly "Insights" recap parser.
//
// Apple emails a monthly Insights recap (one per location) that renders to a
// clean, text-layer PDF. unpdf gives a single merged-line text stream, so every
// value is label-anchored and extraction is layout-tolerant.
//
// v1 is EXTRACT-ONLY: we parse the six Core metrics + year-over-year for the
// two headline metrics, then discard the source PDF. We never fabricate a YoY
// direction — interaction YoY carries a magnitude only, because Apple renders
// the ↑/↓ arrow as a stripped image that the text layer cannot see.
//
// Reference sample (Move Better, 237 NE Broadway, June 2026):
//   "... Move Better 237 NE Broadway Portland, OR 97232 Insights Summary
//    Jun 1 - 30 PLACE CARD VIEWS 143 42% from June last year TAPS FROM SEARCH
//    72 29% from June last year Trends 29% This location has 29% more taps ...
//    42% This location has 42% more views ... Directions65 8% from June last
//    year Photos55 Over 100% from June last year Website3 Call8 100% ..."
//
// EMAIL-SOURCED recaps need an extra step before any of the above applies.
// Confirmed 2026-10-07 by reading the real HTML of two live recaps: Apple's
// markup puts every number in its OWN element (a bar-chart-total-value span,
// an ACTION_DIRECTIONS__value span, a YoY-percent span several divs later)
// with ZERO literal whitespace between adjacent tags. A plaintext conversion
// that doesn't synthesize whitespace at block boundaries then glues a value
// straight onto its own YoY percentage — "223" + "91%" becomes "22391%" —
// whenever nothing else (no "Over", no literal space in a text node)
// separates them in the source. This fires on every metric whose YoY change
// isn't phrased as "Over 100%", i.e. most months, and it's silent: the
// corrupted number parses as a plausible-looking integer, not a crash.
// htmlToRecapText() below is the fix — see its own comment.

import { extractText, getDocumentProxy } from 'unpdf'

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

function toInt(s) {
  if (s == null) return null
  const n = parseInt(String(s).replace(/[,\s]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

// "<LABEL> <digits>" — the number may be glued to the label ("Directions65"),
// space-separated ("PLACE CARD VIEWS 143"), or glued through a markdown-style
// bold marker ("*Directions*74"). That last shape is not a PDF artifact: an
// email-sourced recap is Apple's HTML converted to text/plain by Gmail (when
// forwarded) or by whatever fetched the message body, and Gmail renders a
// <strong>Directions</strong> span as *Directions* with no separating
// whitespace before the value that follows it.
function labelNumber(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped + '\\*?\\s*([0-9][0-9,]*)', 'i')
  const m = text.match(re)
  return m ? toInt(m[1]) : null
}

// Apple itself declares some interaction metrics unavailable ("Not enough
// data") rather than printing a number — that is a legitimate null, not a
// parse failure, and must not be warned about the same way a truly-missing
// number is.
function labelHasNoData(text, label) {
  const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\*?\\s*Not enough data', 'i')
  return re.test(text)
}

// Normalize an Apple recap's raw HTML body into the flattened-text shape
// parseAppleRecapText expects, WITHOUT the gluing defect a plaintext
// conversion introduces (see the top-of-file comment for the mechanism).
//
// The fix is structural, not a digit-splitting heuristic: reinsert a real
// separator at every block-level tag boundary (div/p/li/ul/ol/tr/table/h#/br)
// BEFORE stripping tags, so numbers that live in sibling block elements stay
// separated downstream. Inline elements (span/strong/a) are left alone —
// those are exactly the glued-by-design shapes ("Directions65",
// "*Directions*74") that labelNumber() already tolerates via its \s*
// (zero-or-more) matching, and inserting whitespace there would be harmless
// but unnecessary.
export function htmlToRecapText(html) {
  let text = String(html || '')
  // Drop style/script wholesale — their contents can carry stray digits or
  // label-shaped words that would otherwise leak into the flattened text.
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
  const BLOCK = '(?:div|p|li|ul|ol|tr|table|h[1-6]|br)'
  text = text.replace(new RegExp(`</${BLOCK}\\s*>`, 'gi'), ' ')
  text = text.replace(new RegExp(`<${BLOCK}(?:\\s[^>]*)?>`, 'gi'), ' ')
  text = text.replace(/<[^>]+>/g, '')
  // The handful of entities Apple's markup actually uses — not a general
  // HTML-entity decoder.
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
  return text.replace(/\s+/g, ' ').trim()
}

// Signed YoY from the sentence form: "42% more views" / "12% fewer taps".
// Same asterisk tolerance as labelNumber above — Gmail's plaintext rendering
// wraps BOTH the percentage ("*50%*") and the more/fewer/less word ("*more*")
// in their own bold markers, each glued with no separating whitespace.
function sentenceYoY(text, noun) {
  const re = new RegExp('([0-9][0-9.]*)\\s*%\\*?\\s+\\*?(more|fewer|less)\\*?\\s+' + noun, 'i')
  const m = text.match(re)
  if (!m) return null
  const mag = parseFloat(m[1])
  if (!Number.isFinite(mag)) return null
  return (/more/i.test(m[2]) ? 1 : -1) * mag
}

// Parse the merged text of an Apple monthly Insights recap.
// Returns { ok:false, error, warnings } on a non-recap / unresolvable input,
// or { ok:true, periodMonth, address, metrics, yoy, warnings } on success.
export function parseAppleRecapText(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim()
  const warnings = []

  const looksApple = /Insights Summary/i.test(text) && /PLACE CARD VIEWS/i.test(text)
  if (!looksApple) {
    return {
      ok: false,
      error: 'not_apple_recap',
      warnings: ['This PDF does not look like an Apple Business Connect monthly Insights recap.'],
    }
  }

  // --- Report month + year ---------------------------------------------------
  // The recap names its own month ("Your June Insights" / "Insights Summary Jun
  // 1 - 30"); the year comes from the email send date, since a recap is always
  // for the previous calendar month (a December recap arrives the next January).
  const titleM = text.match(/Your\s+([A-Z][a-z]+)\s+Insights/i)
  const summaryM = text.match(/Insights Summary\s+([A-Z][a-z]{2,})\s+\d/i)
  const monthName = (titleM?.[1] || summaryM?.[1] || '').toLowerCase()
  const monthIdx = MONTHS.findIndex((m) => m === monthName || (monthName.length >= 3 && m.startsWith(monthName)))

  const sentM = text.match(/\b([A-Z][a-z]+)\s+\d{1,2},\s+(\d{4})\b/) // "July 7, 2026"
  let year = null
  if (sentM) {
    const sentMonthIdx = MONTHS.findIndex((m) => m === sentM[1].toLowerCase())
    const sentYear = toInt(sentM[2])
    if (sentYear != null) {
      year = (monthIdx >= 0 && sentMonthIdx >= 0 && monthIdx > sentMonthIdx) ? sentYear - 1 : sentYear
    }
  }

  if (monthIdx < 0) warnings.push('Could not determine the report month.')
  if (year == null) warnings.push('Could not determine the report year.')

  const periodMonth = (monthIdx >= 0 && year != null)
    ? `${year}-${String(monthIdx + 1).padStart(2, '0')}-01`
    : null
  if (!periodMonth) {
    return { ok: false, error: 'no_period', warnings: [...warnings, 'Could not resolve the report month/year.'] }
  }

  // --- Location line (display / verification only) ---------------------------
  // The business name + address sit between the header "Sign In" link and
  // "Insights Summary": "... Sign In Move Better 237 NE Broadway Portland, OR
  // 97232 Insights Summary ...". Bounded capture so it can't swallow the header.
  let address = null
  const locM = text.match(/Sign In\s+(.{5,80}?,\s+[A-Z]{2}\s+\d{5})\s+Insights Summary/i)
  if (locM) address = locM[1].trim()

  // --- Core metrics ----------------------------------------------------------
  const INTERACTION_LABELS = [
    ['directions', 'Directions'],
    ['photos', 'Photos'],
    ['website', 'Website'],
    ['call', 'Call'],
  ]
  const metrics = {
    placeCardViews: labelNumber(text, 'PLACE CARD VIEWS'),
    tapsFromSearch: labelNumber(text, 'TAPS FROM SEARCH'),
    directions: labelNumber(text, 'Directions'),
    photos: labelNumber(text, 'Photos'),
    website: labelNumber(text, 'Website'),
    call: labelNumber(text, 'Call'),
  }
  if (metrics.placeCardViews == null) warnings.push('Missing metric: place card views.')
  if (metrics.tapsFromSearch == null) warnings.push('Missing metric: taps from search.')
  for (const [key, label] of INTERACTION_LABELS) {
    if (metrics[key] == null && !labelHasNoData(text, label)) {
      warnings.push(`Missing metric: ${label.toLowerCase()}.`)
    }
  }

  // --- Year-over-year --------------------------------------------------------
  // Signed only for the two headline metrics (the sentence form states
  // direction). Interaction YoY is magnitude-only by design.
  const interactions = {}
  for (const [key, noun] of [['directions', 'Directions'], ['photos', 'Photos'], ['call', 'Call']]) {
    const re = new RegExp(noun + '\\*?\\s*[0-9][0-9,]*\\s+(Over\\s+)?([0-9][0-9.]*)%\\s+from', 'i')
    const m = text.match(re)
    if (m) interactions[key] = { magnitudePct: parseFloat(m[2]), atLeast: !!m[1] }
  }

  return {
    ok: true,
    periodMonth,
    address,
    metrics,
    yoy: {
      viewsPct: sentenceYoY(text, 'views'),
      tapsPct: sentenceYoY(text, 'taps'),
      interactions,
    },
    warnings,
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Prepare a recap EMAIL body for parseAppleRecapText.
//
// parseAppleRecapText resolves the report YEAR from the first
// "<Month> <D>, <YYYY>" in the text, because a recap is always for the PRIOR
// calendar month and the send date is what disambiguates a December recap read
// in January. A PDF's text layer carries that date; an email body may not, so
// the message's own send date is APPENDED as a fallback.
//
// Appending (never prepending) is the whole contract: the parser takes the
// FIRST match, so a date genuinely present in the body always wins and this can
// only fill a gap. Prepending would let the envelope silently override the
// document, which is the bug this shape exists to prevent.
export function prepareRecapEmailText(emailText, sentAt) {
  const text = String(emailText || '')
  if (sentAt == null) return text
  const d = sentAt instanceof Date ? sentAt : new Date(sentAt)
  if (Number.isNaN(d.getTime())) return text
  return `${text} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

// Parse an Apple recap from raw PDF bytes.
export async function parseAppleRecapPdf(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  return parseAppleRecapText(text)
}
