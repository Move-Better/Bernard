// Format-agnostic photo GRADE parameters — the shared colorist schema.
//
// One param object, multiple emitters:
//   - applyGradeParamsSharp(pipeline, params) — SERVER (Sharp) → the published bake
//   - gradeToCanvasFilter(params)             — CLIENT (canvas/CSS) → editor preview
//   - (later) an ffmpeg emitter for video, same params → format parity
//
// Canonical params are signed -100..100, NEUTRAL (all 0) = identity render, so a
// legacy row with no gradeParams renders byte-identically (callers gate on
// presence). Coefficients are deliberately RESTRAINED (subject-safe): a clinician
// must never look unnatural. Editor sliders expose five "essentials"
// (Brightness/Warmth/Contrast/Vibrance/Depth) that map onto these canonical params.

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

// Editor "essentials" → canonical params. The editor stores canonical params
// (via this) so every emitter reads one shape.
export function essentialsToParams(e = {}) {
  return normalizeGrade({
    exposure:   e.brightness,
    warmth:     e.warmth,
    contrast:   e.contrast,
    saturation: e.vibrance,
    depth:      e.depth,
  })
}

// Restrained coefficients. At a slider extreme (±100): brightness ±35%,
// saturation ±55%, contrast gain 0.55..1.45, warmth ±14% R/B, tint ±10% G,
// depth up to gamma 1.3. Tuned to stay believable on skin.
const K = {
  exposure: 0.0035,
  satMul:   0.0055,
  contrast: 0.0045,
  warmth:   0.0014,
  tint:     0.0010,
  depthGamma: 0.003,
}

/**
 * Apply grade params to a Sharp pipeline and return the chained pipeline.
 * Neutral params → pipeline returned unchanged (identity). Never throws on bad
 * input (normalizeGrade coerces). Order: modulate (brightness/saturation) →
 * linear (contrast pivot + warmth/tint per-channel gains) → gamma (depth).
 */
export function applyGradeParamsSharp(pipeline, params) {
  if (!pipeline) return pipeline
  const p = normalizeGrade(params)
  if (isNeutralGrade(p)) return pipeline

  const brightness = 1 + p.exposure * K.exposure
  const saturation = Math.max(0, 1 + p.saturation * K.satMul)
  if (brightness !== 1 || saturation !== 1) {
    pipeline = pipeline.modulate({ brightness, saturation })
  }

  // Contrast as a linear pivot around mid (128), combined with warmth (R up / B
  // down) and tint (G) as per-channel gains so it's a single linear pass.
  const a = 1 + p.contrast * K.contrast
  const rGain = a * (1 + p.warmth * K.warmth)
  const gGain = a * (1 + p.tint * K.tint)
  const bGain = a * (1 - p.warmth * K.warmth)
  const bias = -(a - 1) * 128
  if (a !== 1 || p.warmth || p.tint) {
    pipeline = pipeline.linear([rGain, gGain, bGain], [bias, bias, bias])
  }

  // Depth → gamma. Sharp gamma only supports >= 1.0, so depth only DEEPENS
  // midtones (a filmic falloff); negative depth is folded into a mild brightness
  // lift handled above (exposure), so here we only act on positive depth.
  if (p.depth > 0) {
    pipeline = pipeline.gamma(clamp(1 + p.depth * K.depthGamma, 1, 3))
  }

  return pipeline
}

/**
 * CSS/canvas filter string approximating the same grade for the in-editor
 * preview (the published pixels come from the Sharp emitter; this is the live
 * proxy). Kept in lockstep with the Sharp coefficients above.
 */
export function gradeToCanvasFilter(params) {
  const p = normalizeGrade(params)
  if (isNeutralGrade(p)) return 'none'
  const brightness = (1 + p.exposure * K.exposure).toFixed(3)
  const contrast = (1 + p.contrast * K.contrast).toFixed(3)
  const saturate = Math.max(0, 1 + p.saturation * K.satMul).toFixed(3)
  const sepia = Math.max(0, p.warmth * 0.003).toFixed(3)
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturate}) sepia(${sepia})`
}
