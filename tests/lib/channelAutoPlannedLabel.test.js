import { describe, it, expect } from 'vitest'

import { isAutoPlannedChannel } from '../../src/pages/settings/ChannelsSettings.jsx'
import { OUTPUT_CHANNELS } from '../../src/lib/outputChannels.js'
import { ATOM_DEFINITIONS, atomPlatformsFromEnabledOutputs } from '../../api/_lib/atomPlan.js'

// GUARD — Settings → Channels must not imply the weekly planner covers a channel
// it structurally cannot schedule.
//
// The 2026-08-01 outcome review found movebetter with blog, email and youtube in
// enabled_outputs while the Strategist allocated against none of them: blog went
// 45 days silent and email/youtube had never produced a single row, ever. The
// picker gave no hint of the difference, so three dead channels looked identical
// to seven live ones.
//
// isAutoPlannedChannel is DERIVED from the cadence-bearing platform list rather
// than a hardcoded exclusion set, so a channel that later gains a real lane stops
// being labelled automatically. These assertions pin that derivation to the
// server's ATOM_DEFINITIONS — the planner's own source of truth — so the two
// cannot drift apart silently.

describe('isAutoPlannedChannel', () => {
  it('marks the channels the planner has no lane for', () => {
    // Every one of these is a legitimate, publishable output with no atom
    // definition — enabling it must never imply weekly scheduling.
    for (const id of ['blog', 'email', 'youtube', 'youtube_short', 'google_ads', 'ig_ads', 'landing_page']) {
      expect(isAutoPlannedChannel(id), `${id} should read as manual`).toBe(false)
    }
  })

  it('leaves the real cadence channels unlabelled', () => {
    for (const id of ['instagram_post', 'instagram_reel', 'instagram_story', 'facebook', 'linkedin', 'gbp', 'tiktok', 'twitter', 'threads', 'bluesky', 'mastodon']) {
      expect(isAutoPlannedChannel(id), `${id} is planned`).toBe(true)
    }
  })

  // Non-vacuity + anti-drift: agreement with the server is what makes the label
  // true, so assert it channel-by-channel over the WHOLE registry rather than
  // trusting the two hand-written lists above to stay complete. A channel added
  // to the registry is covered here the day it lands.
  it('agrees with the server ATOM_DEFINITIONS for every registered channel', () => {
    const ids = Object.keys(OUTPUT_CHANNELS)
    expect(ids.length).toBeGreaterThan(10)

    for (const id of ids) {
      const platforms = [...(atomPlatformsFromEnabledOutputs([id]) || [])]
      const serverPlans = platforms.some((p) => Object.hasOwn(ATOM_DEFINITIONS, p))
      expect(isAutoPlannedChannel(id), `${id} disagrees with ATOM_DEFINITIONS`).toBe(serverPlans)
    }
  })
})
