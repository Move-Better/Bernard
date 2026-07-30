// Who chose the media on a content item — the third override dimension for the
// confidence loop (migration 196).
//
// Extracted as a pure function ONLY so it can be genuinely tested. It first
// lived inline in db/content.js's PATCH handler, where a test could not reach
// it — so the tests re-implemented the rule and mutation testing proved them
// hollow: breaking the route's copy left every behavioural assertion green.
// Both the route and the tests now call this.

// Identity of a media entry. The asset id when known, else the url — so
// enriching an entry IN PLACE (attaching a 4:5 carousel variant, say) keeps the
// same identity and is correctly not read as the human rejecting Bernard's pick.
const keyOf = (m) => String(m?.mediaAssetId || m?.url || '')

// Compared as a SET, not a sequence: reordering slides is arranging, not
// swapping, and counting it would inflate a rate whose whole claim is "you
// swapped the photo on N of M".
const setOf = (arr) => [...new Set((arr || []).map(keyOf))].sort().join('|')

/**
 * Classify a media_urls change.
 *
 * Derived STRUCTURALLY from the change itself, never from a caller claim: the
 * editor's own auto-attach-on-open and a human's deliberate swap arrive through
 * the same PATCH from the same client, so a client-supplied provenance flag
 * would be wrong in both directions — and could trivially suppress real
 * overrides.
 *
 *   empty → non-empty      a first attach. Nobody's choice was overridden.
 *   non-empty → different  a REPLACEMENT. This is the override signal.
 *   same set               a no-op re-save (autosave round-trips do this
 *                          constantly) or a reorder. Neither is a swap.
 *
 * @returns {'human'|undefined} undefined means "record nothing" — NOT 'bernard'.
 *   Bernard's authorship is stamped where Bernard actually chooses
 *   (autoAttachMedia), not inferred from a human request that changed nothing.
 */
export function classifyMediaChange(before, after) {
  if (!Array.isArray(after)) return undefined
  const prev = Array.isArray(before) ? before : []
  if (prev.length === 0) return undefined
  return setOf(prev) === setOf(after) ? undefined : 'human'
}
