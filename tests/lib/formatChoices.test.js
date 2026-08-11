import { describe, it, expect } from 'vitest'
import { formatChoicesFor } from '../../src/lib/platformFormats.js'
import { postFormat } from '../../src/lib/mediaEntry.js'

const PHOTO = { url: 'https://x/p.jpg', type: 'image', kind: 'image' }
const VIDEO = { url: 'https://x/v.mp4', type: 'video', kind: 'video' }

const byId = (choices) => Object.fromEntries(choices.map((c) => [c.id, c]))

describe('formatChoicesFor — what the picker renders', () => {
  it('offers every Instagram format, enabling the ones the media satisfies', () => {
    const choices = byId(formatChoicesFor({ platform: 'instagram', media_urls: [PHOTO, VIDEO] }))
    expect(Object.keys(choices)).toEqual(['post', 'carousel', 'reel'])
    // 2 items, mixed → a carousel is exactly what this is
    expect(choices.carousel.disabled).toBe(false)
    // reel takes one video and no photos
    expect(choices.reel.disabled).toBe(true)
    expect(choices.post.disabled).toBe(true)
  })

  it('DISABLES rather than hides, and says why', () => {
    // Hiding "Reel" from a photo-only piece would leave a producer with no way
    // to learn the channel offers it. The tooltip is the teaching surface.
    const choices = byId(formatChoicesFor({ platform: 'instagram', media_urls: [PHOTO, PHOTO] }))
    expect(choices.reel).toBeTruthy()
    expect(choices.reel.disabled).toBe(true)
    expect(choices.reel.title).toMatch(/video/i)
  })

  it('a lone video enables Reel and disables the photo-only Post', () => {
    const choices = byId(formatChoicesFor({ platform: 'instagram', media_urls: [VIDEO] }))
    expect(choices.reel.disabled).toBe(false)
    expect(choices.post.disabled).toBe(true)
    expect(choices.post.title).toMatch(/reel/i)
  })

  it('an all-video carousel is offered — video no longer forces a Reel', () => {
    const choices = byId(formatChoicesFor({ platform: 'instagram', media_urls: [VIDEO, VIDEO] }))
    expect(choices.carousel.disabled).toBe(false)
  })

  it('Facebook explains that it cannot mix, in the producer\'s words', () => {
    const choices = byId(formatChoicesFor({ platform: 'facebook', media_urls: [PHOTO, VIDEO] }))
    expect(choices.post.disabled).toBe(true)
    expect(choices.post.title).toMatch(/mix/i)
  })

  it('single-format channels return fewer than 2 choices, so no picker renders', () => {
    // EditorChrome only renders the control when options.length > 1.
    expect(formatChoicesFor({ platform: 'linkedin', media_urls: [PHOTO] }).length).toBeLessThan(2)
    expect(formatChoicesFor({ platform: 'gbp', media_urls: [PHOTO] }).length).toBeLessThan(2)
  })

  it('labels are human, never machine keys', () => {
    for (const c of formatChoicesFor({ platform: 'instagram', media_urls: [PHOTO] })) {
      expect(c.label[0]).toBe(c.label[0].toUpperCase())
      expect(c.label).not.toContain('_')
    }
  })
})

describe('formatChoicesFor — validates what SHIPS, not the raw pool', () => {
  // A slide-deck carousel posts one baked card PER SLIDE (buildPublishMediaUrls),
  // so the count the platform sees is slides.length — NOT the larger media_urls
  // pool the operator draws photos from. Counting the pool disabled the Carousel
  // option on a 4-slide deck drawing from a 12-photo pool ("12 items, over the 10
  // max") with no way forward — the picker's twin of the publish-gate bug
  // (feedback a473c03a). See publishMediaForFormat.
  it('a 4-slide carousel from a 12-photo pool leaves Carousel ENABLED', () => {
    const piece = {
      platform: 'instagram',
      media_urls: Array(12).fill(PHOTO),
      slides: Array(4).fill({ photo_idx: 0, template: 'custom', blocks: [] }),
    }
    const choices = byId(formatChoicesFor(piece))
    // 4 shipped cards is a valid carousel (2..10), not an over-cap 12.
    expect(choices.carousel.disabled).toBe(false)
    expect(choices.carousel.title).toBeNull()
  })

  it('an 11-SLIDE deck still trips the max — the count that matters is slides', () => {
    const piece = {
      platform: 'instagram',
      media_urls: Array(12).fill(PHOTO),
      slides: Array(11).fill({ photo_idx: 0, template: 'custom', blocks: [] }),
    }
    const choices = byId(formatChoicesFor(piece))
    expect(choices.carousel.disabled).toBe(true)
    expect(choices.carousel.title).toMatch(/at most 10/i)
  })

  it('a video in the pool skips the deck path — the raw pool (with its video) gates', () => {
    // publishMediaForFormat returns raw media whenever any video is present, so a
    // slide deck sitting beside a video is validated on the real mixed pool. A
    // photo+video pool is a legitimate mixed carousel.
    const piece = {
      platform: 'instagram',
      media_urls: [PHOTO, VIDEO],
      slides: Array(4).fill({ photo_idx: 0, template: 'custom', blocks: [] }),
    }
    const choices = byId(formatChoicesFor(piece))
    expect(choices.carousel.disabled).toBe(false)
    // reel wants one video and no photos — the mixed pool disables it.
    expect(choices.reel.disabled).toBe(true)
  })

  it('no slides → validates the raw pool exactly as before', () => {
    // Regression guard: the effective-media swap must not change the pool path.
    const choices = byId(formatChoicesFor({ platform: 'instagram', media_urls: Array(11).fill(PHOTO) }))
    expect(choices.carousel.disabled).toBe(true)
    expect(choices.carousel.title).toMatch(/at most 10/i)
  })
})

describe('the picker and the badge agree', () => {
  // postFormat drives the header badge; formatChoicesFor drives the control next
  // to it. If they disagreed, the chrome would contradict the control — the
  // exact defect the UnifiedEditor isReel fix addresses.
  it('choosing carousel makes the badge read Carousel, even with a video attached', () => {
    const piece = { platform: 'instagram', media_urls: [PHOTO, VIDEO], format: 'carousel' }
    expect(postFormat(piece).kind).toBe('carousel')
  })

  it('choosing reel makes the badge read Reel', () => {
    const piece = { platform: 'instagram', media_urls: [VIDEO], format: 'reel' }
    expect(postFormat(piece).kind).toBe('reel')
  })

  it('with no explicit format the badge keeps the legacy derivation', () => {
    const piece = { platform: 'instagram', media_urls: [PHOTO, VIDEO] }
    expect(postFormat(piece).kind).toBe('reel')
  })
})
