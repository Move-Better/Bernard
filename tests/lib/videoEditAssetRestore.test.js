// Reopening a clip in the VideoEditor within the cache window must restore the
// NEWEST saved edit, not the copy cached at the previous open (2026-11-18 full
// audit, item 11). The editor restores once, from asset.video_edit_draft, and
// then autosaves, so a stale restore writes the old edit back over the new one.
//
// Part 1 drives the real query options + readiness gate through react-query's
// QueryObserver (the engine behind useQuery) against a QueryClient built with
// the app's defaults and a cache seeded at the previous open.
// Part 2 pins that VideoEditor's one-shot restore effect waits on that gate.
//
// The render-level check (the real <VideoEditor> under jsdom) is
// tests/pages/videoEditorDraftRestore.test.jsx; the source guard below stays as a
// cheap second net.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { QueryClient, QueryObserver } from '@tanstack/react-query'

const ASSET_ID = '9b2f1c3e-4d5a-4b6c-8d7e-0f1a2b3c4d5e'
const OLD_DRAFT = { startSec: 1.5, endSec: 4 } // what the previous open saw
const NEW_DRAFT = { startSec: 7.25, endSec: 12 } // autosaved after that

vi.mock('@/lib/mediaLib', () => ({
  getMediaAsset: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 5))
    return { id: ASSET_ID, video_edit_draft: NEW_DRAFT }
  }),
}))

const { videoEditAssetQuery, isDraftReady } = await import('../../src/lib/videoEditAsset.js')

// Same query defaults as src/App.jsx's QueryClient (staleTime 30s, gcTime 5min).
function appClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 5 * 60_000, refetchOnWindowFocus: false } } })
}

// Mount an observer (what useQuery does) and resolve with the first result the
// editor would restore from: the first one isDraftReady() accepts.
function firstRestorable(client) {
  const observer = new QueryObserver(client, videoEditAssetQuery(ASSET_ID))
  const initial = observer.getOptimisticResult(observer.options)
  if (isDraftReady(initial)) return Promise.resolve(initial)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsub(); reject(new Error('never became restorable')) }, 1000)
    const unsub = observer.subscribe((r) => {
      if (isDraftReady(r)) { clearTimeout(timer); unsub(); resolve(r) }
    })
  })
}

describe('VideoEditor draft restore on reopen', () => {
  it('restores the newer server draft when the cache still holds the previous open', async () => {
    const client = appClient()
    // The previous open left a FRESH (well inside staleTime) cache entry.
    client.setQueryData(['media-asset', ASSET_ID, 'src'], { id: ASSET_ID, video_edit_draft: OLD_DRAFT })
    const r = await firstRestorable(client)
    expect(r.data.video_edit_draft).toEqual(NEW_DRAFT)
  })

  it('isDraftReady rejects cached data not fetched since mount, accepts it after', () => {
    expect(isDraftReady({ data: { id: 'a' }, isFetchedAfterMount: false })).toBe(false)
    expect(isDraftReady({ data: undefined, isFetchedAfterMount: true })).toBe(false)
    expect(isDraftReady({ data: { id: 'a' }, isFetchedAfterMount: true })).toBe(true)
  })
})

describe('VideoEditor wiring', () => {
  const src = readFileSync(new URL('../../src/pages/VideoEditor.jsx', import.meta.url), 'utf8')

  it('reads the source asset through videoEditAssetQuery', () => {
    expect(src.match(/useQuery\(videoEditAssetQuery\(assetId\)\)/g) || []).toHaveLength(1)
    expect(src).toMatch(/const draftReady = isDraftReady\(assetQuery\)/)
  })

  it('gates the one-shot draft restore on draftReady', () => {
    const claim = src.indexOf('restoredRef.current = true')
    expect(claim).toBeGreaterThan(0)
    // The early-return guard is the last `if (...) return` before the claim.
    const guardAt = src.lastIndexOf('if (', claim)
    const guard = src.slice(guardAt, src.indexOf('\n', guardAt))
    expect(guard).toMatch(/!draftReady\b/)
    expect(guard).toMatch(/restoredRef\.current\) return$/)
  })
})
