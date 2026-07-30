// Regression cover for autoAttachKindForDraft — the auto-attach-only media-kind
// default that fixes the reported bug where a media-less LinkedIn draft got a
// 25s video auto-attached and silently opened in the reel/timeline editor.
//
// The fix is a PHOTO DEFAULT for auto-attach on the single-photo-default social
// platforms, NOT a capability block — LinkedIn/Facebook/GBP/X all support video,
// which stays reachable via the manual picker. So the two invariants under test:
//
//   1. auto-attach defaults to 'photo' on exactly the `visual`-archetype
//      platforms (the ones resolveArchetype flips to lvideo when a video lands),
//      and to whatever mediaKindForDraft says everywhere else. Enforced against
//      the archetype map itself so the two can't drift.
//   2. the MANUAL path (mediaKindForDraft) is UNCHANGED — it must keep offering
//      both kinds on those platforms, or the user loses the ability to choose a
//      video on purpose.
import { describe, it, expect } from 'vitest'
import {
  autoAttachKindForDraft,
  mediaKindForDraft,
} from '../../src/lib/platformMediaKind.js'
import { PLATFORM_ARCHETYPE, resolveArchetype } from '../../src/lib/editorArchetype.js'
import * as serverEntry from '../../api/_lib/platformMedia.js'

const mediaLess = (platform) => ({ platform, media_urls: [] })
const VIDEO = { url: 'https://blob/v.mp4', type: 'video' }

describe('autoAttachKindForDraft — the reported LinkedIn bug', () => {
  it('defaults a media-less LinkedIn draft to a photo (not either)', () => {
    // The exact shape of piece 69d0cede before auto-attach ran: media-less
    // LinkedIn. Old behavior (mediaKindForDraft) returned null → searchClips
    // ranked photos AND videos on similarity → the video won → editor flipped.
    expect(mediaKindForDraft(mediaLess('linkedin'))).toBeNull()   // the OLD default that caused it
    expect(autoAttachKindForDraft(mediaLess('linkedin'))).toBe('photo') // the NEW default
  })

  it('defaults to a photo on every live text-first platform', () => {
    for (const platform of ['linkedin', 'facebook', 'gbp']) {
      expect(autoAttachKindForDraft(mediaLess(platform))).toBe('photo')
    }
  })
})

describe('autoAttachKindForDraft — leaves the other lanes alone', () => {
  it('keeps Instagram dual — a Reel is an expected IG format', () => {
    expect(autoAttachKindForDraft(mediaLess('instagram'))).toBeNull()
  })

  it('still returns the hard video-only constraint', () => {
    for (const platform of ['tiktok', 'youtube', 'youtube_short', 'instagram_reel']) {
      expect(autoAttachKindForDraft(mediaLess(platform))).toBe('video')
    }
  })

  it('still returns the hard photo-only constraint', () => {
    for (const platform of ['blog', 'landing_page', 'email', 'google_ads']) {
      expect(autoAttachKindForDraft(mediaLess(platform))).toBe('photo')
    }
  })

  it('defers to mediaKindForDraft once a video is already on the draft', () => {
    // A visual platform that ALREADY carries a video is already a video post, so
    // the video constraint (from mediaKindForDraft) wins over the photo default.
    // (In practice auto-attach early-returns on already_has_media before reaching
    // this, but the resolver must still be correct in isolation.)
    for (const platform of ['linkedin', 'facebook', 'gbp']) {
      expect(autoAttachKindForDraft({ platform, media_urls: [VIDEO] })).toBe('video')
    }
  })

  it('is null-safe', () => {
    expect(autoAttachKindForDraft(null)).toBeNull()
    expect(autoAttachKindForDraft(undefined)).toBeNull()
    expect(autoAttachKindForDraft({})).toBeNull()
    expect(autoAttachKindForDraft({ platform: 'linkedin', media_urls: null })).toBe('photo')
  })
})

describe('the photo-default set cannot drift from the archetype map', () => {
  // Self-maintaining: iterate EVERY known platform. Any platform whose media-less
  // archetype is `visual` (i.e. it flips to lvideo when a video is attached) MUST
  // auto-default to a photo; any other platform must auto-default to exactly what
  // the manual path offers. Adding a new `visual` platform to PLATFORM_ARCHETYPE
  // without adding it to PHOTO_DEFAULT_AUTOATTACH reintroduces the bug and fails
  // here; adding a non-visual platform to the set also fails here.
  it('photo-default ⇔ media-less archetype is `visual`, across all platforms', () => {
    let visualCount = 0
    for (const platform of Object.keys(PLATFORM_ARCHETYPE)) {
      const draft = mediaLess(platform)
      if (resolveArchetype(draft) === 'visual') {
        visualCount++
        expect(autoAttachKindForDraft(draft), `${platform} is a visual platform → must photo-default`).toBe('photo')
      } else {
        expect(
          autoAttachKindForDraft(draft),
          `${platform} is not visual → auto default must equal manual default`,
        ).toBe(mediaKindForDraft(draft))
      }
    }
    // Non-vacuity: the loop actually exercised the visual branch (guards against a
    // future refactor that renames the archetype and silently zeroes the set).
    expect(visualCount).toBeGreaterThanOrEqual(3) // linkedin, facebook, gbp at minimum
  })
})

describe('one shared implementation', () => {
  it('the API entry point re-exports the app module rather than copying it', () => {
    expect(serverEntry.autoAttachKindForDraft).toBe(autoAttachKindForDraft)
  })
})
