import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('ai', () => ({ generateObject: vi.fn(async () => ({ object: { skip: false, summary: 'Something changed for producers.', roles: ['producer'] } })) }))
vi.mock('../api/_lib/supabaseRest.js', () => ({
  supabaseRest: vi.fn(async (path) => (path.startsWith('product_updates?select')
    ? { ok: true, json: async () => [{ created_at: '2026-09-20T00:00:00Z' }] }
    : { ok: true, text: async () => '' })),
}))

const { generateProductUpdates } = await import('../api/_lib/producer/productUpdatesGenerator.js')
const realFetch = globalThis.fetch

beforeEach(() => { process.env.GITHUB_TOKEN_BERNARD_READ = 'tok' })
afterEach(() => { globalThis.fetch = realFetch })

describe('product updates feed', () => {
  it('a refused GitHub read is an error, never "no new PRs" (the 2026-09-20 silent stop)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    await expect(generateProductUpdates({ dryRun: true })).rejects.toThrow(/401.*expired or revoked/)
  })

  it('PRs merged after the last entry become candidates; chores are skipped', async () => {
    globalThis.fetch = vi.fn(async (url) => ({
      ok: true, status: 200,
      json: async () => (String(url).includes('page=1') ? [
        { number: 2801, title: 'feat(cron): daily link check', body: 'x', merged_at: '2026-11-15T23:00:00Z' },
        { number: 2804, title: 'docs: runbook', body: 'x', merged_at: '2026-11-16T00:30:00Z' },
        { number: 2700, title: 'feat: old', body: 'x', merged_at: '2026-09-01T00:00:00Z' },
      ] : []),
    }))
    const r = await generateProductUpdates({ dryRun: true })
    expect(r.candidates).toBe(1)
    expect(r.entries.map((e) => e.source_pr)).toEqual([2801])
  })
})
