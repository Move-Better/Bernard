// Fitting a clip into a 4:5 carousel slot.
//
// Cropping 9:16 → 4:5 removes 285px off a 1920px source, which lifts the
// subject in frame while the caption margin stays a fixed fraction of height.
// They converge, and the caption lands on the subject's face. Measured on a
// real clip 2026-07-29 (four bakes compared side by side) — this is structural,
// not one unlucky video: any clip whose subject sits in the upper half collides.
//
// So a 4:5 bake needs its OWN reframe. It cannot be derived from the reel's —
// replaying that IS what produces the collision. Bernard proposes a downward
// nudge, the producer confirms or drags, and the confirm-vs-drag is override
// signal for the format-confidence loop.
//
// Alias-free: cross-imported by the serverless API, same rule as mediaEntry.js.

// How far down to push the crop window, as a fraction of the source height.
// y=0.5 is the centre crop (what a naive re-bake does); higher moves the window
// DOWN the source, which moves the subject DOWN in the output frame, away from
// a top-positioned caption.
//
// 0.68 is the value that read cleanly on the measured clip. It is a STARTING
// POINT the human adjusts, deliberately not a computed "correct" answer — the
// honest input (where the subject actually is) needs face/subject detection we
// don't have here, and inventing a precise-looking number from data we lack
// would be worse than an admitted default.
export const CAROUSEL_REFRAME_Y = 0.68
export const CENTER_REFRAME_Y = 0.5

// Aspect below which a source needs re-framing to sit in a 4:5 slot at all.
// Instagram rejects carousel items under 0.8 (verified live 2026-07-29).
export const CAROUSEL_MIN_ASPECT = 0.8

/**
 * Does this source need a 4:5 re-bake before it can join a carousel?
 *
 * A 16:9 master (1.78) sits INSIDE Instagram's 0.8–1.91 window and is natively
 * eligible — it needs nothing. A 9:16 vertical (0.5625) is below the floor and
 * would be rejected outright, so it must be re-baked.
 */
export function needsCarouselRebake({ width, height } = {}) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false
  return w / h < CAROUSEL_MIN_ASPECT
}

/**
 * The reframe to propose for a clip entering a 4:5 slot.
 *
 * @param {Object}  p
 * @param {Object}  [p.sourceReframe] the reel's reframe, if the clip has one
 * @param {string}  [p.captionPos]    where captions sit in the 4:5 bake
 * @returns {{zoom:number,x:number,y:number}}
 */
export function proposeCarouselReframe({ sourceReframe = null, captionPos = 'top' } = {}) {
  const zoom = Number(sourceReframe?.zoom) > 0 ? Number(sourceReframe.zoom) : 1
  // Horizontal intent carries over untouched — the crop only loses height, so a
  // left/right choice the producer already made stays valid.
  const x = Number.isFinite(sourceReframe?.x) ? sourceReframe.x : 0.5
  // Only a TOP-positioned caption collides with a subject that rises in frame.
  // With captions at the bottom the collision is with the brand band instead,
  // which moving the crop cannot fix (measured: bottom is strictly worse), so
  // don't pretend a nudge helps — leave it centred and let the human decide.
  const y = captionPos === 'top' ? CAROUSEL_REFRAME_Y : CENTER_REFRAME_Y
  return { zoom, x, y }
}

/** Clamp a producer-dragged vertical position into the meaningful range. */
export function clampReframeY(y) {
  const n = Number(y)
  if (!Number.isFinite(n)) return CENTER_REFRAME_Y
  return Math.max(0, Math.min(1, n))
}
