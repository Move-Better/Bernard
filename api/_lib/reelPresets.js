// api/_lib/reelPresets.js
//
// The reel look library. Each preset is a named bundle of choices the renderer
// already understands — an overlay role for the headline (or none), a caption
// position, style and size. No preset introduces a new renderer; they compose
// primitives that already exist in videoOverlays.js / karaokeCaptions.js.
//
// WHY A LIBRARY AND NOT ONE DEFAULT
// The preset choice is the learnable signal. "Which of these four did a human
// pick / keep / change" is answerable at N=5 and gets more confident with use.
// "How far did they nudge the card" is not learnable at any N we will realistically
// reach — it is noise in a continuous space. So the affordance is deliberately
// CATEGORICAL: a small set of looks each designed to be good, rather than a pile
// of sliders. Free-form edits stay possible in the editor; they just aren't the
// thing we learn from.
//
// Adding a preset here makes it available to the rotation and to the editor. Keep
// the set small — the point is a decision a human can make in one glance.

/** @typedef {'captions_only'|'hook_card'|'kinetic'|'editorial'} ReelPresetId */

export const REEL_PRESETS = {
  // The safe floor. No headline at all, so nothing can truncate and nothing can
  // collide. Closest to what plain talking-head reels look like.
  captions_only: {
    id: 'captions_only',
    label: 'Captions only',
    headlineRole: null,
    captionPosition: 'bottom',
    captionStyle: 'bold',
    captionSize: 'medium',
    headlineY: null,
  },

  // Inset card, brand colour as a rule. Keeps the hook working for retention
  // without the full-bleed slab. Degrades to captions_only when no headline fits.
  hook_card: {
    id: 'hook_card',
    label: 'Hook card',
    headlineRole: 'hook_card',
    captionPosition: 'bottom',
    captionStyle: 'bold',
    captionSize: 'medium',
    headlineY: 0.17,
  },

  // Current-trend CapCut look: no headline, captions centred and large with the
  // spoken word filled in the brand colour. Punchy for a cold audience; it is
  // also a look with a shelf life, which is the point of measuring it.
  kinetic: {
    id: 'kinetic',
    label: 'Kinetic',
    headlineRole: null,
    captionPosition: 'center',
    captionStyle: 'accent_fill',
    captionSize: 'large',
    headlineY: null,
  },

  // Headline set directly on the frame with a drop shadow (the existing `title`
  // overlay role), captions small at the bottom. More premium; relies on a dark
  // enough backdrop, so it is the one most likely to fail on a bright frame.
  editorial: {
    id: 'editorial',
    label: 'Editorial',
    headlineRole: 'title',
    captionPosition: 'bottom',
    captionStyle: 'bold',
    // 'medium', not 'small'. Small is 0.75x the base — legible on a desktop
    // preview and too small on the phone these are actually watched on. It reads
    // as restrained in a mockup and as an accident in the feed.
    captionSize: 'medium',
    headlineY: 0.20,
  },
}

export const REEL_PRESET_IDS = Object.keys(REEL_PRESETS)

/** Resolve a preset by id, falling back to hook_card for an unknown value. */
export function resolveReelPreset(id) {
  return REEL_PRESETS[id] || REEL_PRESETS.hook_card
}

/**
 * Pick a preset for a segment.
 *
 * Deterministic rotation over the preset ids, keyed on the segment's own id, so
 * that:
 *   - every preset gets real use rather than one winning by default,
 *   - the same segment always renders the same way (re-running the factory is
 *     idempotent, and a resumed run can't silently switch looks mid-flight),
 *   - no Math.random, which would make a render unreproducible.
 *
 * An explicit workspace preference wins outright — rotation is for the learning
 * period, not forever.
 *
 * @param {string} segmentId
 * @param {string|null} [workspacePreference] — pinned preset id, if the workspace has chosen one
 * @returns {object} the resolved preset
 */
export function pickReelPreset(segmentId, workspacePreference = null) {
  if (workspacePreference && REEL_PRESETS[workspacePreference]) {
    return REEL_PRESETS[workspacePreference]
  }
  const key = String(segmentId || '')
  let h = 0
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0
  const idx = Math.abs(h) % REEL_PRESET_IDS.length
  return REEL_PRESETS[REEL_PRESET_IDS[idx]]
}
