import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { aspectVariantLabel, isAspectVariantChannel } from '../../api/_lib/aspectVariants.js'

// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space, which readFileSync ENOENTs.
const SRC = readFileSync(fileURLToPath(new URL('../../api/_lib/aspectVariants.js', import.meta.url)), 'utf8')

describe('aspectVariantLabel — the idempotency key', () => {
  it('labels the 4:5 carousel channel', () => {
    expect(aspectVariantLabel('instagram_carousel_video')).toBe('4:5 carousel')
  })

  it('returns null for a channel that is not an aspect variant', () => {
    // instagram_reel is the PRIMARY render, not a variant of anything — giving
    // it a label would make the reel a child of itself.
    expect(aspectVariantLabel('instagram_reel')).toBeNull()
    expect(aspectVariantLabel('youtube')).toBeNull()
    expect(aspectVariantLabel(undefined)).toBeNull()
  })

  it('isAspectVariantChannel agrees with the label map', () => {
    expect(isAspectVariantChannel('instagram_carousel_video')).toBe(true)
    expect(isAspectVariantChannel('instagram_reel')).toBe(false)
  })

  it('the label is a FRAME, not a channel id — it is shown to humans', () => {
    // MediaDetail renders variant_label under the master, so '4:5 carousel'
    // reads correctly where 'instagram_carousel_video' would not.
    expect(aspectVariantLabel('instagram_carousel_video')).not.toMatch(/_/)
  })
})

describe('aspectVariants — invariants enforced by reading the source', () => {
  it('never indexes a variant into visual memory', () => {
    // An aspect variant is the SAME content in a different frame. clipSearch has
    // no parent_id/variant_label filter, so indexing one would surface the master
    // and the variant as two competing suggestions for the same shot. saveBroll
    // indexes because a b-roll clip is genuinely new content; this must not.
    expect(SRC).not.toContain('indexMediaAsset')
    expect(SRC).not.toContain('visualMemoryIndex')
  })

  it('generates a poster frame (the video-insert invariant)', () => {
    // Enforced independently by tests/lib/videoThumbnailCoverage, which greps
    // every media_assets video insert. Asserted here too so the reason travels
    // with the module: a video row with a null thumbnail_url is a blank box in
    // the Library grid, the picker, and the editor tile.
    expect(SRC).toContain('generateAndPersistThumbnail(')
  })

  it('stores the variant as a parent_id child, never a sibling library row', () => {
    // MediaHub passes sources:true (parent_id=is.null), so a child NEVER gets
    // its own Library tile — this is what keeps "one master per upload" true.
    expect(SRC).toContain('parent_id:')
    expect(SRC).toContain('variant_label:')
  })

  it('scopes every query by workspace_id', () => {
    // Cross-tenant isolation is enforced at the API layer here; a variant lookup
    // that forgot the filter would read another tenant's media.
    //
    // Collapse `…` + `…` concatenation FIRST. A query built across several
    // template-literal segments is invisible to a regex that stops at the first
    // backtick — which is how this assertion first "failed" on a query that was
    // correctly scoped all along (CLAUDE.md: a single-line grep cannot see a
    // multi-line call).
    const collapsed = SRC.replace(/`\s*\+\s*\n?\s*`/g, '')
    const queries = collapsed.match(/media_assets\?[^`]*/g) || []
    expect(queries.length).toBeGreaterThan(0)
    for (const q of queries) expect(q).toContain('workspace_id=eq.')
  })

  it('replaces a prior variant instead of accumulating duplicates', () => {
    // Re-cropping should REPLACE the 4:5 bake, not leave a graveyard of stale
    // ones behind (each is a full mp4 in blob storage).
    expect(SRC).toContain('findAspectVariant(')
    expect(SRC).toMatch(/method:\s*'PATCH'/)
  })
})
