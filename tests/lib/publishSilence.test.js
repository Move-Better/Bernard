import { describe, it, expect } from 'vitest'
import {
  findSilentChannels, fetchSilenceInputs, computeChannelSilence,
  SILENCE_THRESHOLD_DAYS,
} from '../../api/_lib/producer/publishSilence.js'

const NOW = new Date('2026-08-07T18:00:00Z')
const WS = '11111111-1111-4111-8111-111111111111'

describe('findSilentChannels — what counts as gone quiet', () => {
  const channels = {
    linkedin: { enabled: true, target_per_week: 3 },
    facebook: { enabled: true, target_per_week: 3 },
    gbp:      { enabled: true, target_per_week: 3 },
    blog:     { enabled: false, target_per_week: 1 },
    email:    { enabled: true, target_per_week: 0 },
  }

  it('flags a channel silent 9 days with ready work waiting', () => {
    const out = findSilentChannels({
      channels,
      lastPublishedAt: { linkedin: '2026-07-29T14:00:00Z', facebook: '2026-08-07T02:00:00Z', gbp: '2026-08-05T18:00:00Z' },
      readyCounts: { linkedin: 4, facebook: 4, gbp: 10 },
      now: NOW,
    })
    expect(out).toEqual([{ platform: 'linkedin', target: 3, daysSilent: 9.2, readyCount: 4 }])
  })

  it('never flags a channel that has not published before — silence has no baseline to measure from', () => {
    const out = findSilentChannels({
      channels: { instagram: { enabled: true, target_per_week: 4 } },
      lastPublishedAt: { instagram: null },
      readyCounts: { instagram: 1 },
      now: NOW,
    })
    expect(out).toEqual([])
  })

  it('never flags a channel with nothing ready — silence with no waiting work is nothing to act on', () => {
    const out = findSilentChannels({
      channels: { linkedin: { enabled: true, target_per_week: 3 } },
      lastPublishedAt: { linkedin: '2026-05-20T00:00:00Z' }, // 79 days silent
      readyCounts: { linkedin: 0 },
      now: NOW,
    })
    expect(out).toEqual([])
  })

  it('does not flag a channel still inside the threshold window', () => {
    const justUnder = new Date(NOW.getTime() - (SILENCE_THRESHOLD_DAYS - 0.1) * 86_400_000).toISOString()
    const out = findSilentChannels({
      channels: { facebook: { enabled: true, target_per_week: 3 } },
      lastPublishedAt: { facebook: justUnder },
      readyCounts: { facebook: 2 },
      now: NOW,
    })
    expect(out).toEqual([])
  })

  it('flags right at the threshold boundary', () => {
    const exactly7 = new Date(NOW.getTime() - SILENCE_THRESHOLD_DAYS * 86_400_000).toISOString()
    const out = findSilentChannels({
      channels: { facebook: { enabled: true, target_per_week: 3 } },
      lastPublishedAt: { facebook: exactly7 },
      readyCounts: { facebook: 2 },
      now: NOW,
    })
    expect(out).toHaveLength(1)
  })

  it('never flags a disabled channel or one with no target', () => {
    const out = findSilentChannels({
      channels,
      lastPublishedAt: { blog: '2026-01-01T00:00:00Z', email: '2026-01-01T00:00:00Z' },
      readyCounts: { blog: 5, email: 5 },
      now: NOW,
    })
    expect(out).toEqual([])
  })

  it('sorts most-silent first', () => {
    const out = findSilentChannels({
      channels,
      lastPublishedAt: { linkedin: '2026-07-29T00:00:00Z', facebook: '2026-07-01T00:00:00Z', gbp: '2026-07-25T00:00:00Z' },
      readyCounts: { linkedin: 1, facebook: 1, gbp: 1 },
      now: NOW,
    })
    expect(out.map((c) => c.platform)).toEqual(['facebook', 'gbp', 'linkedin'])
  })

  it('reproduces the real movebetter finding for 2026-08-07 exactly', () => {
    // Verified against prod (project wrqfrjhevkbbheymzezy, workspace
    // 76faa447-b1f4-4038-babc-4d86536b049d) on 2026-08-07: linkedin last
    // published 2026-07-29 (9.0d silent) with 4 drafts ready; facebook/gbp/
    // instagram all published within the last 3 days and must NOT flag.
    const out = findSilentChannels({
      channels: {
        facebook:  { enabled: true, target_per_week: 3 },
        gbp:       { enabled: true, target_per_week: 3 },
        instagram: { enabled: true, target_per_week: 6 },
        linkedin:  { enabled: true, target_per_week: 3 },
      },
      lastPublishedAt: {
        facebook:  '2026-08-07T02:00:00Z',
        gbp:       '2026-08-05T12:00:00Z',
        instagram: '2026-08-04T20:00:00Z',
        linkedin:  '2026-07-29T14:00:00Z',
      },
      readyCounts: { facebook: 4, gbp: 10, instagram: 13, linkedin: 4 },
      now: NOW,
    })
    expect(out.map((c) => c.platform)).toEqual(['linkedin'])
    expect(out[0].daysSilent).toBeCloseTo(9.2, 1)
    expect(out[0].readyCount).toBe(4)
  })
})

