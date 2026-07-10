import { normalizeGrade, GRADE_VIBES } from '@/lib/gradeParams'

// Draw a photo into a tiny offscreen canvas and read its pixels. Used by
// Auto-adjust and the "from photo" swatches. Vercel Blob serves CORS-enabled
// images (the publish bake reads the same canvas), so pixel reads don't taint.
export async function sampleImagePixels(url, size = 48) {
  const img = await new Promise((res, rej) => {
    const im = new Image(); im.crossOrigin = 'anonymous'
    im.onload = () => res(im); im.onerror = rej; im.src = url
  })
  const w = size
  const h = Math.max(1, Math.round(size * ((img.naturalHeight || img.height) / (img.naturalWidth || img.width) || 1)))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h).data
}
// One-tap enhance: push mean luminance toward a mid target + add contrast when
// the image is flat + a gentle vibrance. Falls back to a clean-bright preset if
// the pixels can't be read.
export async function autoGradeFromImage(url) {
  try {
    const data = await sampleImagePixels(url, 48)
    let sum = 0, sumSq = 0, n = 0
    for (let i = 0; i < data.length; i += 4) {
      const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
      sum += l; sumSq += l * l; n++
    }
    const mean = n ? sum / n : 0.5
    const std = Math.sqrt(Math.max(0, (n ? sumSq / n : 0) - mean * mean))
    const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)))
    return normalizeGrade({ exposure: cl((0.56 - mean) * 140, -40, 45), contrast: cl((0.19 - std) * 180, 0, 34), saturation: 12, depth: 6 })
  } catch { return normalizeGrade(GRADE_VIBES[0].params) }
}
// A handful of dominant colours from the photo, so text can match the image.
export async function paletteFromImage(url, count = 4) {
  try {
    const data = await sampleImagePixels(url, 40)
    const buckets = new Map()
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue
      const key = ((data[i] >> 5) << 10) | ((data[i + 1] >> 5) << 5) | (data[i + 2] >> 5)
      const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 }
      e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]
      buckets.set(key, e)
    }
    const hx = (v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')
    return [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, count).map((e) => `#${hx(e.r / e.n)}${hx(e.g / e.n)}${hx(e.b / e.n)}`)
  } catch { return [] }
}
