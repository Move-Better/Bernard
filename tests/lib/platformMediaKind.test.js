// Regression cover for the media-kind resolver behind suggest-media.
//
// This logic has now silently broken twice in the same way, so the tests are
// written against the two failure modes rather than the happy path:
//
//   1. A Reel is stored as platform:'instagram' with a video attached — never
//      as platform:'instagram_reel'. Keying off platform alone classified a
//      Reel as "either kind" and ranked photos alongside videos, which is what
//      a producer reported as "format is reels but it's suggesting photos".
//   2. The API and the app each kept their own copy of the platform→kind map
//      and had already drifted. They now share one module; the last test pins
//      that, so re-introducing a server-local copy fails here.
import { describe, it, expect } from 'vitest'
import { mediaKindForDraft, mediaKindForPlatform } from '../../src/lib/platformMediaKind.js'
import * as serverEntry from '../../api/_lib/platformMedia.js'

const VIDEO = { url: 'https://blob/v.mp4', type: 'video' }
const PHOTO = { url: 'https://blob/p.jpg', type: 'photo' }

describe('mediaKindForDraft — the Reel case', () => {
  it('returns video for an Instagram piece with a video attached (a Reel)', () => {
    // The exact shape of the reported draft a41dc25a on prod.
    expect(mediaKindForDraft({ platform: 'instagram', media_urls: [VIDEO] })).toBe('video')
  })

  it('still returns null for an Instagram piece that is a photo carousel', () => {
    expect(mediaKindForDraft({ platform: 'instagram', media_urls: [PHOTO, PHOTO] })).toBeNull()
  })

  it('leaves a media-less Instagram draft open to both kinds', () => {
    // Over-showing is recoverable; wrongly hiding a valid option is not.
    expect(mediaKindForDraft({ platform: 'instagram', media_urls: [] })).toBeNull()
  })

  it('applies the same refinement to every dual-kind platform', () => {
    // Mirrors resolveArchetype: instagram_story→storyvid, the rest→lvideo.
    for (const platform of ['instagram_story', 'facebook', 'linkedin', 'gbp']) {
      expect(mediaKindForDraft({ platform, media_urls: [VIDEO] })).toBe('video')
      expect(mediaKindForDraft({ platform, media_urls: [] })).toBeNull()
    }
  })

  it('detects a video by entry.kind as well as entry.type', () => {
    // clipToMediaEntry writes `kind`; older rows carry `type`.
    expect(mediaKindForDraft({ platform: 'instagram', media_urls: [{ url: 'u', kind: 'video' }] })).toBe('video')
  })
})

describe('mediaKindForDraft — hard platform constraints still win', () => {
  it('keeps photo-only platforms on photo even if a video is attached', () => {
    for (const platform of ['blog', 'landing_page', 'google_ads', 'email']) {
      expect(mediaKindForDraft({ platform, media_urls: [VIDEO] })).toBe('photo')
    }
  })

  it('keeps video-only platforms on video with no media attached', () => {
    for (const platform of ['youtube', 'youtube_short', 'tiktok', 'instagram_reel']) {
      expect(mediaKindForDraft({ platform, media_urls: [] })).toBe('video')
    }
  })

  it('is null-safe for a missing piece or a non-array media_urls', () => {
    expect(mediaKindForDraft(null)).toBeNull()
    expect(mediaKindForDraft(undefined)).toBeNull()
    expect(mediaKindForDraft({ platform: 'instagram', media_urls: null })).toBeNull()
    expect(mediaKindForDraft({})).toBeNull()
  })
})

describe('one shared implementation', () => {
  it('the API entry point re-exports the app module rather than copying it', () => {
    // Identity, not equality: a second server-local implementation would pass a
    // behavioural check while the two drift again on the next edit.
    expect(serverEntry.mediaKindForDraft).toBe(mediaKindForDraft)
    expect(serverEntry.mediaKindForPlatform).toBe(mediaKindForPlatform)
  })

  it('platform alone cannot identify a Reel — the reason mediaKindForDraft exists', () => {
    expect(mediaKindForPlatform('instagram')).toBeNull()
  })
})
