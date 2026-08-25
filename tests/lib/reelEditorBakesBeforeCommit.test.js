import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — the embedded reel editor must bake the CURRENT edit into media_urls
// BEFORE Approve / Send-for-review / Schedule / Publish / Retry, or those
// actions ship the untouched auto-reel and the scheduled post's trim/caption
// style won't match what the operator saw (feedback f46a0eec — Philip A.).
//
// This is a SOURCE guard, not a render test (the suite has no jsdom/RTL). The
// regression it pins is the one most likely to return silently: a future edit
// wiring a commit button straight to wf.approve / wf.publish again, bypassing
// the onBeforeCommit bake. Each assertion first proves its needle exists
// (non-vacuous) so a rename can't make the guard pass by matching nothing.
//
// Watched-it-fail: reverting the Approve onClick to `onClick={wf.approve}`,
// the Retry to `wf.publish({})`, or dropping onBeforeCommit from VideoEditor
// each reddens exactly one case below.

const barSrc = readFileSync(
  fileURLToPath(new URL('../../src/components/editor/EditorWorkflowBar.jsx', import.meta.url)),
  'utf8',
)
const editorSrc = readFileSync(
  fileURLToPath(new URL('../../src/pages/VideoEditor.jsx', import.meta.url)),
  'utf8',
)
const hookSrc = readFileSync(
  fileURLToPath(new URL('../../src/lib/useContentWorkflow.js', import.meta.url)),
  'utf8',
)

const count = (src, re) => (src.match(re) || []).length

describe('reel editor bakes before every commit (EditorWorkflowBar)', () => {
  it('accepts an onBeforeCommit hook and runs it inside runCommit', () => {
    // piece + onBeforeCommit are required first; trailing props (renderingReel)
    // are allowed.
    expect(barSrc).toMatch(/function EditorWorkflowBar\(\{\s*piece,\s*onBeforeCommit\b[^}]*\}\)/)
    // runCommit is the single chokepoint that awaits the bake before the action.
    expect(barSrc).toMatch(/const runCommit = async \(action\) =>/)
    expect(barSrc).toMatch(/onBeforeCommit \? await onBeforeCommit\(\)/)
  })

  it('surfaces a rendering status while the reel bakes (not a bare spinner)', () => {
    // The bake is a ~1-minute inline render; a bare spinner on Approve/Schedule
    // reads as a hung button (feedback 2cc4a9e3). The bar takes a renderingReel
    // signal and shows a visible "rendering…" status while it is true.
    expect(barSrc).toMatch(/renderingReel\s*=\s*false\s*\}/)
    expect(barSrc).toMatch(/\{renderingReel && \(/)
    expect(barSrc).toMatch(/Rendering your video/)
  })

  it('routes Approve and Send-for-review through the bake, never a bare wf.*', () => {
    // The only wf.approve / wf.sendForReview call sites are inside runCommit.
    expect(count(barSrc, /wf\.approve\b/g)).toBe(1)
    expect(barSrc).toContain('runCommit(() => wf.approve())')
    expect(count(barSrc, /wf\.sendForReview\b/g)).toBe(1)
    expect(barSrc).toContain('runCommit(() => wf.sendForReview())')
    // A bare onClick={wf.approve} (the pre-fix footgun) must not reappear.
    expect(barSrc).not.toMatch(/onClick=\{wf\.approve\}/)
    expect(barSrc).not.toMatch(/onClick=\{wf\.sendForReview\}/)
  })

  it('has exactly ONE wf.publish call — the commit-wrapped publisher', () => {
    // Every Schedule / Queue / Publish-now / Retry button must go through the
    // `publish` wrapper (which bakes first), so wf.publish appears once total.
    expect(count(barSrc, /wf\.publish\(/g)).toBe(1)
    expect(barSrc).toMatch(/const publish = \(opts = \{\}\) =>\s*\n?\s*runCommit\(\(baked\) => wf\.publish\(/)
    // The wrapper threads the freshly-baked media into the dispatch.
    expect(barSrc).toContain('mediaUrlsOverride: baked || undefined')
  })
})

describe('VideoEditor wires the bake to the embedded workflow bar', () => {
  it('passes bakeVideoIfDirty as onBeforeCommit and wires the rendering signal', () => {
    expect(editorSrc).toContain('onBeforeCommit={bakeVideoIfDirty}')
    // The bar's rendering status is driven by the actual render-in-flight state.
    expect(editorSrc).toContain('renderingReel={saveVideoToPiece.isPending}')
  })

  it('bakeVideoIfDirty re-renders only when the edit is unbaked', () => {
    // The bake guards on videoEditDirty so a redundant Save→Approve doesn't
    // re-render.
    expect(editorSrc).toMatch(/if \(!embedded \|\| !piece\?\.id \|\| !videoEditDirty\) return null/)
    // Dirty is clean when the current draft matches EITHER the doc baked this
    // session (lastBakedDoc) OR the stamp the last bake wrote onto the media
    // entry (isVideoEditUnbaked — the SAME predicate the /week server dispatch
    // uses, so the editor and the server can't disagree about whether a reel
    // still needs baking). An untouched auto-reel carries no stamp, so it stays
    // dirty and its first commit still bakes.
    expect(editorSrc).toMatch(/JSON\.stringify\(draftDoc\) === lastBakedDoc/)
    expect(editorSrc).toMatch(/return isVideoEditUnbaked\(pieceVideoEntry, draftDoc\)/)
  })

  it('the bake returns the fresh media_urls it persisted', () => {
    // saveVideoToPiece resolves to [baked] so the same-click override can
    // dispatch it (the parent piece query can't have refetched yet).
    expect(editorSrc).toMatch(/return \[baked\]/)
  })
})

describe('useContentWorkflow.publish honors the media override', () => {
  it('dispatches mediaUrlsOverride when provided, else the piece media', () => {
    expect(hookSrc).toMatch(/mediaUrlsOverride \} = \{\} \) =>|mediaUrlsOverride \}/)
    // The dispatched piece carries the override media, closing the same-click
    // edit→schedule stale-reel race.
    expect(hookSrc).toContain('mediaUrlsOverride ? { ...piece, media_urls: mediaUrlsOverride } : piece')
    // The soft media gate measures the effective (possibly overridden) media.
    expect(hookSrc).toContain('const effectiveMediaUrls = mediaUrlsOverride || piece.media_urls')
  })
})
