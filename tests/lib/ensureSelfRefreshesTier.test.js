import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// First sign-in: /api/workspace/me runs before the staff row exists, so
// current_user_tier is null and an internal-plan invitee is shown the owner
// screen. ensure-self creates the row; the hook must then refetch /me.
describe('useEnsureSelfStaff', () => {
  it('refetches workspace/me after provisioning the row', () => {
    const src = readFileSync('src/lib/useEnsureSelfStaff.js', 'utf8')
    expect(src).toMatch(/invalidateQueries\(\{\s*queryKey:\s*queryKeys\.workspace\.me\s*\}\)/)
  })
})
