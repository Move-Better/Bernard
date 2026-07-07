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

// "<LABEL> <digits>" — the number may be glued to the label ("Directions65")
// or space-separated ("PLACE CARD VIEWS 143").
function labelNumber(text, label) {
  const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*([0-9][0-9,]*)', 'i')
  const m = text.match(re)
  return m ? toInt(m[1]) : null
}

// Signed YoY from the sentence form: "42% more views" / "12% fewer taps".
function sentenceYoY(text, noun) {
  const re = new RegExp('([0-9][0-9.]*)\\s*%\\s+(more|fewer|less)\\s+' + noun, 'i')
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

  // --- Year-over-year --------------------------------------------------------
  // Signed only for the two headline metrics (the sentence form states
  // direction). Interaction YoY is magnitude-only by design.
  const interactions = {}
  for (const [key, noun] of [['directions', 'Directions'], ['photos', 'Photos'], ['call', 'Call']]) {
    const re = new RegExp(noun + '\\s*[0-9][0-9,]*\\s+(Over\\s+)?([0-9][0-9.]*)%\\s+from', 'i')
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

// Parse an Apple recap from raw PDF bytes.
export async function parseAppleRecapPdf(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  return parseAppleRecapText(text)
}
