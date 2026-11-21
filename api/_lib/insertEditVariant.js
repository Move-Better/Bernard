// Insert a rotate/crop variant row, numbering its label when the name is taken.
//
// Migration 203's partial unique index media_assets_aspect_variant_unique
// (parent_id, variant_label) WHERE archived_at IS NULL AND variant_label IS NOT NULL
// refuses a second live variant of one master with the same label. Q ruled
// 2026-11-19 that a second "9:16 Vertical" crop keeps both: the new one saves as
// "9:16 Vertical (2)", then "(3)", and so on. Nothing is replaced, so a post
// already using the first crop is untouched.
//
// Retrying on the conflict (rather than reading existing labels first) is also
// what makes two simultaneous saves safe: the loser just takes the next number.

import { RESERVED_VARIANT_LABELS } from './aspectVariants.js'

const VARIANT_INDEX = 'media_assets_aspect_variant_unique'
// ponytail: 20 same-named live crops of one master is far past real use; past
// that the save fails loudly instead of looping. Raise if anyone ever hits it.
const MAX_ATTEMPTS = 20

/**
 * @param {(path: string, init?: object) => Promise<Response>} sb  PostgREST caller
 * @param {object} row  the media_assets variant row (variant_label set)
 * @returns {Promise<object|null>} the inserted row
 */
export async function insertEditVariant(sb, row) {
  const base = row.variant_label
  // saveAspectVariant finds its carousel bake by (parent_id, variant_label) and
  // PATCHes it, so a user crop holding that label would be overwritten by the
  // next render. Start numbering at (2) for a reserved label, even when free.
  const first = RESERVED_VARIANT_LABELS.includes(base) ? 2 : 1
  for (let n = first; n <= MAX_ATTEMPTS; n++) {
    const variant_label = n === 1 ? base : `${base} (${n})`
    const ins = await sb('media_assets', { method: 'POST', body: JSON.stringify({ ...row, variant_label }) })
    if (ins.ok) return (await ins.json())[0] || null
    const text = await ins.text()
    const labelTaken = text.includes('23505') && text.includes(VARIANT_INDEX)
    if (!labelTaken) throw new Error(`Insert variant failed: ${ins.status} ${text}`)
  }
  throw new Error(`Insert variant failed: ${MAX_ATTEMPTS} live variants already named "${base}"`)
}
