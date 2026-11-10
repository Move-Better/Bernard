// Which screen a person gets: the one decision the router (HomeRouter in
// App.jsx) and the sidebar (Layout.jsx) both read, so they can never disagree.
//
// Q, 2026-11-09 (.claude/decisions.md, "One screen per role"): the person's
// Access level, staff.permission_tier, alone picks the screen. Clerk org-admin
// rights keep working for what they unlock, but they do not change the screen.
//
// PRESENTATION ONLY. Hiding a sidebar place is not authorization: every page
// stays reachable by URL for anyone the server allows, and every server check
// is unchanged. Nothing here may be used to grant or refuse an action.
//
// Pure on purpose: the rule below is the whole feature, and it is tested
// against every tier in tests/lib/experience.test.js.

import { TIER_OWNER, TIER_PRODUCER, TIER_CLINICIAN, TIER_VIEWER } from '@/lib/roles'

export const EXPERIENCE_OWNER = 'owner'
export const EXPERIENCE_PRODUCER = 'producer'
export const EXPERIENCE_TEAM = 'team'
/** Switched off by an owner. The app shows the "access is switched off" screen. */
export const EXPERIENCE_NONE = 'none'

export const ALL_EXPERIENCES = [EXPERIENCE_OWNER, EXPERIENCE_PRODUCER, EXPERIENCE_TEAM]

/**
 * @param {object} input
 * @param {string|null|undefined} input.tier  staff.permission_tier (current_user_tier)
 * @param {string|null|undefined} input.role  legacy role from useUserRole ('admin' | 'publisher' | 'clinician')
 * @param {boolean} [input.deactivated]       access switched off (workspace.access_deactivated)
 * @returns {'owner'|'producer'|'team'|'none'}
 */
export function experienceFor({ tier, role, deactivated = false } = {}) {
  if (deactivated) return EXPERIENCE_NONE
  if (tier === TIER_OWNER) return EXPERIENCE_OWNER
  if (tier === TIER_PRODUCER) return EXPERIENCE_PRODUCER
  if (tier === TIER_CLINICIAN || tier === TIER_VIEWER) return EXPERIENCE_TEAM
  // No tier at all: a member with no staff row in this workspace yet (staff
  // rows are provisioned on first load, with the tier left NULL for owners —
  // see ARCHITECTURE.md "permission_tier is NEVER 'owner'"). Fall back to the
  // legacy role, which is what HomeRouter did before this function existed:
  // a Clerk org admin, or any member of an internal-plan workspace, is the
  // owner. Unknown tier strings land here too and get the same treatment.
  return role === 'admin' ? EXPERIENCE_OWNER : EXPERIENCE_TEAM
}

/**
 * The owner can look at Bernard as another role ("See Bernard as", Q
 * 2026-11-09). Only an actual owner may switch; for anyone else the stored
 * choice is ignored, so a stale value can never hand someone the owner screen.
 *
 * @param {string} actual  experienceFor(...) for the signed-in person
 * @param {string|null|undefined} viewAs  stored choice
 */
export function effectiveExperience(actual, viewAs) {
  if (actual !== EXPERIENCE_OWNER) return actual
  return ALL_EXPERIENCES.includes(viewAs) ? viewAs : actual
}

// ── Sidebar layout per screen ─────────────────────────────────────────────
// Keys name item definitions in Layout.jsx (NAV_ITEMS). A string is a link;
// { flyout, label, items } is a grouped menu. Each item still passes through
// its own visibility gates in Layout, so a key listed here can still be hidden
// (e.g. 'producer' only shows once the workspace has hired Bernard).
//
// The owner layout is exactly the sidebar that existed before 2026-11-09.

export const NAV_LAYOUT = Object.freeze({
  [EXPERIENCE_OWNER]: [
    { items: ['home', { flyout: true, label: 'Analytics', items: ['overview', 'insights', 'seo'] }] },
    { label: 'Produce', items: ['week', 'producer', 'stories', 'moments', 'ads'] },
    { label: 'Library', items: ['library'] },
    { label: 'Tools', items: [{ flyout: true, label: 'Tools', items: ['book', 'write', 'previsit', 'usage', 'admin'] }] },
  ],
  [EXPERIENCE_PRODUCER]: [
    { items: ['home'] },
    { label: 'Produce', items: ['week', 'moments'] },
    { label: 'Library', items: ['library'] },
    { label: 'Results', items: ['insights', { flyout: true, label: 'More', items: ['ads', 'producer'] }] },
  ],
  [EXPERIENCE_TEAM]: [
    { items: ['home', 'my-stories', 'library'] },
  ],
})

/** Links pinned to the bottom of the sidebar (and the mobile drawer's extras). */
export const BOTTOM_LINKS = Object.freeze({
  [EXPERIENCE_OWNER]: ['synthesis', 'settings', 'profile'],
  [EXPERIENCE_PRODUCER]: ['settings', 'profile'],
  [EXPERIENCE_TEAM]: ['profile'],
})

/** Every item key a layout can show, flyouts flattened. */
export function navKeysFor(experience) {
  const layout = NAV_LAYOUT[experience] || []
  return layout.flatMap((s) => s.items.flatMap((it) => (typeof it === 'string' ? [it] : it.items)))
}
