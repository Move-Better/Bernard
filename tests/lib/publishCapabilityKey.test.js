import { describe, it, expect } from 'vitest'
import {
  publishCapabilityKey,
  canDirectPublish,
  OUTPUT_CHANNELS,
} from '../../src/lib/outputChannels.js'

// GUARD — the capability key a channel asks for must be a key that actually
// exists on workspace rows.
//
// publishCapabilityKey derived its key from the publish MODE id. That works for
// website (mode 'website' → websitePublish ✓) and tdc, but the social mode's id
// is the persisted string 'buffer', so it asked for `bufferPublish` — a key no
// workspace has ever had. Prod holds exactly two capability keys:
// websitePublish (4 workspaces) and socialPublish (1, the live workspace).
//
// The effect was silent and total: canDirectPublish() returned false for every
// social channel on every workspace, forever. Nothing errored. It was invisible
// because a second path — a connected `buffer` credential via
// channelHasPublishCredential — happened to return true for the same
// workspaces, so the Publish affordance appeared anyway. Deleting those
// now-defunct credential rows is what would have exposed it, by removing
// Publish from the live workspace.
//
// The capability keys actually present on workspace rows in prod.
//
// The invariant is directional, and getting it backwards matters. A key that is
// ASKED FOR but never granted is inert and fine — tdcPublish is exactly that,
// since the TDC newsletter is still a paste-into-template flow and no workspace
// has been given direct publish. The bug is the opposite: a key that IS granted
// and that no channel ever asks for. That flag looks live in the data, reads as
// live to anyone inspecting a workspace row, and does nothing.
const KEYS_GRANTED_IN_PROD = ['websitePublish', 'socialPublish']

describe('publishCapabilityKey — asks for keys that exist', () => {
  it('maps the social mode to socialPublish, not the mode id', () => {
    // instagram_post is a social-mode channel; the mode id is 'buffer'.
    expect(publishCapabilityKey('instagram_post')).toBe('socialPublish')
  })

  it('still derives non-social modes from the mode id', () => {
    expect(publishCapabilityKey('blog')).toBe('websitePublish')
  })

  it('every capability granted in prod is reachable by some channel', () => {
    const asked = new Set(
      Object.keys(OUTPUT_CHANNELS)
        .map((id) => publishCapabilityKey(id))
        .filter(Boolean),
    )
    // Non-vacuity: if the sweep stopped finding channels this would pass while
    // guarding nothing.
    expect(asked.size).toBeGreaterThan(1)
    expect([...asked]).toContain('websitePublish')

    const granted = KEYS_GRANTED_IN_PROD.filter((k) => !asked.has(k))
    expect(
      granted,
      `granted in prod but no channel asks for it (a dead flag): ${granted.join(', ')}`,
    ).toEqual([])
  })

  it('honours socialPublish on a workspace that has it', () => {
    const ws = { capabilities: { socialPublish: true, websitePublish: true } }
    expect(canDirectPublish(ws, 'instagram_post')).toBe(true)
  })

  it('does not grant social publish to a workspace without the flag', () => {
    const ws = { capabilities: { websitePublish: true } }
    expect(canDirectPublish(ws, 'instagram_post')).toBe(false)
  })
})
