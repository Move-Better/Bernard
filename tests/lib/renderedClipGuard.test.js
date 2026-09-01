import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { isRenderedClip } from '../../api/_lib/renderedClipGuard.js'
import { selectReelCandidates } from '../../api/_lib/reelFactory.js'

// GUARD — the double-karaoke bug (feedback e292bc09 / a7a3361d, 2026-08-31).
//
// A caption-baked reel (source='moments', parent_asset_id set) was being
// re-segmented and re-rendered, baking a SECOND karaoke track over the first.
// Confirmed live: both reported pieces trace raw → reel#1(moments) →
// reel#2(moments). The fix is one shared predicate — isRenderedClip — applied at
// every entry point that turns a source into clips: find-clips, repurpose-video
// (create segments) and render-segments, reelFactory (render segments).

describe('isRenderedClip', () => {
  it('is TRUE for a derived output (parent_asset_id set) — a reel/clip/aspect-variant', () => {
    // Every render/clip path sets parent_asset_id to its source.
    expect(isRenderedClip({ id: 'reel-1', parent_asset_id: 'raw-1' })).toBe(true)
  })

  it('is FALSE for a raw source (parent_asset_id null) — upload/capture/local-import', () => {
    expect(isRenderedClip({ id: 'raw-1', parent_asset_id: null })).toBe(false)
  })

  it('is FALSE when parent_asset_id is absent entirely', () => {
    // A source row that simply never carried the field is treated as raw, not
    // rejected — the callers reject a genuinely-missing asset separately.
    expect(isRenderedClip({ id: 'raw-1', kind: 'video' })).toBe(false)
  })

  it('is FALSE (not a throw) for null / undefined — degrades safely', () => {
    expect(isRenderedClip(null)).toBe(false)
    expect(isRenderedClip(undefined)).toBe(false)
  })

  it('returns a real boolean, never the id string it keys on', () => {
    // Boolean() coercion, not the raw parent_asset_id value leaking through.
    expect(isRenderedClip({ parent_asset_id: 'raw-1' })).toStrictEqual(true)
    expect(isRenderedClip({ parent_asset_id: '' })).toBe(false)
  })
})

// Behavioural test of the belt-and-suspenders in reelFactory.selectReelCandidates.
// This is the guard that protects the segments ALREADY in the queue (6 live on
// movebetter at report time) from auto-rendering into double-baked reels. Mock
// only the network layer; exercise the real candidate loop.
const hoisted = vi.hoisted(() => ({ candidateRows: [] }))
vi.mock('../../api/_lib/supabaseRest.js', () => ({
  supabaseRest: vi.fn(async (path) => {
    if (path.startsWith('content_plan_atoms')) return { ok: true, json: async () => [] }
    if (path.startsWith('video_segments')) return { ok: true, json: async () => hoisted.candidateRows }
    return { ok: true, json: async () => [] }
  }),
}))

// A valid, renderable moment. speaker_voice is pre-set so ensureVoiceLabels is a
// no-op (the classifier is never invoked in this test).
const seg = (id, sourceParent) => ({
  id,
  source_asset_id: `src-${id}`,
  staff_id: null,
  start_sec: 0,
  end_sec: 20,
  hook: 'A hook',
  transcript_excerpt: 'x',
  score: 90,
  speaker_voice: 'clinician',
  speaker_voice_confidence: 0.9,
  source_asset: {
    id: `src-${id}`,
    kind: 'video',
    blob_url: `https://blob.example/${id}.mp4`,
    filename: `${id}.mp4`,
    archived_at: null,
    consent_status: 'granted',
    transcript_words: null,
    size_bytes: 1000,
    render_proxy_url: null,
    parent_asset_id: sourceParent, // null = raw source; set = a rendered clip
  },
})

describe('selectReelCandidates — belt-and-suspenders against re-rendering baked reels', () => {
  it('excludes a segment whose source is itself a rendered clip, keeps the raw-source one', async () => {
    hoisted.candidateRows = [
      seg('clean', null), // raw source → eligible
      seg('baked', 'raw-parent-1'), // source is a rendered clip → must be skipped
    ]
    const picked = await selectReelCandidates({ ws: { id: 'ws-1' }, limit: 5 })
    const ids = picked.map((s) => s.id)
    expect(ids).toContain('clean')
    expect(ids).not.toContain('baked')
  })

  it('excludes it even when it is the ONLY candidate (so nothing double-bakes)', async () => {
    hoisted.candidateRows = [seg('baked', 'raw-parent-1')]
    const picked = await selectReelCandidates({ ws: { id: 'ws-1' }, limit: 5 })
    expect(picked).toHaveLength(0)
  })
})

// Source-coverage guard: every entry point that creates or renders clips from a
// source asset must (a) SELECT parent_asset_id and (b) consult isRenderedClip.
// Adding a new clip entry point without the guard reopens the double-bake loop,
// and this file is the only thing that would catch that.
describe('every clip entry point selects parent_asset_id and applies the guard', () => {
  const files = [
    'api/_routes/editorial/find-clips.js',
    'api/editorial/repurpose-video.js',
    'api/editorial/render-segments.js',
    'api/_lib/reelFactory.js',
  ]

  it('pins exactly the four known entry points (non-vacuity)', () => {
    expect(files).toHaveLength(4)
  })

  for (const rel of files) {
    it(`${rel} selects parent_asset_id and calls isRenderedClip`, () => {
      const src = readFileSync(fileURLToPath(new URL('../../' + rel, import.meta.url)), 'utf8')
      // The field must be pulled in a PostgREST select, or the guard reads
      // undefined and silently passes everything.
      expect(src).toMatch(/parent_asset_id/)
      // The guard must actually be called — a mere import is not enough.
      expect(src).toMatch(/isRenderedClip\(/)
    })
  }
})
