import { describe, it, expect } from 'vitest'
import { campaignTuningHint } from '../../api/_lib/activeCampaigns.js'
import { buildStrategistPrompt } from '../../api/_lib/strategist.js'

const NOW = new Date('2026-07-23T12:00:00Z').getTime()
const hoursAgo = (h) => new Date(NOW - h * 60 * 60 * 1000).toISOString()
const daysAgo = (d) => hoursAgo(d * 24)

const campaign = (over = {}) => ({
  id: 'c1',
  name: 'Running Seminar',
  ai_tuned_at: hoursAgo(6),
  ai_tune_state: { priority_angles: ['Patient story'], priority_platform: 'instagram' },
  ...over,
})

const CHANNELS = ['instagram', 'linkedin', 'gbp']

describe('campaignTuningHint', () => {
  it('returns the campaign name, angles, and platform for a fresh tune', () => {
    expect(campaignTuningHint([campaign()], CHANNELS, NOW)).toEqual({
      campaignName: 'Running Seminar',
      angles: ['Patient story'],
      platform: 'instagram',
    })
  })

  it('ignores a tune older than the staleness window', () => {
    // campaign-tune.js re-runs every 6-20h, so a 20-day-old tune means the cron
    // stopped — not that the advice is still good.
    expect(campaignTuningHint([campaign({ ai_tuned_at: daysAgo(20) })], CHANNELS, NOW)).toBeNull()
  })

  it('ignores a tune with no ai_tuned_at at all', () => {
    expect(campaignTuningHint([campaign({ ai_tuned_at: null })], CHANNELS, NOW)).toBeNull()
  })

  it('skips runCampaignSpin parse-failure fallbacks', () => {
    const failed = campaign({
      ai_tune_state: { priority_angles: [], priority_platform: null, _error: 'parse error' },
    })
    expect(campaignTuningHint([failed], CHANNELS, NOW)).toBeNull()
  })

  it('drops a priority_platform that is not an enabled channel', () => {
    const c = campaign({ ai_tune_state: { priority_angles: ['A'], priority_platform: 'tiktok' } })
    expect(campaignTuningHint([c], CHANNELS, NOW)).toEqual({
      campaignName: 'Running Seminar', angles: ['A'], platform: null,
    })
  })

  it('drops "blog" — it is a real tune value but has no angle palette to plan against', () => {
    // Observed in prod: the active campaign tuned to priority_platform "blog"
    // because top-performers were blog-only before the scoring fix.
    const c = campaign({ ai_tune_state: { priority_angles: ['A'], priority_platform: 'blog' } })
    expect(campaignTuningHint([c], CHANNELS, NOW).platform).toBeNull()
  })

  it('matches a display-cased platform and returns the enum spelling', () => {
    // Observed in prod: the model answered "Facebook", not "facebook".
    const c = campaign({ ai_tune_state: { priority_angles: ['A'], priority_platform: 'Facebook' } })
    expect(campaignTuningHint([c], [...CHANNELS, 'facebook'], NOW).platform).toBe('facebook')
  })

  it('returns null when nothing usable survives validation', () => {
    const c = campaign({ ai_tune_state: { priority_angles: [], priority_platform: 'tiktok' } })
    expect(campaignTuningHint([c], CHANNELS, NOW)).toBeNull()
  })

  it('caps angle count and length — ai_tune_state is model-generated', () => {
    const c = campaign({
      ai_tune_state: {
        priority_angles: ['a'.repeat(200), 'two', 'three', 'four'],
        priority_platform: 'linkedin',
      },
    })
    const hint = campaignTuningHint([c], CHANNELS, NOW)
    expect(hint.angles).toHaveLength(2)
    expect(hint.angles[0].length).toBe(80)
  })

  it('picks the highest-weight campaign, not the first', () => {
    // Event 2 days out outweighs an evergreen campaign, so its read wins.
    const evergreen = campaign({ id: 'a', name: 'Evergreen', event_at: null,
      ai_tune_state: { priority_angles: ['Evergreen angle'], priority_platform: 'linkedin' } })
    const urgent = campaign({ id: 'b', name: 'Seminar', event_at: new Date(NOW + 2 * 86400000).toISOString(),
      ai_tune_state: { priority_angles: ['Urgent angle'], priority_platform: 'instagram' } })
    const hint = campaignTuningHint([evergreen, urgent], CHANNELS, NOW)
    expect(hint.campaignName).toBe('Seminar')
    expect(hint.angles).toEqual(['Urgent angle'])
  })

  it('falls through to a lower-weight campaign when the top one has no usable tune', () => {
    const urgentNoTune = campaign({ id: 'b', name: 'Seminar',
      event_at: new Date(NOW + 2 * 86400000).toISOString(), ai_tune_state: null })
    const evergreen = campaign({ id: 'a', name: 'Evergreen', event_at: null,
      ai_tune_state: { priority_angles: ['Evergreen angle'], priority_platform: 'linkedin' } })
    expect(campaignTuningHint([urgentNoTune, evergreen], CHANNELS, NOW).campaignName).toBe('Evergreen')
  })

  it('returns null for no campaigns', () => {
    expect(campaignTuningHint([], CHANNELS, NOW)).toBeNull()
    expect(campaignTuningHint(null, CHANNELS, NOW)).toBeNull()
  })
})

describe('buildStrategistPrompt campaign signal', () => {
  const base = {
    interviews: [{ id: 'i1', topic: 'Sciatica', summary_text: 'notes' }],
    channels: ['instagram'],
    recentTopics: [],
    palette: { instagram: [{ angle: 'hook', label: 'Hook' }] },
  }

  it('omits the block entirely when there is no tuning', () => {
    expect(buildStrategistPrompt({ ...base }).user).not.toContain('CAMPAIGN SIGNAL')
  })

  it('renders angles and platform, framed as a tiebreaker', () => {
    const { user } = buildStrategistPrompt({
      ...base,
      campaignTuning: { campaignName: 'Running Seminar', angles: ['Patient story'], platform: 'instagram' },
    })
    expect(user).toContain('CAMPAIGN SIGNAL — Running Seminar')
    expect(user).toContain('"Patient story"')
    expect(user).toContain('Strongest channel right now: instagram')
    // Must stay subordinate to the variety rules, or one hot angle flattens the feed.
    expect(user).toContain('tiebreaker')
    expect(user).toContain('does NOT override')
  })

  it('renders only the half that is present', () => {
    const { user } = buildStrategistPrompt({
      ...base,
      campaignTuning: { campaignName: 'C', angles: [], platform: 'instagram' },
    })
    expect(user).toContain('Strongest channel right now')
    expect(user).not.toContain('Angles resonating')
  })
})
