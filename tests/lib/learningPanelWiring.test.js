import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dimensionTrust, trustSentence } from '../../api/_lib/learningSignals.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const ROUTE = read('../../api/_routes/producer/learning.js')
const PANEL = read('../../src/components/producer/LearningPanel.jsx')

describe('the endpoint reports honestly rather than flatteringly', () => {
  it('a FAILED count must not become zero', () => {
    // exactCount returns null on error. Coercing that to 0 would render as
    // "nothing overridden — all good", i.e. a reassuring lie about a read that
    // did not happen. The route routes null through to no_data instead.
    expect(ROUTE).toContain('A failed count is NOT zero')
    expect(ROUTE).toMatch(/observations:\s*\w+\s*\?\?\s*0/)
    expect(ROUTE).toMatch(/overrides:\s*\w+\s*\?\?\s*0/)
  })

  it('nothing can graduate from this endpoint alone', () => {
    // Window history is not tracked yet, so graduatedWindows is pinned at 0 and
    // every dimension keeps being flagged. Failing toward "show the human" is
    // the safe direction while the loop is incomplete.
    expect(ROUTE).toMatch(/graduatedWindows:\s*0/)
    const t = dimensionTrust({ overrides: 0, observations: 500, graduatedWindows: 0 })
    expect(t.state).toBe('checking')
  })

  it('counts the times Bernard was RIGHT, not only the corrections', () => {
    // A rate needs its denominator. Approved-without-an-edit is Bernard being
    // right about the words; format_source/media_source not-null is Bernard
    // having made a choice at all.
    expect(ROUTE).toContain('status=in.(approved,scheduled,published)')
    expect(ROUTE).toContain('format_source=not.is.null')
    expect(ROUTE).toContain('media_source=not.is.null')
  })

  it('is workspace-scoped on every count', () => {
    const scopes = ROUTE.match(/content_items\?[^`]*/g) || []
    expect(scopes.length).toBeGreaterThan(0)
    for (const q of scopes) expect(q).toContain('workspace_id=eq.')
  })

  it('windows the data so an old preference stops counting forever', () => {
    expect(ROUTE).toMatch(/created_at=gte\./)
    expect(ROUTE).toMatch(/WINDOW_DAYS = \d+/)
  })
})

describe('the panel never implies a measurement it does not have', () => {
  it('draws a bar ONLY when a rate is reportable', () => {
    expect(PANEL).toContain('pct != null &&')
  })

  it('renders the sentence for every state, not just the numeric ones', () => {
    // The cold states are the FIRST thing this panel says for weeks — they have
    // to read as honest, not broken.
    for (const state of ['untracked', 'no_data', 'too_few']) {
      const t = state === 'untracked'
        ? dimensionTrust({ overrides: 0, observations: 0, instrumented: false })
        : state === 'no_data'
          ? dimensionTrust({ overrides: 0, observations: 0 })
          : dimensionTrust({ overrides: 2, observations: 5 })
      expect(t.state).toBe(state)
      expect(trustSentence('media', t).length).toBeGreaterThan(10)
      expect(trustSentence('media', t)).not.toMatch(/\d+%/)
    }
  })

  it('a failed read shows a message, never an empty reassuring panel', () => {
    expect(PANEL).toContain('isError')
    expect(PANEL).toMatch(/Couldn|couldn/)
  })

  it('uses its own query so a slow read cannot delay the checkpoint queue', () => {
    expect(PANEL).toContain("queryKey: ['producer-learning']")
  })
})
