import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const ROUTE = read('../../api/_routes/db/content.js')
const AUTO = read('../../api/_lib/autoAttachMedia.js')
import { classifyMediaChange } from '../../api/_lib/mediaOverride.js'

// Calls the REAL classifier. These assertions previously re-implemented the
// rule locally, and mutation testing proved that hollow: breaking the route's
// copy left every one of them green.
const isOverride = (before, after) => classifyMediaChange(before, after) === 'human'

const A = { mediaAssetId: 'a', url: 'https://x/a.jpg' }
const B = { mediaAssetId: 'b', url: 'https://x/b.jpg' }
const C = { mediaAssetId: 'c', url: 'https://x/c.mp4' }

describe('what counts as a media override', () => {
  it('replacing an existing photo IS an override', () => {
    expect(isOverride([A], [B])).toBe(true)
  })

  it('a FIRST attach onto empty media is NOT — nobody was overridden', () => {
    // Bernard's auto-attach and a human's first pick both look like this. The
    // panel's denominator counts Bernard's picks; this is not a correction.
    expect(isOverride([], [A])).toBe(false)
  })

  it('REORDERING slides is not a swap', () => {
    // The metric claims "you swapped the photo on N of M". Counting a reorder
    // would inflate it every time someone rearranges a carousel.
    expect(isOverride([A, B, C], [C, A, B])).toBe(false)
  })

  it('a no-op re-save is not an override', () => {
    // Autosave round-trips re-send the same array constantly; counting these
    // would make the rate climb just from opening an editor.
    expect(isOverride([A, B], [A, B])).toBe(false)
  })

  it('enriching an entry IN PLACE is not an override', () => {
    // Attaching a 4:5 carousel variant rewrites the entry but keeps the asset.
    // Same choice, so it must not read as the human rejecting Bernard's pick.
    const fitted = { ...C, carouselVariant: { url: 'https://x/c-45.mp4' } }
    expect(isOverride([A, C], [A, fitted])).toBe(false)
  })

  it('adding a second photo to a single-photo post IS an override', () => {
    // Deliberate: the human changed what ships. A carousel built on top of
    // Bernard's single pick is a correction of that pick's sufficiency.
    expect(isOverride([A], [A, B])).toBe(true)
  })

  it('clearing media is an override', () => {
    expect(isOverride([A], [])).toBe(true)
  })
})

describe('provenance is server-derived, never client-supplied', () => {
  it('the route stamps media_source from its own classification', () => {
    expect(ROUTE).toContain('media_source:           mediaOverride')
  })

  it('media_source is NOT read from the request body anywhere', () => {
    // The whole signal is worthless if a caller can assert it — and the
    // editor's auto-attach and a human swap are indistinguishable to the
    // client, so a caller flag would be wrong in both directions.
    expect(ROUTE).not.toMatch(/patch\.mediaSource/)
    expect(ROUTE).not.toMatch(/media_source:\s*patch\./)
  })

  it('the route delegates to the shared classifier, not a local copy', () => {
    // A second implementation is how the behavioural tests above went hollow
    // the first time. One function, both callers.
    expect(ROUTE).toContain('classifyMediaChange(before, patch.mediaUrls)')
    expect(ROUTE).not.toContain('const setOf =')
  })

  it('auto-attach stamps bernard, giving the rate its denominator', () => {
    expect(AUTO).toContain("media_source: 'bernard'")
  })
})
