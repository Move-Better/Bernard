import { describe, it, expect } from 'vitest'
import { SETTINGS_GROUPS, visibleSettingsGroups } from '../../src/lib/settingsNav.js'

// Simplicity audit G (2026-11-10): settings grouped by job. Q signed off on
// exactly this menu; changing it is a design decision, not a tidy-up.
const shape = (groups) => groups.map((g) => [g.label, g.items.map((i) => i.label)])

describe('settings menu', () => {
  it('owners see five groups in the signed-off order', () => {
    expect(shape(visibleSettingsGroups(true))).toEqual([
      ['Clinic', ['General', 'Locations', 'Plan & billing']],
      ['Posting', ['Integrations', 'Channels', 'Campaigns', 'Auto-publish']],
      ['Brand', ['Identity', 'Voice', 'Look', 'Photo templates', 'Reel templates', 'Music']],
      ['Bernard', ['Bernard’s settings', 'Interview setup', 'Clinic knowledge']],
      ['Team', ['Members & roles', 'Permissions']],
    ])
  })

  it('everyone else sees only Plan & billing, Integrations and Look', () => {
    expect(shape(visibleSettingsGroups(false))).toEqual([
      ['Clinic', ['Plan & billing']],
      ['Posting', ['Integrations']],
      ['Brand', ['Look']],
    ])
  })

  it('every page appears exactly once', () => {
    const paths = SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.to))
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toHaveLength(18)
  })
})
