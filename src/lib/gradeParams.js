// CLIENT mirror of the colorist grade schema. Kept in LOCKSTEP with the server
// copy `api/_lib/gradeParams.js` (the client/server import boundary forbids
// sharing one file) — the coefficients K and ranges MUST match so the in-editor
// canvas preview matches the published bake. If you change one, change both.
//
// Canonical params are signed -100..100, NEUTRAL (all 0) = identity. The editor
// sliders expose five "essentials" that map onto the canonical params.

export const NEUTRAL_GRADE = Object.freeze({
  exposure: 0, contrast: 0, saturation: 0, warmth: 0, tint: 0, depth: 0,
})

const clamp = (n, lo, hi) => {
  const v = Number(n)
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0))
}

export function normalizeGrade(params = {}) {
  const p = params || {}
  return {
    exposure:   clamp(p.exposure,   -100, 100),
    contrast:   clamp(p.contrast,   -100, 100),
    saturation: clamp(p.saturation, -100, 100),
    warmth:     clamp(p.warmth,     -100, 100),
    tint:       clamp(p.tint,       -100, 100),
    depth:      clamp(p.depth,      -100, 100),
  }
}

export function isNeutralGrade(params) {
  const p = normalizeGrade(params)
  return !p.exposure && !p.contrast && !p.saturation && !p.warmth && !p.tint && !p.depth
}

// The five editor sliders → canonical params (and back, for display). Brightness→
// exposure, Warmth→warmth, Contrast→contrast, Vibrance→saturation, Depth→depth.
// `tint` has no slider (reserved for the describe-a-look / brand preset).
export const GRADE_SLIDERS = [
  { key: 'exposure',   label: 'Brightness' },
  { key: 'warmth',     label: 'Warmth' },
  { key: 'contrast',   label: 'Contrast' },
  { key: 'saturation', label: 'Vibrance' },
  { key: 'depth',      label: 'Depth' },
]

// One-tap "vibes" — start points the user then fine-tunes. Subject-safe, but
// pulled further apart so each reads distinctly: bright = airy + cool + punchy
// (flat); warm = heavy amber + lifted + soft; editorial = crushed contrast +
// desaturated + cool + deep; moody = dark + very deep + muted + slightly warm.
export const GRADE_VIBES = [
  { id: 'bright',   label: 'Bright & clean', params: { exposure: 32, contrast: 6,  saturation: 26, warmth: -16, depth: 0 } },
  { id: 'warm',     label: 'Warm & filmic',  params: { exposure: 10, contrast: 4,  saturation: 14, warmth: 55,  depth: 14 } },
  { id: 'editorial',label: 'Editorial',      params: { exposure: -6, contrast: 45, saturation: -30, warmth: -6, depth: 32 } },
  { id: 'moody',    label: 'Moody',          params: { exposure: -34, contrast: 34, saturation: -20, warmth: 14, depth: 48 } },
]

export function essentialsToParams(e = {}) {
  return normalizeGrade({
    exposure:   e.brightness,
    warmth:     e.warmth,
    contrast:   e.contrast,
    saturation: e.vibrance,
    depth:      e.depth,
  })
}

// MUST match K in api/_lib/gradeParams.js.
const K = {
  exposure: 0.0035,
  satMul:   0.0055,
  contrast: 0.0045,
  warmth:   0.0014,
  tint:     0.0010,
  depthGamma: 0.003,
}

// CSS/canvas filter string for the in-editor preview AND the carousel bake (both
// run through renderFreeformSlide on a DOM canvas). Returns 'none' when neutral.
export function gradeToCanvasFilter(params) {
  const p = normalizeGrade(params)
  if (isNeutralGrade(p)) return 'none'
  const brightness = (1 + p.exposure * K.exposure).toFixed(3)
  const contrast = (1 + p.contrast * K.contrast).toFixed(3)
  const saturate = Math.max(0, 1 + p.saturation * K.satMul).toFixed(3)
  // warmth → a touch of sepia (warm) ; the sign only warms (cool stays neutral in
  // the CSS proxy; the Sharp bake does the true cool via per-channel gain).
  const sepia = Math.max(0, p.warmth * 0.003).toFixed(3)
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturate}) sepia(${sepia})`
}
