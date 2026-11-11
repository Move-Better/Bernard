import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  experienceFor, effectiveExperience, navKeysFor, NAV_LAYOUT, BOTTOM_LINKS,
  EXPERIENCE_OWNER, EXPERIENCE_PRODUCER, EXPERIENCE_TEAM, EXPERIENCE_NONE,
} from '../../src/lib/experience.js'

// Q, 2026-11-09: the person's Access level (staff.permission_tier) alone picks
// their screen. Clerk org-admin rights do not change it. See
// .claude/decisions.md "One screen per role".

describe('experienceFor', () => {
  // Every tier, with each legacy role, so a role leaking into the decision for
  // a person who HAS a tier fails here. Whitney (team member, Clerk org admin)
  // and Alli (producer, Clerk org admin) are the real cases this pins.
  const ROLES = ['admin', 'publisher', 'clinician', null]
  const CASES = [
    ['owner', EXPERIENCE_OWNER],
    ['producer', EXPERIENCE_PRODUCER],
    ['clinician', EXPERIENCE_TEAM],
    ['viewer', EXPERIENCE_TEAM],
  ]
  for (const [tier, want] of CASES) {
    for (const role of ROLES) {
      it(`tier ${tier} with role ${role} → ${want}`, () => {
        expect(experienceFor({ tier, role })).toBe(want)
      })
    }
  }

  it('no tier falls back to the legacy role: admin is the owner', () => {
    expect(experienceFor({ tier: null, role: 'admin' })).toBe(EXPERIENCE_OWNER)
    expect(experienceFor({ tier: undefined, role: 'admin' })).toBe(EXPERIENCE_OWNER)
  })

  it('no tier and not admin is a team member, never the owner', () => {
    expect(experienceFor({ tier: null, role: 'clinician' })).toBe(EXPERIENCE_TEAM)
    expect(experienceFor({ tier: null, role: 'publisher' })).toBe(EXPERIENCE_TEAM)
    expect(experienceFor({ tier: null, role: null })).toBe(EXPERIENCE_TEAM)
    expect(experienceFor()).toBe(EXPERIENCE_TEAM)
  })

  it('an unknown tier string is treated like no tier', () => {
    expect(experienceFor({ tier: 'superuser', role: 'clinician' })).toBe(EXPERIENCE_TEAM)
    expect(experienceFor({ tier: 'superuser', role: 'admin' })).toBe(EXPERIENCE_OWNER)
  })

  it('a deactivated person gets no screen, whatever their tier or role', () => {
    for (const tier of ['owner', 'producer', 'clinician', 'viewer', null]) {
      expect(experienceFor({ tier, role: 'admin', deactivated: true })).toBe(EXPERIENCE_NONE)
    }
  })
})

describe('effectiveExperience (See Bernard as)', () => {
  it('an owner can look as any role', () => {
    expect(effectiveExperience(EXPERIENCE_OWNER, 'team')).toBe(EXPERIENCE_TEAM)
    expect(effectiveExperience(EXPERIENCE_OWNER, 'producer')).toBe(EXPERIENCE_PRODUCER)
    expect(effectiveExperience(EXPERIENCE_OWNER, 'owner')).toBe(EXPERIENCE_OWNER)
  })
  it('a stored choice never lifts anyone else to the owner screen', () => {
    expect(effectiveExperience(EXPERIENCE_TEAM, 'owner')).toBe(EXPERIENCE_TEAM)
    expect(effectiveExperience(EXPERIENCE_PRODUCER, 'owner')).toBe(EXPERIENCE_PRODUCER)
    expect(effectiveExperience(EXPERIENCE_NONE, 'owner')).toBe(EXPERIENCE_NONE)
  })
  it('garbage or no choice keeps the owner screen', () => {
    expect(effectiveExperience(EXPERIENCE_OWNER, null)).toBe(EXPERIENCE_OWNER)
    expect(effectiveExperience(EXPERIENCE_OWNER, 'none')).toBe(EXPERIENCE_OWNER)
    expect(effectiveExperience(EXPERIENCE_OWNER, 'x')).toBe(EXPERIENCE_OWNER)
  })
})

