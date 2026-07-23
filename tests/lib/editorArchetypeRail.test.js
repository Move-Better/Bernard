import { describe, it, expect } from 'vitest'
import { ARCHETYPES, railFor, resolveArchetype } from '@/lib/editorArchetype'
import { RAIL_META } from '@/components/editor/railSections'

// GUARD — the archetype↔rail contract.
//
// UnifiedEditor builds its icon rail with `railFor(piece).filter(k =>
// RAIL_META[k] ? … : false)`. A rail key with no RAIL_META entry is dropped
// SILENTLY: no throw, no console warning, no lint error, a green build — the tab
// just never renders. That silent drop has shipped four separate times:
//
//   #2109/#2115  doc      'seo'       → blog posts had no SEO panel
//   #2114        email    'email'     → email pieces couldn't edit their body
//   #2126        ad       'variants'  → config claimed a tab that never existed
//   this one     vvideo/  'caption'   → EVERY Reel/TikTok/Short/YouTube draft
//                lvideo                 had no way to edit its caption
//
// Each was found by a user, not by a test. These assertions are the fourth
// fix's real deliverable: adding a rail key an archetype can't render now fails
// here instead of in production.

describe('archetype rail keys ↔ UnifiedEditor RAIL_META', () => {
  const entries = Object.entries(ARCHETYPES)

  it('has archetypes to check', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it.each(entries)('%s declares only rail keys that have a real panel', (name, cfg) => {
    expect(Array.isArray(cfg.rail)).toBe(true)
    const orphans = cfg.rail.filter((k) => !RAIL_META[k])
    // If this fails: either add a `${key}` entry to src/components/editor/
    // railSections.js AND a matching branch in UnifiedEditor's inspector, or
    // drop the key from the archetype. Do NOT just delete the assertion — a
    // dropped key means a tab the user can never reach.
    expect(orphans, `${name} declares rail key(s) with no RAIL_META entry`).toEqual([])
  })

  it('every archetype can edit its own words/caption', () => {
    // The caption/body is the one thing EVERY archetype must be able to edit —
    // it is the post. `words` is the single key for it (email and blog reuse
    // the same WordsPanel with different labels); `caption`/`email`/`body` are
    // the near-miss spellings that caused two of the four regressions above.
    for (const [name, cfg] of entries) {
      expect(cfg.rail, `${name} has no words section`).toContain('words')
    }
  })

  it('resolves an Instagram video piece to a rail that includes Words', () => {
    // The exact shape from the bug report: a platform='instagram' draft with one
    // video attached resolves to 'vvideo' and routes to UnifiedEditor.
    const piece = {
      platform: 'instagram',
      media_urls: [{ url: 'https://example.com/clip.mp4', type: 'video' }],
    }
    expect(resolveArchetype(piece)).toBe('vvideo')
    expect(railFor(piece)).toContain('words')
  })

  it('keeps a photo Instagram piece on the carousel archetype', () => {
    // Guards the refinement itself — 'vvideo' must be video-gated, or every
    // photo post would route away from SlideEditor.
    const piece = {
      platform: 'instagram',
      media_urls: [{ url: 'https://example.com/a.jpg', type: 'image' }],
    }
    expect(resolveArchetype(piece)).toBe('carousel')
  })
})
