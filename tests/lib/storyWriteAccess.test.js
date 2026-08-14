import { describe, it, expect } from 'vitest'
import { allowsNonOwnerStoryWrite } from '../../api/_lib/storyWriteAccess.js'

// Guards the non-owner write/delete allowance shared by the PATCH (approve /
// edit) and DELETE paths in api/_routes/db/interviews.js. The P1 this fixes
// (feedback a62c3bf2 / acf771c2) slipped lint, typecheck, build and 1753 unit
// tests because the authz lived inline in a request handler with no coverage.
//
// `role` here is what requireRole() computes: (isOrgAdmin || internalBypass)
// ? 'admin' : metadataRole. So on an 'internal'-plan workspace every member
// resolves to role 'admin'; on a paid/trial workspace only a genuine admin does.
describe('allowsNonOwnerStoryWrite', () => {
  it('allows a true Clerk org admin (fast-path, no tier lookup)', () => {
    expect(allowsNonOwnerStoryWrite({ isOrgAdmin: true, role: 'admin' })).toBe(true)
  })

  it('allows any role=admin — the parity-with-publish fix', () => {
    // Internal-plan producer / clinician / metadata-admin all resolve to
    // role 'admin' and can already PUBLISH, so they must be able to approve
    // the words that gate publishing. This is THE case the bug denied.
    expect(allowsNonOwnerStoryWrite({ isOrgAdmin: false, role: 'admin' })).toBe(true)
  })

  it('SAFETY: a paid/trial-plan non-admin is NOT fast-path allowed', () => {
    // The critical non-broadening property — a clinician on a regular paying
    // clinic (role stays 'clinician', no internal bypass) must fall through to
    // the permission_tier=owner check, exactly as before the fix.
    expect(allowsNonOwnerStoryWrite({ isOrgAdmin: false, role: 'clinician' })).toBe(false)
    expect(allowsNonOwnerStoryWrite({ isOrgAdmin: false, role: 'producer' })).toBe(false)
  })

  it('fails closed on missing / malformed auth', () => {
    expect(allowsNonOwnerStoryWrite(null)).toBe(false)
    expect(allowsNonOwnerStoryWrite(undefined)).toBe(false)
    expect(allowsNonOwnerStoryWrite({})).toBe(false)
    expect(allowsNonOwnerStoryWrite({ role: 'ADMIN' })).toBe(false) // case-sensitive on purpose
  })
})
