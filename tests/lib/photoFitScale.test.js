import { describe, it, expect } from 'vitest'
import { photoFitScale } from '../../src/lib/overlayTemplates.js'

// The bug: an unframed slide scaled to FIT (Math.min), so it could never cover
// the frame, so drawPhotoFit always fell into its blurred-backdrop branch. Every
// carousel photo the author hadn't hand-zoomed rendered letterboxed behind a
// blur of itself. The fix makes an UNSET zoom mean fill; an explicit numeric
// zoom keeps its original fit-relative meaning so already-framed slides are
// untouched.
//
// A 4:3 landscape photo (1600×1200) in a 4:5 portrait frame (1080×1350) is the
// worst case and the common one — a phone photo in an Instagram deck.
const LANDSCAPE = [1600, 1200]
const FRAME_4_5 = [1080, 1350]

const fills = (scale, [imgW, imgH], [w, h]) =>
  imgW * scale >= w - 0.5 && imgH * scale >= h - 0.5

describe('photoFitScale — an unframed photo fills the frame', () => {
  it('covers the frame when no zoom is set', () => {
    const scale = photoFitScale(...LANDSCAPE, ...FRAME_4_5, null)
    expect(fills(scale, LANDSCAPE, FRAME_4_5)).toBe(true)
  })

  it('treats undefined the same as null — both mean "never framed"', () => {
    const asNull = photoFitScale(...LANDSCAPE, ...FRAME_4_5, null)
    expect(photoFitScale(...LANDSCAPE, ...FRAME_4_5, undefined)).toBe(asNull)
    expect(photoFitScale(...LANDSCAPE, ...FRAME_4_5)).toBe(asNull)
  })

  it('is exactly cover — no gratuitous overscan cropping the photo tighter', () => {
    const scale = photoFitScale(...LANDSCAPE, ...FRAME_4_5, null)
    expect(scale).toBeCloseTo(Math.max(1080 / 1600, 1350 / 1200), 10)
  })

  it('fills for a portrait source in a landscape frame too', () => {
    const portrait = [1200, 1600]
    const frame16x9 = [1920, 1080]
    const scale = photoFitScale(...portrait, ...frame16x9, null)
    expect(fills(scale, portrait, frame16x9)).toBe(true)
  })

  it('is a no-op when the photo already matches the frame ratio', () => {
    const scale = photoFitScale(1080, 1350, 1080, 1350, null)
    expect(scale).toBeCloseTo(1, 10)
  })
})

describe('photoFitScale — hand-framed slides keep their exact framing', () => {
  // 21 slides across 18 content items carried a stored photo_zoom when this
  // shipped, 14 of them already published. Re-basing the stored value would
  // have silently re-framed all of them.
  it('keeps an explicit zoom fit-relative, exactly as before', () => {
    const fit = Math.min(1080 / 1600, 1350 / 1200)
    expect(photoFitScale(...LANDSCAPE, ...FRAME_4_5, 1)).toBeCloseTo(fit, 10)
    expect(photoFitScale(...LANDSCAPE, ...FRAME_4_5, 2)).toBeCloseTo(fit * 2, 10)
  })

  it('an explicit zoom of 1 still means "whole photo", still letterboxes', () => {
    const scale = photoFitScale(...LANDSCAPE, ...FRAME_4_5, 1)
    expect(fills(scale, LANDSCAPE, FRAME_4_5)).toBe(false)
  })

  it('lets the author pull back below fill to reveal the blur on purpose', () => {
    // This is the requested behaviour: fill is the default, not the floor.
    const scale = photoFitScale(...LANDSCAPE, ...FRAME_4_5, 1.05)
    const cover = photoFitScale(...LANDSCAPE, ...FRAME_4_5, null)
    expect(scale).toBeLessThan(cover)
    expect(fills(scale, LANDSCAPE, FRAME_4_5)).toBe(false)
  })

  it('ignores a nonsensical zoom rather than rendering a zero-size photo', () => {
    const cover = photoFitScale(...LANDSCAPE, ...FRAME_4_5, null)
    expect(photoFitScale(...LANDSCAPE, ...FRAME_4_5, 0)).toBe(cover)
    expect(photoFitScale(...LANDSCAPE, ...FRAME_4_5, -3)).toBe(cover)
    expect(photoFitScale(...LANDSCAPE, ...FRAME_4_5, NaN)).toBe(cover)
  })
})
