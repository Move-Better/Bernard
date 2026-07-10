// Story titles — one shared, date-first format across every entry type.
//
// Q's rule (2026-07-10): every story title reads `MM/DD/YY — {specific subject}`
// (e.g. "07/10/26 — Hip extension driving opposite-shoulder stability"). The
// subject recurs over years — a clinician discusses "hip & shoulder" a thousand
// times — so the DATE is what keeps titles unique + chronological at the scale
// of thousands of pieces over 20 years.
//
// APPROACH (Q, 2026-07-10): DISPLAY-TIME, not stamp-at-creation. The stored
// `interviews.topic` stays the PURE subject; the date is rendered from the
// row's `created_at` wherever the title is shown (Stories list, StoryDetail
// header, …). This is:
//   • non-destructive — the editable topic field never gets polluted with a date;
//   • uniform automatically — every entry type gets the date without touching
//     each creation path;
//   • retroactive — existing stories reformat too, so the list is consistent.
//
// IDEMPOTENT: the weekly outbound-call path (api/_lib/outboundCall.js) already
// bakes `MM/DD/YY — ` into the stored topic. `formatStoryDisplayTitle` strips
// any leading date prefix before re-deriving one from `created_at`, so those
// rows render identically (no "07/10/26 — 07/10/26 — …" doubling) and editing
// one saves the clean subject back.
//
// Mirrors the UTC MM/DD/YY logic in api/_lib/outboundCall.js `formatStoryDate`
// so the phone-call auto-title and the display helper agree to the character.

// Leading `MM/DD/YY — ` (em-dash, en-dash, or hyphen; any surrounding space).
const DATE_PREFIX_RE = /^\s*\d{2}\/\d{2}\/\d{2}\s*[—–-]\s*/

/**
 * UTC MM/DD/YY for a story's date. Empty string on a missing/invalid date so
 * callers can fall back to the bare subject rather than render "NaN/NaN/NaN".
 *
 * @param {string|number|Date} [dateInput] - defaults to now
 * @returns {string}
 */
export function formatStoryDate(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${mm}/${dd}/${yy}`
}

/**
 * Strip a leading `MM/DD/YY — ` from a stored topic, returning the pure subject.
 * Idempotent and safe on subjects that never had a date. Use this to seed an
 * editable topic field so the user edits (and saves) only the subject.
 *
 * @param {string} [topic]
 * @returns {string}
 */
export function stripStoryDatePrefix(topic) {
  return String(topic ?? '').replace(DATE_PREFIX_RE, '').trim()
}

/**
 * The canonical display title for a story: `MM/DD/YY — {subject}`.
 *
 * @param {object} story                 - normalized story ({ topic, created_at })
 * @param {object} [opts]
 * @param {string} [opts.fallback]       - subject to use when topic is empty
 * @returns {string}
 */
export function formatStoryDisplayTitle(story, { fallback = 'Untitled interview' } = {}) {
  const rawTopic =
    typeof story?.topic === 'string'
      ? story.topic
      : typeof story?.title === 'string'
        ? story.title
        : ''
  const subject = stripStoryDatePrefix(rawTopic) || fallback
  // Only prepend a date when the row actually carries one — never default to
  // "now", which would mislabel an old story that happens to lack created_at.
  const dateStr = story?.created_at ? formatStoryDate(story.created_at) : ''
  return dateStr ? `${dateStr} — ${subject}` : subject
}
