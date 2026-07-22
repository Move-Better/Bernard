import { describe, it, expect } from 'vitest'
import { buildDataBlock, isReelPayload } from '../../api/_lib/social/bundlePublisher.js'

// bundle upload records as the API returns them — `type` is bundle's OWN
// classification, made after it downloads the URL.
const VIDEO = { id: 'up_vid', type: 'video' }
const PHOTO = { id: 'up_img', type: 'image' }
const PHOTO2 = { id: 'up_img2', type: 'image' }

describe('isReelPayload — all-video is a Reel, anything else is not', () => {
  it('is true for a single video', () => {
    expect(isReelPayload([VIDEO])).toBe(true)
  })

  it('is false for a mixed photo+video payload (neither network accepts it)', () => {
    expect(isReelPayload([VIDEO, PHOTO])).toBe(false)
  })

  it('is false for photos only, and for no media at all', () => {
    expect(isReelPayload([PHOTO, PHOTO2])).toBe(false)
    expect(isReelPayload([])).toBe(false)
    expect(isReelPayload(undefined)).toBe(false)
  })

  it('ignores a document upload rather than counting it as an image', () => {
    expect(isReelPayload([VIDEO, { id: 'up_doc', type: 'document' }])).toBe(true)
  })
})

describe('buildDataBlock — Instagram', () => {
  it('sends a video post as a REEL that also lands in the feed', () => {
    const block = buildDataBlock({
      platform: 'instagram', type: 'INSTAGRAM', text: 'hi', uploads: [VIDEO],
    })
    expect(block.type).toBe('REEL')
    expect(block.shareToFeed).toBe(true)
    expect(block.uploadIds).toEqual(['up_vid'])
  })

  it('attaches an uploaded cover frame to a Reel', () => {
    const block = buildDataBlock({
      platform: 'instagram', type: 'INSTAGRAM', text: 'hi', uploads: [VIDEO],
      coverUrl: 'https://cdn.bundle.social/cover.jpg',
    })
    expect(block.thumbnail).toBe('https://cdn.bundle.social/cover.jpg')
  })

  it('omits thumbnail entirely when no cover resolved (IG picks a frame)', () => {
    const block = buildDataBlock({
      platform: 'instagram', type: 'INSTAGRAM', text: 'hi', uploads: [VIDEO], coverUrl: null,
    })
    expect('thumbnail' in block).toBe(false)
  })

  it('keeps a photo carousel as a POST with no reel-only fields', () => {
    const block = buildDataBlock({
      platform: 'instagram', type: 'INSTAGRAM', text: 'hi', uploads: [PHOTO, PHOTO2],
    })
    expect(block.type).toBe('POST')
    expect('shareToFeed' in block).toBe(false)
    expect('thumbnail' in block).toBe(false)
    expect(block.uploadIds).toEqual(['up_img', 'up_img2'])
  })

  it('keeps a mixed payload as a POST — a Reel with a still in it is rejected', () => {
    const block = buildDataBlock({
      platform: 'instagram', type: 'INSTAGRAM', text: 'hi', uploads: [VIDEO, PHOTO],
    })
    expect(block.type).toBe('POST')
  })

  it('still routes instagram_story to STORY even when the media is a video', () => {
    const block = buildDataBlock({
      platform: 'instagram_story', type: 'INSTAGRAM', text: 'hi', uploads: [VIDEO],
    })
    expect(block.type).toBe('STORY')
    expect('shareToFeed' in block).toBe(false)
  })
})

describe('buildDataBlock — Facebook', () => {
  it('sends an all-video post as a REEL', () => {
    const block = buildDataBlock({
      platform: 'facebook', type: 'FACEBOOK', text: 'hi', uploads: [VIDEO],
      coverUrl: 'https://cdn.bundle.social/cover.jpg',
    })
    expect(block.type).toBe('REEL')
    expect(block.thumbnail).toBe('https://cdn.bundle.social/cover.jpg')
    // shareToFeed is an Instagram-only field — sending it to FB would 400.
    expect('shareToFeed' in block).toBe(false)
  })

  it('keeps a photo post as a POST', () => {
    const block = buildDataBlock({ platform: 'facebook', type: 'FACEBOOK', text: 'hi', uploads: [PHOTO] })
    expect(block.type).toBe('POST')
  })

  it('omits uploadIds for a text-only post rather than sending an empty array', () => {
    const block = buildDataBlock({ platform: 'facebook', type: 'FACEBOOK', text: 'hi', uploads: [] })
    expect(block).toEqual({ type: 'POST', text: 'hi' })
  })
})

describe('buildDataBlock — unchanged platforms', () => {
  it('Google Business keeps its STANDARD topic type', () => {
    const block = buildDataBlock({ platform: 'gbp', type: 'GOOGLE_BUSINESS', text: 'hi', uploads: [PHOTO] })
    expect(block).toEqual({ text: 'hi', topicType: 'STANDARD', uploadIds: ['up_img'] })
  })

  it('YouTube still splits SHORT vs VIDEO by platform id, not by media', () => {
    expect(buildDataBlock({ platform: 'youtube_short', type: 'YOUTUBE', text: 'hi', uploads: [VIDEO] }).type).toBe('SHORT')
    expect(buildDataBlock({ platform: 'youtube', type: 'YOUTUBE', text: 'hi', uploads: [VIDEO] }).type).toBe('VIDEO')
  })

  it('LinkedIn and other generic networks get no `type` field at all', () => {
    const block = buildDataBlock({ platform: 'linkedin', type: 'LINKEDIN', text: 'hi', uploads: [VIDEO] })
    expect(block).toEqual({ text: 'hi', uploadIds: ['up_vid'] })
  })
})
