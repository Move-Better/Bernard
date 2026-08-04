import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  selectMissingOutputPlatforms,
  OUTPUT_PLATFORM_MAP,
} from '../../api/_lib/interviewOutputFanout.js'

// GUARD — the interview outputs → content_items fan-out must be RE-ENTRANT.
//
// The original gate was `select=id&limit=1` + `if (existsRows.length === 0)`:
// one-shot and all-or-nothing. Any output key that arrived in a later PATCH
// was dropped forever, silently. In prod that meant blogPost (present in the
// first completed PATCH) materialised 23/23 while emailNewsletter, googleAds,
// instagramAds, landingPage and youtubeScript each materialised 0/2 — ten
// finished pieces discarded with no error anywhere.
//
// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space into %20, which readFileSync ENOENTs.
const ROUTE = readFileSync(
  fileURLToPath(new URL('../../api/_routes/db/interviews.js', import.meta.url)),
  'utf8',
)

describe('selectMissingOutputPlatforms', () => {
  it('inserts a key that arrives when another platform already has a row', () => {
    // The exact prod shape: blog materialised at completion, emailNewsletter
    // appended afterwards. The old gate returned nothing here.
    const got = selectMissingOutputPlatforms(
      { blogPost: 'body', emailNewsletter: '---SUBJECT LINE--- hi' },
      ['blog'],
    )
    expect(got.map((e) => e.platform)).toEqual(['email'])
  })

  it('does not re-insert a platform that already exists (idempotent retry)', () => {
    const outputs = { blogPost: 'body', emailNewsletter: 'nl' }
    expect(selectMissingOutputPlatforms(outputs, ['blog', 'email'])).toEqual([])
  })

  it('is not blocked by content-plan atom platforms sharing the interview', () => {
    // instagram/facebook/linkedin/gbp come from content_plan_atoms and share
    // interview_id. Under the old any-row guard, an atom landing first
    // permanently blocked the keystone fan-out.
    const got = selectMissingOutputPlatforms({ blogPost: 'body' }, [
      'instagram', 'facebook', 'linkedin', 'gbp', 'instagram_story',
    ])
    expect(got.map((e) => e.platform)).toEqual(['blog'])
  })

  it('recovers every long-tail platform in one pass', () => {
    const got = selectMissingOutputPlatforms(
      {
        blogPost: 'b', emailNewsletter: 'n', googleAds: 'g',
        landingPage: 'l', youtubeScript: 'y', instagramAds: 'i',
      },
      ['blog'],
    )
    expect(got.map((e) => e.platform).sort()).toEqual(
      ['email', 'google_ads', 'instagram_ads', 'landing_page', 'youtube'],
    )
  })

  it('skips empty, whitespace-only and non-string values', () => {
    const got = selectMissingOutputPlatforms(
      { blogPost: '', emailNewsletter: '   ', googleAds: null, landingPage: 42, youtubeScript: 'real' },
      [],
    )
    expect(got.map((e) => e.platform)).toEqual(['youtube'])
  })

  it('tolerates null/garbage outputs and a null existing-platform list', () => {
    expect(selectMissingOutputPlatforms(null, null)).toEqual([])
    expect(selectMissingOutputPlatforms(undefined)).toEqual([])
    expect(selectMissingOutputPlatforms('nope', [])).toEqual([])
  })

  // NON-VACUITY — a discovery-driven guard that matches nothing passes
  // trivially forever. Pin the members so a rotted map can't go green empty.
  it('covers the six keystone output keys', () => {
    const keys = OUTPUT_PLATFORM_MAP.map((e) => e.key)
    expect(keys).toContain('emailNewsletter')
    expect(keys).toContain('blogPost')
    expect(OUTPUT_PLATFORM_MAP).toHaveLength(6)
    // The content-plan platforms must NOT be here or the Plan tab double-writes.
    const platforms = OUTPUT_PLATFORM_MAP.map((e) => e.platform)
    for (const p of ['instagram', 'facebook', 'linkedin', 'gbp', 'tiktok']) {
      expect(platforms).not.toContain(p)
    }
  })
})

describe('the route uses the shared rule', () => {
  // Without this, the route could keep its own inline copy and every test
  // above would pass against a function nothing calls.
  it('imports and calls selectMissingOutputPlatforms', () => {
    expect(ROUTE).toMatch(/from '\.\.\/\.\.\/_lib\/interviewOutputFanout\.js'/)
    expect(ROUTE).toMatch(/selectMissingOutputPlatforms\(/)
  })

  it('selects platform (not id&limit=1) so the guard can be per-platform', () => {
    expect(ROUTE).toMatch(/content_items\?interview_id=eq\.\$\{id\}&\$\{wsFilter\}&select=platform/)
    expect(ROUTE).not.toMatch(/content_items\?interview_id=eq\.\$\{id\}&\$\{wsFilter\}&select=id&limit=1/)
  })

  it('no longer gates the whole batch on any-row-exists', () => {
    expect(ROUTE).not.toMatch(/if \(existsRows\.length === 0\)/)
  })
})
