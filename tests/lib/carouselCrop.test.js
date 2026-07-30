import { describe, it, expect } from 'vitest'
import {
  proposeCarouselReframe, needsCarouselRebake, mayNeedCarouselRebake, clampReframeY,
  CAROUSEL_REFRAME_Y, CENTER_REFRAME_Y,
} from '../../src/lib/carouselCrop.js'
import { carouselPublishEntry, pickerItemToMediaEntry } from '../../src/lib/mediaEntry.js'
import { buildPublishMediaUrls } from '../../src/lib/renderSlides.js'
import { resolveArchetype } from '../../src/lib/editorArchetype.js'

describe('needsCarouselRebake — who actually needs the crop step', () => {
  it('a 9:16 vertical needs it (0.5625 is below Instagram\'s 0.8 floor)', () => {
    expect(needsCarouselRebake({ width: 1080, height: 1920 })).toBe(true)
  })

  it('a 16:9 master does NOT — 1.78 sits inside the 0.8–1.91 window', () => {
    // Offering a crop step here would invent work: landscape is natively
    // carousel-eligible and needs no re-bake at all.
    expect(needsCarouselRebake({ width: 1920, height: 1080 })).toBe(false)
  })

  it('square and 4:5 are already fine', () => {
    expect(needsCarouselRebake({ width: 1080, height: 1080 })).toBe(false)
    expect(needsCarouselRebake({ width: 1080, height: 1350 })).toBe(false)
  })

  it('unknown dimensions do not claim a rebake is needed', () => {
    expect(needsCarouselRebake({})).toBe(false)
    expect(needsCarouselRebake({ width: 0, height: 0 })).toBe(false)
    expect(needsCarouselRebake()).toBe(false)
  })
})

describe('proposeCarouselReframe — the nudge, not a replay', () => {
  it('pushes the crop DOWN for top captions (the measured collision case)', () => {
    const r = proposeCarouselReframe({ captionPos: 'top' })
    expect(r.y).toBe(CAROUSEL_REFRAME_Y)
    expect(r.y).toBeGreaterThan(CENTER_REFRAME_Y)
  })

  it('does NOT nudge for bottom captions — moving the crop cannot fix that', () => {
    // Measured: with captions at the bottom the collision is with the brand
    // band, which no crop position resolves. Pretending a nudge helps would be
    // worse than leaving it centred for the human to judge.
    expect(proposeCarouselReframe({ captionPos: 'bottom' }).y).toBe(CENTER_REFRAME_Y)
  })

  it('never simply replays the reel reframe — that IS the bug', () => {
    // A reel crop of y=0.5 replayed at 4:5 is what puts the caption on the
    // subject's face. The proposal must differ.
    const reel = { zoom: 1, x: 0.5, y: 0.5 }
    expect(proposeCarouselReframe({ sourceReframe: reel, captionPos: 'top' }).y).not.toBe(reel.y)
  })

  it('carries horizontal intent and zoom through', () => {
    // The crop only loses HEIGHT, so a left/right choice the producer already
    // made stays valid.
    const r = proposeCarouselReframe({ sourceReframe: { zoom: 1.4, x: 0.3, y: 0.5 }, captionPos: 'top' })
    expect(r.x).toBe(0.3)
    expect(r.zoom).toBe(1.4)
  })

  it('defaults sanely with no source reframe', () => {
    expect(proposeCarouselReframe()).toEqual({ zoom: 1, x: 0.5, y: CAROUSEL_REFRAME_Y })
  })
})

describe('clampReframeY', () => {
  it('keeps a dragged value in range', () => {
    expect(clampReframeY(1.7)).toBe(1)
    expect(clampReframeY(-3)).toBe(0)
    expect(clampReframeY('0.42')).toBeCloseTo(0.42)
  })

  it('falls back to centre on garbage rather than NaN', () => {
    expect(clampReframeY(undefined)).toBe(CENTER_REFRAME_Y)
    expect(clampReframeY('abc')).toBe(CENTER_REFRAME_Y)
  })
})

describe('carouselPublishEntry — the 4:5 variant is what ships', () => {
  const MASTER = { url: 'https://x/master-916.mp4', type: 'video', kind: 'video', mediaAssetId: 'm1' }
  const FITTED = {
    ...MASTER,
    carouselVariant: { url: 'https://x/variant-45.mp4', thumbnailUrl: 'https://x/v.jpg' },
  }

  it('substitutes the variant url — the master would be REJECTED by Instagram', () => {
    const out = carouselPublishEntry(FITTED)
    expect(out.url).toBe('https://x/variant-45.mp4')
    expect(out.thumbnailUrl).toBe('https://x/v.jpg')
  })

  it('keeps the MASTER asset id so dedup and usage still resolve to one clip', () => {
    expect(carouselPublishEntry(FITTED).mediaAssetId).toBe('m1')
  })

  it('preserves the master url as sourceUrl', () => {
    expect(carouselPublishEntry(FITTED).sourceUrl).toBe('https://x/master-916.mp4')
  })

  it('passes an unfitted entry through untouched (16:9 needs no variant)', () => {
    expect(carouselPublishEntry(MASTER)).toBe(MASTER)
  })

  it('a variant with no url is ignored rather than blanking the entry', () => {
    const broken = { ...MASTER, carouselVariant: { thumbnailUrl: 'x' } }
    expect(carouselPublishEntry(broken)).toBe(broken)
  })
})

