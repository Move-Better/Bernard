import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — defense-in-depth: every agent_inbox mutation in agent-tick.js
// filters by workspace_id in addition to id. Not exploitable today (item.id
// is only ever a UUID sourced from a prior workspace_id=eq.${wsId}-scoped
// SELECT, and UUIDs are globally unique), but claimItem/finishItem and the
// retry-PATCH were the one exception to the convention every other mutation
// in this same file already follows -- found by /bernard-audit full.
const SRC = readFileSync(
  fileURLToPath(new URL('../../api/_routes/cron/agent-tick.js', import.meta.url)),
  'utf8',
)

describe('agent-tick.js scopes every agent_inbox id-based mutation by workspace_id too', () => {
  it('finds at least 3 agent_inbox?id=eq. mutations to check (non-vacuity)', () => {
    const hits = SRC.match(/agent_inbox\?id=eq\.\$\{[^}]+\}[^`]*/g) || []
    expect(hits.length).toBeGreaterThanOrEqual(3)
  })

  it('every agent_inbox?id=eq. mutation also carries &workspace_id=eq.', () => {
    const offenders = []
    for (const match of SRC.matchAll(/agent_inbox\?id=eq\.\$\{[^}]+\}([^`]*)`/g)) {
      if (!/&workspace_id=eq\./.test(match[1])) offenders.push(match[0])
    }
    expect(offenders).toEqual([])
  })
})
