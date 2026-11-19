import { describe, it, expect, vi, beforeEach } from 'vitest'

// saveAspectVariant's find-then-insert race (audit 2026-11-18 item 7). The
// partial unique index from migration 203 refuses the loser's INSERT with
// 23505; the loser must then PATCH the winner's row instead of failing the
// render. These tests drive the real function against a scripted PostgREST.

const calls = []
let script = []
vi.mock('../../api/_lib/supabaseRest.js', () => ({
  supabaseRest: vi.fn(async (path, init = {}) => {
    calls.push({ path, method: init.method || 'GET', body: init.body })
    const next = script.shift()
    if (!next) throw new Error(`unscripted call: ${init.method || 'GET'} ${path}`)
    return next
  }),
}))
vi.mock('../../api/_lib/thumbnail.js', () => ({ generateAndPersistThumbnail: vi.fn(async () => null) }))

const { saveAspectVariant } = await import('../../api/_lib/aspectVariants.js')

const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
})

const WS = '11111111-1111-1111-1111-111111111111'
const args = {
  sourceAsset: { id: 'src-1', kind: 'photo', filename: 'a.mp4', asset_purpose: 'broll', speaker_role: null },
  channel: 'instagram_carousel_video',
  render: { blobUrl: 'https://blob.example/ws/v.mp4', width: 1080, height: 1350, sizeBytes: 10 },
  scope: { column: 'workspace_id', id: WS },
}

beforeEach(() => { calls.length = 0; script = [] })

describe('saveAspectVariant — losing the insert race (23505)', () => {
  it('re-finds the winning row and PATCHes it instead of throwing', async () => {
    script = [
      res(200, []), // findAspectVariant: nothing yet
      res(409, { code: '23505', message: 'duplicate key value violates unique constraint "media_assets_aspect_variant_unique"' }),
      res(200, [{ id: 'winner-1' }]), // re-find after the conflict
      res(200, [{ id: 'winner-1', kind: 'photo', blob_url: args.render.blobUrl }]), // PATCH
    ]
    const variant = await saveAspectVariant(args)
    expect(variant).toMatchObject({ id: 'winner-1', blob_url: args.render.blobUrl })
    const patch = calls[3]
    expect(patch.method).toBe('PATCH')
    expect(patch.path).toContain('id=eq.winner-1')
    expect(patch.path).toContain(`workspace_id=eq.${WS}`)
    expect(JSON.parse(patch.body).blob_url).toBe(args.render.blobUrl)
    expect(script).toHaveLength(0)
  })

  it('still throws when the conflict row cannot be re-found', async () => {
    script = [res(200, []), res(409, { code: '23505' }), res(200, [])]
    await expect(saveAspectVariant(args)).rejects.toThrow(/insert failed: 409 .*23505/)
  })

  it('does not swallow a non-unique insert error', async () => {
    script = [res(200, []), res(400, { code: '23502', message: 'null value in column' })]
    await expect(saveAspectVariant(args)).rejects.toThrow(/insert failed: 400 .*23502/)
    expect(calls).toHaveLength(2) // no re-find, no PATCH
  })

  it('a clean insert returns the new row with no extra calls', async () => {
    script = [res(200, []), res(201, [{ id: 'new-1', kind: 'photo' }])]
    expect(await saveAspectVariant(args)).toMatchObject({ id: 'new-1' })
    expect(calls).toHaveLength(2)
  })
})
