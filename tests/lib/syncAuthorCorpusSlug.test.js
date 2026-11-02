import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The cron looked up its source workspace by 'movebetter-people', a slug that
// was later renamed 'movebetter'. It threw "Source workspace not found" every
// Sunday (swallowed into a 200) and the qbook corpus froze on 2026-06-07.
const src = readFileSync(new URL('../../api/_routes/cron/sync-author-corpus.js', import.meta.url), 'utf8')

describe('sync-author-corpus source workspace', () => {
  it("reads from the live 'movebetter' workspace, not the retired slug", () => {
    expect(src).toMatch(/^const SOURCE_SLUG = 'movebetter'$/m)
    expect(src).not.toMatch(/SOURCE_SLUG = 'movebetter-people'/)
  })

  it('still copies into qbook only', () => {
    expect(src).toMatch(/^const TARGET_SLUG = 'qbook'$/m)
  })
})