describe('fetchSilenceInputs — data plumbing', () => {
  const channels = { linkedin: { enabled: true, target_per_week: 3 }, facebook: { enabled: true, target_per_week: 3 } }

  function fakeSb({ published = {}, ready = [] } = {}) {
    const calls = []
    const fn = async (path) => {
      calls.push(path)
      if (path.includes('status=eq.published')) {
        const platform = decodeURIComponent(path.match(/platform=eq\.([^&]+)/)?.[1] || '')
        const iso = published[platform]
        return { ok: true, json: async () => (iso ? [{ published_at: iso }] : []) }
      }
      if (path.includes('status=in.(draft,approved)')) {
        return { ok: true, json: async () => ready }
      }
      throw new Error(`unexpected path: ${path}`)
    }
    fn.calls = calls
    return fn
  }

  it('never queries a platform that has no cadence target', async () => {
    const sb = fakeSb()
    await fetchSilenceInputs({ workspaceId: WS, sb, channels: { ...channels, blog: { enabled: false, target_per_week: 1 } } })
    expect(sb.calls.some((p) => p.includes('platform=eq.blog'))).toBe(false)
  })

  it('resolves the max published_at per platform and counts ready items', async () => {
    const sb = fakeSb({
      published: { linkedin: '2026-07-29T14:00:00Z', facebook: '2026-08-07T02:00:00Z' },
      ready: [{ platform: 'linkedin' }, { platform: 'linkedin' }, { platform: 'facebook' }],
    })
    const out = await fetchSilenceInputs({ workspaceId: WS, sb, channels })
    expect(out.lastPublishedAt).toEqual({ linkedin: '2026-07-29T14:00:00Z', facebook: '2026-08-07T02:00:00Z' })
    expect(out.readyCounts).toEqual({ linkedin: 2, facebook: 1 })
  })

  it('leaves a platform null when it has never published, rather than throwing', async () => {
    const sb = fakeSb({ published: {}, ready: [] })
    const out = await fetchSilenceInputs({ workspaceId: WS, sb, channels })
    expect(out.lastPublishedAt).toEqual({ linkedin: null, facebook: null })
  })

  it('fails soft to empty maps when a read errors, never throws', async () => {
    const sb = async () => ({ ok: false, status: 500, json: async () => [] })
    const out = await fetchSilenceInputs({ workspaceId: WS, sb, channels })
    expect(out).toEqual({ lastPublishedAt: { linkedin: null, facebook: null }, readyCounts: {} })
  })

  it('short-circuits with no queries when no channel has a target', async () => {
    const sb = fakeSb()
    const out = await fetchSilenceInputs({ workspaceId: WS, sb, channels: { blog: { enabled: false } } })
    expect(out).toEqual({ lastPublishedAt: {}, readyCounts: {} })
    expect(sb.calls).toEqual([])
  })
})

describe('computeChannelSilence — fetch + compute end to end', () => {
  it('composes the two halves correctly', async () => {
    const sb = async (path) => {
      if (path.includes('status=eq.published')) {
        return { ok: true, json: async () => [{ published_at: '2026-07-29T14:00:00Z' }] }
      }
      return { ok: true, json: async () => [{ platform: 'linkedin' }, { platform: 'linkedin' }] }
    }
    const out = await computeChannelSilence({
      workspaceId: WS, sb,
      channels: { linkedin: { enabled: true, target_per_week: 3 } },
      now: NOW,
    })
    expect(out).toEqual([{ platform: 'linkedin', target: 3, daysSilent: 9.2, readyCount: 2 }])
  })
})
