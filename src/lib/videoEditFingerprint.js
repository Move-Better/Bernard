// Does a video piece have editor edits that were never rendered into the post?
//
// #2638 made the embedded VideoEditor bake the pending edit before Approve /
// Schedule / Publish, so those buttons stop shipping the untouched auto-reel
// (feedback f46a0eec). But /week's inline Approve never opens that editor: it
// calls api/_routes/content-plan/approve.js, which dispatches SERVER-side from
// the stored content_items.media_urls. Edit a reel, leave without committing,
// approve from /week — the pre-edit render ships, and the operator has no idea.
//
// The server cannot re-run the bake itself. The render call is server-side
// (/api/editorial/render-clip), but its payload is assembled from live editor
// state (renderBody in VideoEditor.jsx: the resolved raw-source window, the
// captions-baked lock, per-line caption words). Reproducing that assembly on
// the server would be a second copy of the WYSIWYG contract — the client/server
// mirror-pair hazard in CLAUDE.md, and this bug is precisely a WYSIWYG bug. So
// the server's job is to DETECT the gap and route the operator to the editor,
// where the one existing bake path runs.
//
// Detecting it needs a marker, because draft EXISTENCE is not dirtiness:
// VideoEditor's autosave persists media_assets.video_edit_draft unconditionally
// once hydrated, so merely opening a reel writes a draft. The bake therefore
// stamps the fingerprint of the doc it rendered onto the media entry it wrote
// (`videoEditHash`), and pending-ness is a mismatch between that stamp and the
// current draft — not the presence of either.
//
// ── The trap this file exists to survive ─────────────────────────────────────
// The draft is written by the browser and read back out of Postgres jsonb, and
// **jsonb does not preserve key order**. `JSON.stringify(clientDoc)` and
// `JSON.stringify(rowFromPostgres)` are therefore different strings for the
// same document, so a stringify-based comparison would mismatch on every single
// dispatch — a permanent decline that looks exactly like a real pending edit.
// Everything here canonicalizes (recursively key-sorted) before hashing.
//
// Shared by the client (which writes the stamp) and the server (which reads
// it), one copy, so the two can never disagree about what "already baked"
// means — same argument as src/lib/publishLock.js.

import { isVideoEntry } from './mediaEntry.js'

/** Bumped if the canonical form ever changes, so old stamps read as stale
 *  (→ one extra bake) instead of silently comparing against a new encoding. */
const FINGERPRINT_VERSION = 'v1'

/** The media-entry key holding the fingerprint of the draft that was baked. */
export const VIDEO_EDIT_HASH_KEY = 'videoEditHash'

/**
 * Deterministic JSON: object keys sorted at every depth, array order preserved.
 *
 * Arrays are NEVER sorted — position is meaningful throughout the draft doc
 * (cut order, overlay z-order, caption line sequence), and sorting them would
 * make two genuinely different edits fingerprint identically.
 *
 * Mirrors JSON.stringify's own treatment of undefined (dropped from objects,
 * null inside arrays) so a doc that round-trips through JSON is unchanged here.
 */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    // Delegates number formatting and string escaping to the engine, which is
    // identical across the runtimes this runs in.
    const out = JSON.stringify(value)
    return out === undefined ? undefined : out
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v) ?? 'null').join(',')}]`
  }
  const parts = []
  for (const key of Object.keys(value).sort()) {
    const encoded = canonicalJson(value[key])
    if (encoded === undefined) continue
    parts.push(`${JSON.stringify(key)}:${encoded}`)
  }
  return `{${parts.join(',')}}`
}

/** cyrb53 — small, synchronous, dependency-free, identical in node and the
 *  browser (crypto.subtle is async in the browser, which this cannot be). */
function cyrb53(str) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * Stable fingerprint of a video edit draft doc.
 *
 * @param {object|null|undefined} doc  VideoEditor's draftDoc, or the
 *   media_assets.video_edit_draft row value read back from jsonb.
 * @returns {string|null} null when there is no doc to fingerprint.
 */
export function videoEditFingerprint(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  const canonical = canonicalJson(doc)
  if (canonical === undefined) return null
  // Length is carried alongside the hash: free, and it makes a collision need
  // to match two independent properties of the document.
  return `${FINGERPRINT_VERSION}:${canonical.length.toString(36)}.${cyrb53(canonical).toString(36)}`
}

/**
 * The video entry a VideoEditor draft would belong to, or null.
 *
 * Scoped to pieces that actually OPEN the timeline editor — the same condition
 * StoryboardPublish routes on (a vvideo/lvideo archetype plus a video entry
 * carrying a mediaAssetId). That coupling is the point: the remedy for a
 * pending edit is "go approve it at /publish/:id", which is only a remedy if
 * that route lands on the VideoEditor. A carousel that merely contains a clip
 * opens SlideEditor, which has no video bake, so sending its operator there
 * would be a dead end — it is deliberately not covered here.
 *
 * An entry with no mediaAssetId (a hand-attached URL) has no asset to hold a
 * draft, so there is nothing to check and nothing to defer.
 *
 * @param {object} piece   content_items row (platform, format, media_urls)
 * @param {string} archetype  resolveArchetype(piece)
 */
export function videoEditTarget(piece, archetype) {
  if (archetype !== 'vvideo' && archetype !== 'lvideo') return null
  const media = Array.isArray(piece?.media_urls) ? piece.media_urls : []
  const entry = media.find((m) => isVideoEntry(m) && m?.mediaAssetId)
  return entry ? { entry, assetId: entry.mediaAssetId } : null
}

/**
 * Is this entry's video out of date with respect to the saved edit draft?
 *
 * Truth table — the middle row is the one that keeps /week fast:
 *
 *   draft absent            → false  never opened in the editor; the auto-reel
 *                                    IS the artifact. Dispatches untouched.
 *   draft matches the stamp → false  already baked; a redundant Save→Approve
 *                                    must not cost a re-render.
 *   draft, no/other stamp   → true   the render and the saved edit can't be
 *                                    shown to agree. Defer to the editor.
 *
 * The third row includes "opened, changed nothing, never committed", because
 * nothing distinguishes that from a real edit at this layer — the auto-reel was
 * rendered from segment params, not from a draft doc, so there is no baseline
 * doc to compare a zero-edit draft against. VideoEditor takes the same stance
 * for the same reason (lastBakedDoc starts null, so its first commit always
 * bakes). Erring this way costs one click and one re-render; erring the other
 * way ships a post that doesn't match what the operator approved.
 */
export function isVideoEditUnbaked(entry, videoEditDraft) {
  const draftPrint = videoEditFingerprint(videoEditDraft)
  if (!draftPrint) return false
  return entry?.[VIDEO_EDIT_HASH_KEY] !== draftPrint
}