describe('publish list uses the fitted variant end-to-end', () => {
  it('a fitted video slide publishes the 4:5 url, not the 9:16 master', () => {
    const master = {
      url: 'https://x/master-916.mp4', type: 'video', kind: 'video', mediaAssetId: 'm1',
      carouselVariant: { url: 'https://x/variant-45.mp4' },
    }
    const photo = { url: 'https://x/p.jpg', type: 'image', kind: 'image' }
    const out = buildPublishMediaUrls(
      [{ media_idx: 0, rendered_url: 'https://x/s0.jpg' }, { media_idx: 1 }],
      [photo, master],
    )
    expect(out[0]).toEqual({ url: 'https://x/s0.jpg', type: 'photo' })
    expect(out[1].url).toBe('https://x/variant-45.mp4')
  })
})

describe('mayNeedCarouselRebake — fails OPEN so the control is never wrongly hidden', () => {
  // The bug this exists for: CarouselFitPanel first gated on the strict
  // predicate, but media entries only carry width/height when they came through
  // the Library picker — clipSearch (the suggestion path) doesn't select those
  // columns. So dimensions are usually UNKNOWN, the strict check returned false,
  // and the whole crop step rendered nothing. Shipped, green, invisible.
  it('offers the step when dimensions are unknown', () => {
    expect(mayNeedCarouselRebake({})).toBe(true)
    expect(mayNeedCarouselRebake(null)).toBe(true)
    expect(mayNeedCarouselRebake({ width: 1080 })).toBe(true)
  })

  it('still skips a natively-eligible 16:9 master when dimensions ARE known', () => {
    expect(mayNeedCarouselRebake({ width: 1920, height: 1080 })).toBe(false)
  })

  it('offers the step for a known 9:16 vertical', () => {
    expect(mayNeedCarouselRebake({ width: 1080, height: 1920 })).toBe(true)
  })

  it('is deliberately MORE permissive than the strict predicate', () => {
    // A redundant render is recoverable; a hidden control that would have
    // prevented a rejected publish is not.
    expect(needsCarouselRebake({})).toBe(false)
    expect(mayNeedCarouselRebake({})).toBe(true)
  })
})

describe('pickerItemToMediaEntry carries dimensions when the source knows them', () => {
  it('includes width/height from a media_assets row', () => {
    const e = pickerItemToMediaEntry({ id: 'a', kind: 'video', blob_url: 'https://x/v.mp4', width: 1080, height: 1920 })
    expect(e.width).toBe(1080)
    expect(e.height).toBe(1920)
    expect(mayNeedCarouselRebake(e)).toBe(true)
  })

  it('omits them rather than emitting nulls when absent', () => {
    const e = pickerItemToMediaEntry({ id: 'a', kind: 'photo', blob_url: 'https://x/p.jpg' })
    expect('width' in e).toBe(false)
  })
})

describe('resolveArchetype — explicit format outranks the media refinement', () => {
  // The bug this exists for: adding a video to a carousel flipped the archetype
  // to 'vvideo', which routes the piece to the Reel editor — making SlideEditor
  // and the whole mixed-carousel UI (including the fit step) unreachable. Found
  // by opening a real piece in prod and seeing the tab title read "Reel Editor",
  // not by any gate.
  const VID = { url: 'https://x/v.mp4', type: 'video', kind: 'video' }
  const PIC = { url: 'https://x/p.jpg', type: 'image', kind: 'image' }

  it('a carousel holding a video stays a CAROUSEL, not a reel', () => {
    expect(resolveArchetype({ platform: 'instagram', format: 'carousel', media_urls: [PIC, VID] }))
      .toBe('carousel')
  })

  it('an all-video carousel is still a carousel', () => {
    expect(resolveArchetype({ platform: 'instagram', format: 'carousel', media_urls: [VID, VID] }))
      .toBe('carousel')
  })

  it('an explicit reel routes to the video editor', () => {
    expect(resolveArchetype({ platform: 'instagram', format: 'reel', media_urls: [VID] }))
      .toBe('vvideo')
  })

  it('LEGACY rows are untouched — no format still derives from media', () => {
    // Byte-for-byte the old behaviour, which every existing row depends on.
    expect(resolveArchetype({ platform: 'instagram', media_urls: [VID] })).toBe('vvideo')
    expect(resolveArchetype({ platform: 'instagram', media_urls: [PIC] })).toBe('carousel')
    expect(resolveArchetype({ platform: 'facebook', media_urls: [VID] })).toBe('lvideo')
    expect(resolveArchetype({ platform: 'instagram_story', media_urls: [VID] })).toBe('storyvid')
  })
})
