import { describe, it, expect, vi, beforeEach } from 'vitest'

// GUARD — runReelRender's terminal-write contract: the async reel-bake worker
// MUST always flip the clip_render_jobs row to a terminal status, and it must
// carry the right payload, or the editor's commit poll hangs until its 6-min cap
// (a stale-looking "rendering… ~1 min" button that never resolves).
//
// Each assertion is a link in the chain that closes the long/hi-res reel 504:
//   orchestrator creates a 'rendering' job
//     -> worker calls runReelRender on a fresh budget
//     -> runReelRender renders (shared renderClipCore) and writes the terminal
//        status onto the job row   <-- pinned here
//     -> client polls the job -> reads 'ready' + blobUrl -> finalizes media_urls
//
// Drop any terminal write and the reel bake silently never completes.

// Capture every supabaseRest call so we can assert what was written.
const sbCalls = []
vi.mock('../../api/_lib/supabaseRest.js', () => ({
  supabaseRest: vi.fn(async (path, init = {}) => {
    sbCalls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    // PATCH uses prefer=return=representation; return one row so the guarded
    // terminal write reports "landed".
    return { ok: true, json: async () => [{ id: 'job-1' }], text: async () => '' }
  }),
}))

let workspaceImpl = async () => ({ id: 'ws-1' })
vi.mock('../../api/_lib/workspaceContext.js', () => ({
  workspaceById: vi.fn((id) => workspaceImpl(id)),
}))

let resolveImpl = async () => ({ ok: true, asset: { id: 'a-1' }, params: { isVideo: true, durationSec: 12 } })
let renderImpl = async () => ({ renders: [{ blobUrl: 'https://blob.example/reel.mp4', width: 1080, height: 1920, sizeBytes: 4242, hadSubtitles: true }], errors: [] })
vi.mock('../../api/_lib/renderClipCore.js', () => ({
  resolveClipRender: vi.fn((args) => resolveImpl(args)),
  runClipRender: vi.fn((args) => renderImpl(args)),
}))

const { runReelRender } = await import('../../api/_lib/clipRenderJobEngine.js')

// The single terminal PATCH runReelRender issued (there is exactly one per run).
function terminalPatch() {
  const patches = sbCalls.filter((c) => c.method === 'PATCH')
  expect(patches).toHaveLength(1)  // non-vacuity: a terminal write actually happened
  return patches[0]
}

beforeEach(() => {
  sbCalls.length = 0
  workspaceImpl = async () => ({ id: 'ws-1' })
  resolveImpl = async () => ({ ok: true, asset: { id: 'a-1' }, params: { isVideo: true, durationSec: 12 } })
  renderImpl = async () => ({ renders: [{ blobUrl: 'https://blob.example/reel.mp4', width: 1080, height: 1920, sizeBytes: 4242, hadSubtitles: true }], errors: [] })
})

describe('runReelRender terminal write', () => {
  it('writes status=ready with the blob + dims on success', async () => {
    await runReelRender({ jobId: 'job-1', workspaceId: 'ws-1', body: { assetId: 'a-1' } })
    const p = terminalPatch()
    expect(p.body).toMatchObject({
      status: 'ready',
      blob_url: 'https://blob.example/reel.mp4',
      width: 1080,
      height: 1920,
      size_bytes: 4242,
      had_subtitles: true,
      duration_s: 12,
      error: null,
    })
  })

  it('guards the terminal write on status=eq.rendering (never clobbers a settled row)', async () => {
    await runReelRender({ jobId: 'job-1', workspaceId: 'ws-1', body: { assetId: 'a-1' } })
    const p = terminalPatch()
    expect(p.path).toContain('status=eq.rendering')
    expect(p.path).toContain('id=eq.job-1')
    expect(p.path).toContain('workspace_id=eq.ws-1')
  })

  it('fails the job when the asset is not a video', async () => {
    resolveImpl = async () => ({ ok: true, asset: { id: 'a-1' }, params: { isVideo: false } })
    await runReelRender({ jobId: 'job-1', workspaceId: 'ws-1', body: { assetId: 'a-1' } })
    expect(terminalPatch().body).toMatchObject({ status: 'failed', error: 'not_a_video' })
  })

  it('fails the job with the resolve error when validation fails', async () => {
    resolveImpl = async () => ({ ok: false, status: 404, error: 'asset_not_found' })
    await runReelRender({ jobId: 'job-1', workspaceId: 'ws-1', body: { assetId: 'a-1' } })
    expect(terminalPatch().body).toMatchObject({ status: 'failed', error: 'asset_not_found' })
  })

  it('fails the job when the render produced no blob', async () => {
    renderImpl = async () => ({ renders: [], errors: [{ channel: 'instagram_reel', error: 'ffmpeg_died' }] })
    await runReelRender({ jobId: 'job-1', workspaceId: 'ws-1', body: { assetId: 'a-1' } })
    expect(terminalPatch().body).toMatchObject({ status: 'failed', error: 'ffmpeg_died' })
  })

  it('fails the job (never throws) when the render throws', async () => {
    renderImpl = async () => { throw new Error('boom') }
    await expect(runReelRender({ jobId: 'job-1', workspaceId: 'ws-1', body: { assetId: 'a-1' } })).resolves.toBeUndefined()
    expect(terminalPatch().body).toMatchObject({ status: 'failed', error: 'render_crashed' })
  })

  it('fails the job when the workspace is gone', async () => {
    workspaceImpl = async () => null
    await runReelRender({ jobId: 'job-1', workspaceId: 'ws-1', body: { assetId: 'a-1' } })
    expect(terminalPatch().body).toMatchObject({ status: 'failed', error: 'workspace_not_found' })
  })
})