describe('sidebar layouts (signed off 2026-11-09)', () => {
  it('team member: Home, My stories, Library', () => {
    expect(navKeysFor(EXPERIENCE_TEAM)).toEqual(['home', 'my-stories', 'library'])
    expect(BOTTOM_LINKS[EXPERIENCE_TEAM]).toEqual(['profile'])
  })

  it('producer: Home, Your week, Moments, Library, Insights, More (Ads, Bernard)', () => {
    expect(navKeysFor(EXPERIENCE_PRODUCER)).toEqual(['home', 'week', 'moments', 'library', 'insights', 'ads', 'producer'])
    expect(BOTTOM_LINKS[EXPERIENCE_PRODUCER]).toEqual(['settings', 'profile'])
    for (const hidden of ['overview', 'seo', 'stories', 'book', 'write', 'previsit', 'usage']) {
      expect(navKeysFor(EXPERIENCE_PRODUCER)).not.toContain(hidden)
    }
  })

  it('owner: six rows, the rest under Results and More (signed off 2026-11-10)', () => {
    const [top, ...rest] = NAV_LAYOUT[EXPERIENCE_OWNER]
    expect(rest).toEqual([])
    expect(top.label).toBeUndefined()
    // Six visible rows: four links and two flyouts.
    expect(top.items.map((it) => (typeof it === 'string' ? it : it.label)))
      .toEqual(['home', 'week', 'stories', 'library', 'Results', 'More'])
    expect(navKeysFor(EXPERIENCE_OWNER)).toEqual([
      'home', 'week', 'stories', 'library',
      'insights', 'overview', 'seo', 'usage',
      'producer', 'moments', 'ads', 'synthesis', 'book', 'write', 'previsit', 'admin',
    ])
    expect(BOTTOM_LINKS[EXPERIENCE_OWNER]).toEqual(['settings', 'profile'])
  })

  it('every key a layout names has an item definition in Layout.jsx', () => {
    const layout = readFileSync(fileURLToPath(new URL('../../src/components/Layout.jsx', import.meta.url)), 'utf8')
    const body = layout.slice(layout.indexOf('const NAV_ITEMS = {'), layout.indexOf('\n}\n', layout.indexOf('const NAV_ITEMS = {')))
    const keys = new Set(Object.keys(NAV_LAYOUT).flatMap(navKeysFor))
    expect(keys.size).toBeGreaterThan(10)
    for (const k of keys) {
      const pattern = new RegExp(`^\\s*(${k}|'${k}'):\\s*\\{`, 'm')
      expect(body, `NAV_ITEMS is missing "${k}"`).toMatch(pattern)
    }
  })
})

describe('the router and the sidebar read the same decision', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  it('HomeRouter and Layout both use useExperience', () => {
    const app = read('../../src/App.jsx')
    const homeRouter = app.slice(app.indexOf('function HomeRouter()'), app.indexOf('\n}\n', app.indexOf('function HomeRouter()')))
    expect(homeRouter).toMatch(/useExperience\(\)/)
    expect(read('../../src/components/Layout.jsx')).toMatch(/useExperience\(\)/)
  })
})

describe('See Bernard as wiring', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  const SWITCH = read('../../src/components/ViewAsSwitch.jsx')
  it('the switch and the banner render nothing for anyone who is not the owner', () => {
    const guards = SWITCH.match(/if \(actual !== EXPERIENCE_OWNER\b/g) || []
    expect(guards.length).toBe(2)
  })
  it('the way back is on every page (banner in the app shell)', () => {
    expect(read('../../src/components/Layout.jsx')).toMatch(/<ViewAsBanner \/>/)
  })
  it('the stored choice goes through effectiveExperience, never straight into the screen', () => {
    const hook = read('../../src/lib/useExperience.js')
    expect(hook).toMatch(/experience: effectiveExperience\(actual, viewAs\)/)
  })
})
