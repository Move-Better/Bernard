// A long-form piece that dies mid-render (300s function wall, OOM) never runs
// its catch, so MAX_CHUNK_ATTEMPTS was enforced only on thrown errors. The
// stale reclaim reset every dead 'rendering' piece to 'pending' regardless of
// attempts, the resume cron re-kicked it every 5 minutes, and the package never
// failed: a heavy render burned every cycle until someone pressed Stop
// (audit 2026-11-18, full). The reclaim must fail exhausted pieces instead.

import { describe, it, expect, vi } from 'vitest'

vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn() }))

const { staleReclaimRequests, MAX_CHUNK_ATTEMPTS } = await import('../../api/_lib/longformEngine.js')

// Apply the PostgREST filters these requests carry to an in-memory chunk list.
function apply(chunks, reqs) {
  const out = chunks.map((c) => ({ ...c }))
  for (const { path, body } of reqs) {
    const params = new URL(`http://x/${path}`).searchParams
    for (const c of out) {
      let ok = true
      for (const [k, v] of params) {
        const [op, ...rest] = v.split('.')
        const val = rest.join('.')
        const cur = c[k]
        if (op === 'eq') ok &&= String(cur) === val
        else if (op === 'lt') ok &&= (k === 'updated_at' ? cur < val : Number(cur) < Number(val))
        else if (op === 'gte') ok &&= Number(cur) >= Number(val)
        else throw new Error(`unhandled op ${op} on ${k}`)
      }
      if (ok) Object.assign(c, body)
    }
  }
  return out
}

describe('longform stale reclaim', () => {
  const staleBefore = '2026-11-18T12:00:00.000Z'
  const old = '2026-11-18T11:00:00.000Z'
  const fresh = '2026-11-18T12:05:00.000Z'
  const base = { package_id: 'p1', workspace_id: 'w1', status: 'rendering' }

  const chunks = [
    { ...base, id: 'exhausted', attempts: MAX_CHUNK_ATTEMPTS, updated_at: old },
    { ...base, id: 'retryable', attempts: 1, updated_at: old },
    { ...base, id: 'live', attempts: MAX_CHUNK_ATTEMPTS, updated_at: fresh },
  ]

  const after = Object.fromEntries(
    apply(chunks, staleReclaimRequests({ packageId: 'p1', workspaceId: 'w1', staleBefore }))
      .map((c) => [c.id, c.status]),
  )

  it('fails a dead piece that has used all its attempts, so the package can fail', () => {
    expect(after.exhausted).toBe('failed')
  })

  it('still reclaims a dead piece with attempts left', () => {
    expect(after.retryable).toBe('pending')
  })

  it('leaves a piece that is still rendering alone', () => {
    expect(after.live).toBe('rendering')
  })
})
