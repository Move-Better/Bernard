// What Instagram's feed will actually do to a photo.
//
// The feed accepts anything between 1.91:1 (landscape) and 4:5 (portrait) and
// crops whatever falls outside that range back to the nearest edge of it.
// Everything inside the range posts untouched — Instagram does NOT square-crop,
// which is what Bernard's preview used to imply.
//
// Only relevant to the raw-photo path: a piece with slides publishes a baked
// image at the deck's aspect, which is already inside this range, so Instagram
// never touches it.

// Expressed as width / height, so a SMALLER number is taller.
export const IG_WIDEST_AR  = 1.91  // 1.91:1 — wider than this gets its sides trimmed
export const IG_TALLEST_AR = 0.8   // 4:5    — taller than this gets top and bottom trimmed

/**
 * @param {number} width  natural pixel width of the photo
 * @param {number} height natural pixel height
 * @returns {{aspect:number, croppedPct:number, trims:(string|null)}|null}
 *   `aspect` is the width/height Instagram renders at; `croppedPct` is how much
 *   of the image area is discarded; `trims` names the edges, or null when the
 *   photo posts whole. Returns null when the dimensions aren't usable.
 */
export function instagramFeedFrame(width, height) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null

  const ar = w / h

  if (ar < IG_TALLEST_AR) {
    // Too tall: Instagram keeps a 4:5 window out of the middle.
    return {
      aspect: IG_TALLEST_AR,
      croppedPct: Math.round((1 - ar / IG_TALLEST_AR) * 100),
      trims: 'the top and bottom',
    }
  }
  if (ar > IG_WIDEST_AR) {
    return {
      aspect: IG_WIDEST_AR,
      croppedPct: Math.round((1 - IG_WIDEST_AR / ar) * 100),
      trims: 'the sides',
    }
  }
  return { aspect: ar, croppedPct: 0, trims: null }
}
