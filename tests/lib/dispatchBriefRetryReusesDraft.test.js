// A failed brief dispatch followed by a retry must leave ONE content_items
// row, not two. dispatchBrief created a fresh draft on every attempt, so each
// failed publish left an orphan draft behind (audit 2026-11-18, P2; Q chose
// "reuse the draft", 2026-11-19). The error now carries the row
// (e.retryItem) and the retry passes it back.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const apiFetch = vi.fn()
vi.mock('@/lib/api', () => ({ apiFetch: (...a) => apiFetch(...a) }))
const { dispatchBrief } = await import('@/lib/publish')

let rows
let publishFails
beforeEach(() => {
  rows = new Map()
  publishFails = 1
  let n = 0
  apiFetch.mockImplementation(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    if (url === '/api/db/content' && init.method === 'POST') {
      const row = { id: `ci-${++n}`, ...body[0] }
      rows.set(row.id, row)
      return [row]
    }
    if (url.startsWith('/api/db/content?id=') && init.method === 'PATCH') {
      const id = decodeURIComponent(url.split('id=')[1])
      const row = rows.get(id)
      if (!row) throw Object.assign(new Error('Not found'), { status: 404 })
      Object.assign(row, { content: body.content })
      return row
    }
    if (url === '/api/publish/social') {
      if (publishFails-- > 0) throw Object.assign(new Error('bundle_post_failed'), { status: 502 })
      return { success: true, postId: 'p1' }
    }
    throw new Error(`unexpected ${init.method} ${url}`)
  })
})

const args = {
  brief: { id: 'b1', target_platform: 'linkedin' },
  asset: { blob_url: 'https://x/v.mp4', kind: 'video' },
  composedContent: 'hello',
  scheduledAt: null,
}

describe('dispatchBrief retry', () => {
  it('a failed dispatch then a retry creates one content_items row', async () => {
    const err = await dispatchBrief(args).catch((e) => e)
    expect(err.retryItem).toEqual({ id: 'ci-1', platform: 'linkedin' })
    const { item } = await dispatchBrief({ ...args, composedContent: 'hello again', retryItem: err.retryItem })
    expect(item.id).toBe('ci-1')
    expect(rows.size).toBe(1)
    expect(rows.get('ci-1').content).toBe('hello again')
  })

  it('creates a new row when the platform changed (platform is not PATCHable)', async () => {
    const err = await dispatchBrief(args).catch((e) => e)
    await dispatchBrief({ ...args, brief: { ...args.brief, target_platform: 'facebook' }, retryItem: err.retryItem })
    expect(rows.size).toBe(2)
  })

  it('creates a new row when the old draft was deleted', async () => {
    const err = await dispatchBrief(args).catch((e) => e)
    rows.clear()
    const { item } = await dispatchBrief({ ...args, retryItem: err.retryItem })
    expect(rows.size).toBe(1)
    expect(item.id).not.toBe('ci-1')
  })
})

// The modal is the only caller: it must keep the row from the error and hand
// it back on the next attempt, or the library change does nothing.
describe('ContentBriefDetail wires the retry', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/components/ContentBriefDetail.jsx', import.meta.url)), 'utf8')
  it('stores e.retryItem on failure and passes retryItem to dispatchBrief', () => {
    expect(src).toMatch(/if \(e\?\.retryItem\) setRetryItem\(e\.retryItem\)/)
    const call = src.slice(src.indexOf('dispatchBrief({'), src.indexOf('}),', src.indexOf('dispatchBrief({')))
    expect(call).toMatch(/\bretryItem,/)
  })
})
