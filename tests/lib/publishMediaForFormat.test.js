import { describe, it, expect } from 'vitest'
import { publishMediaForFormat } from '../../src/lib/mediaEntry.js'
import { describeFormatViolation } from '../../src/lib/platformFormats.js'

// Regression for feedback a473c03a (2026-08-10): "Post approved by me, but not
// allowing schedule button to be pressed." An Instagram carousel with a 4-slide
// deck and a 12-photo CANDIDATE POOL had its Schedule button disabled because the
// publish format gate counted the pool (12 > carousel max 10) instead of the
// cards that actually ship — one per slide (4). publishMediaForFormat mirrors what
// publishPieceToSocial ships, so the gate validates the real published item count.

const PHOTO = (i) => ({ url: `https://x/${i}.jpg`, type: 'image', kind: 'image' })
const VIDEO = (i) => ({ url: `https://x/${i}.mp4`, type: 'video', kind: 'video' })

// The reported piece's shape: 4 text-card slides, a 12-photo pool, none bound.
const reportedPiece = () => ({
  platform: 'instagram',
  format: 'carousel',
  media_urls: Array.from({ length: 12 }, (_, i) => PHOTO(i)),
  slides: [
    { template: 'cover', blocks: [{ text: 'A' }] },
    { template: 'explainer', blocks: [{ text: 'B' }] },
    { template: 'explainer', blocks: [{ text: 'C' }] },
    { template: 'cta', blocks: [{ text: 'D' }] },
  ],
})

describe('publishMediaForFormat — validate what ships, not the pool', () => {
  it('a slide deck ships ONE entry per slide, ignoring extra pooled photos', () => {
    const eff = publishMediaForFormat(reportedPiece())
    expect(eff).toHaveLength(4) // not 12 — the pool is not the carousel
    expect(eff.every((e) => e.url && e.type === 'image')).toBe(true)
  })

  it('a video anywhere in the pool takes the raw list (mirrors the reel guard, so kinds are exact)', () => {
    // publishPieceToSocial skips baking when isInstagramReel(media_urls) is true —
    // ANY video in the pool. So the deck path never runs for a piece with a video,
    // and publishMediaForFormat returns the raw list, preserving its real kinds for
    // the mixed-carousel / reel rules downstream.
    const media = [VIDEO(0), PHOTO(1), PHOTO(2)]
    const piece = { platform: 'instagram', format: 'carousel', media_urls: media, slides: [{ blocks: [] }, { blocks: [] }] }
    expect(publishMediaForFormat(piece)).toBe(media)
  })

  it('a Reel with a video keeps the RAW media list (it ships the video, not slides)', () => {
    const media = [VIDEO(0)]
    const piece = { platform: 'instagram', format: 'reel', media_urls: media, slides: [{ blocks: [] }] }
    // isInstagramReel(media) is true → raw list is returned unchanged.
    expect(publishMediaForFormat(piece)).toBe(media)
  })

  it('a deck-less piece falls back to the raw media list (each pool photo IS a card)', () => {
    const media = [PHOTO(0), PHOTO(1)]
    expect(publishMediaForFormat({ platform: 'instagram', format: 'carousel', media_urls: media })).toBe(media)
    expect(publishMediaForFormat({ platform: 'instagram', format: 'carousel', media_urls: media, slides: [] })).toBe(media)
  })
})

describe('the publish format gate, through publishMediaForFormat', () => {
  const violate = (piece) => describeFormatViolation(piece.platform, piece.format, publishMediaForFormat(piece))

  it('UNBLOCKS the reported 4-slide / 12-photo-pool carousel (the actual bug)', () => {
    expect(violate(reportedPiece())).toBeNull()
  })

  it('still BLOCKS a genuine 11-slide deck (over the real carousel cap of 10)', () => {
    const piece = {
      platform: 'instagram',
      format: 'carousel',
      media_urls: Array.from({ length: 11 }, (_, i) => PHOTO(i)),
      slides: Array.from({ length: 11 }, (_, i) => ({ media_idx: i, blocks: [] })),
    }
    const v = violate(piece)
    expect(v?.reason).toBe('too_many_items')
    expect(v.message).toContain('11')
  })

  it('still BLOCKS a genuine over-cap POOL when there is NO slide deck to reduce it', () => {
    // 12 pooled photos, no slides → each pool photo is a card → really 12 cards.
    const v = violate({ platform: 'instagram', format: 'carousel', media_urls: Array.from({ length: 12 }, (_, i) => PHOTO(i)) })
    expect(v?.reason).toBe('too_many_items')
  })
})
