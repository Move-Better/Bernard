import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — /week's inline Approve must not dispatch a video piece whose editor
// draft was never baked into media_urls, and must not "fall back to the client"
// when it declines. The client fallback (publishPieceToSocial) sends the SAME
// stored media_urls, so routing a stale reel through it publishes exactly the
// pre-edit render the server just refused to send — a fix that looks like a fix
// and changes nothing. The remedy is the VideoEditor, which owns the only bake.
//
// The decision itself is behaviourally tested in videoEditFingerprint.test.js;
// this pins the WIRING that decision depends on, which no unit test can see.
// Each assertion proves its needle exists so a rename can't pass by matching
// nothing.
//
// Watched-it-fail (mutation, one at a time):
//   - move the gate below `const claim = await claimDispatch`  → ordering fails
//   - add fallback:'client' to the decline                     → no-fallback fails
//   - drop needs_video_bake from approve.js's response         → passthrough fails
//   - reorder YourWeek's branch below the fallback branch      → branch-order fails
//   - drop the stamp from VideoEditor's baked entry            → stamp fails

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

const dispatchSrc = read('../../api/_lib/dispatchContentItem.js')
const approveSrc = read('../../api/_routes/content-plan/approve.js')
const weekSrc = read('../../src/pages/YourWeek.jsx')
const editorSrc = read('../../src/pages/VideoEditor.jsx')

describe('dispatchContentItem defers an unbaked video edit', () => {
  it('consults the shared detector rather than re-deriving the rule', () => {
    // One copy of "is this baked?", shared with the client that writes the
    // stamp — the client/server mirror-pair hazard this whole feature is about.
    expect(dispatchSrc).toContain("from '../../src/lib/videoEditFingerprint.js'")
    expect(dispatchSrc).toMatch(/videoEditTarget\s*\(\s*piece\s*,\s*resolveArchetype\(piece\)\s*\)/)
    expect(dispatchSrc).toContain('isVideoEditUnbaked(')
  })

  it('runs the gate BEFORE the dispatch claim, so a decline takes no side effects', () => {
    const gate = dispatchSrc.indexOf('await hasUnbakedVideoEdit(')
    const claim = dispatchSrc.indexOf('await claimDispatch(')
    expect(gate).toBeGreaterThan(-1)
    expect(claim).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(claim)
  })

  it('declines with needs_video_bake and NOT with a client fallback', () => {
    expect(dispatchSrc).toContain('return { dispatched: false, needs_video_bake: true }')
    // The decline must never carry fallback:'client' — see the header above.
    const decline = dispatchSrc.match(/return \{[^}]*needs_video_bake[^}]*\}/)?.[0] || ''
    expect(decline).not.toContain('fallback')
  })

  it('validates the asset id before it reaches a PostgREST filter', () => {
    // media_urls is client-written JSON, so mediaAssetId is untrusted input on
    // its way into `media_assets?id=eq.<...>`.
    expect(dispatchSrc).toMatch(/UUID_RE\.test\(String\(target\.assetId\)\)/)
    expect(dispatchSrc).toContain('workspace_id=eq.${ws.id}&select=video_edit_draft')
  })

  it('fails OPEN when the draft read errors', () => {
    // A Supabase blip must not strand every reel approval in "open the editor",
    // which is indistinguishable from the feature being broken.
    const fn = dispatchSrc.slice(dispatchSrc.indexOf('async function hasUnbakedVideoEdit'))
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/catch \(e\) \{[\s\S]*return false/)
  })
})

describe('approve.js surfaces the deferral to the client', () => {
  it('passes needs_video_bake through', () => {
    expect(approveSrc).toContain('...(dispatch?.needs_video_bake ? { needs_video_bake: true } : {})')
  })
})

describe('YourWeek routes a deferred video piece to its editor', () => {
  it('handles needs_video_bake BEFORE the client-fallback branch', () => {
    const videoBranch = weekSrc.indexOf('resp?.needs_video_bake')
    const fallbackBranch = weekSrc.indexOf("resp?.fallback === 'client'")
    expect(videoBranch).toBeGreaterThan(-1)
    expect(fallbackBranch).toBeGreaterThan(-1)
    expect(videoBranch).toBeLessThan(fallbackBranch)
  })

  it('navigates to the publish route instead of publishing', () => {
    const branch = weekSrc.slice(
      weekSrc.indexOf('resp?.needs_video_bake'),
      weekSrc.indexOf("resp?.fallback === 'client'"),
    )
    expect(branch).toContain('navigate(`/publish/${item.contentPieceId}`)')
    // Publishing from this branch is the exact bug — it would ship the stale
    // render. Matched as a CALL, not as the bare word: the branch's own comment
    // names the hazard, and a guard that a prose mention can trip is a guard
    // that gets loosened rather than heeded.
    expect(branch).not.toMatch(/publishPieceToSocial\s*\(/)
  })
})

describe('VideoEditor stamps what it baked', () => {
  it('writes the fingerprint onto the baked media entry', () => {
    expect(editorSrc).toContain("from '@/lib/videoEditFingerprint'")
    expect(editorSrc).toMatch(/const bakedPrint = videoEditFingerprint\(bakedSnapshot\)/)
    expect(editorSrc).toMatch(/\.\.\.\(bakedPrint \? \{ \[VIDEO_EDIT_HASH_KEY\]: bakedPrint \} : \{\}\)/)
  })

  it('flushes the stamped draft to the asset so the stamp has something to match', () => {
    // Without this the 1500ms autosave debounce can leave the server holding the
    // PREVIOUS draft, so a just-baked reel compares as pending and defers.
    expect(editorSrc).toMatch(/updateMediaAsset\(assetId, \{ videoEditDraft: bakedSnapshot \}\)/)
  })
})
