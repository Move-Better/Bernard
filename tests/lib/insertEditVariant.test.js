import { describe, it, expect } from 'vitest'
import { insertEditVariant } from '../../api/_lib/insertEditVariant.js'

// The media editor's variant save against migration 203's unique index
// (parent_id, variant_label). Q ruled 2026-11-19: a second "9:16 Vertical"
// keeps both, saving as "9:16 Vertical (2)". Drives the real helper against a
// scripted PostgREST.

const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
})
const taken = () => res(409, {
  code: '23505',
  message: 'duplicate key value violates unique constraint "media_assets_aspect_variant_unique"',
})

function scripted(script) {
  const calls = []
  const sb = async (path, init = {}) => {
    calls.push({ path, method: init.method, body: JSON.parse(init.body) })
    const next = script.shift()
    if (!next) throw new Error('unscripted call')
    return next
  }
  return { sb, calls }
}

const row = { workspace_id: 'ws', parent_id: 'src-1', variant_label: '9:16 Vertical', kind: 'photo' }

describe('insertEditVariant', () => {
  it('never saves a user crop under the label the carousel render owns', async () => {
    const { sb, calls } = scripted([res(201, [{ id: 'v1' }])])
    await insertEditVariant(sb, { ...row, variant_label: '4:5 carousel' })
    expect(calls.map((c) => c.body.variant_label)).toEqual(['4:5 carousel (2)'])
  })

  it('saves under the plain label when it is free', async () => {
    const { sb, calls } = scripted([res(201, [{ id: 'v1', variant_label: '9:16 Vertical' }])])
    const v = await insertEditVariant(sb, row)
    expect(v).toMatchObject({ id: 'v1' })
    expect(calls.map((c) => c.body.variant_label)).toEqual(['9:16 Vertical'])
  })

  it('numbers the label when the name is already live on this master', async () => {
    const { sb, calls } = scripted([
      taken(),
      taken(),
      res(201, [{ id: 'v3', variant_label: '9:16 Vertical (3)' }]),
    ])
    const v = await insertEditVariant(sb, row)
    expect(v).toMatchObject({ id: 'v3', variant_label: '9:16 Vertical (3)' })
    expect(calls.map((c) => c.body.variant_label)).toEqual([
      '9:16 Vertical', '9:16 Vertical (2)', '9:16 Vertical (3)',
    ])
    // Every attempt is the same row apart from the label.
    for (const c of calls) {
      expect(c.method).toBe('POST')
      expect(c.path).toBe('media_assets')
      expect(c.body.parent_id).toBe('src-1')
    }
  })

  it('does not retry a different failure', async () => {
    const { sb, calls } = scripted([res(400, { code: '23502', message: 'null value in column "asset_purpose"' })])
    await expect(insertEditVariant(sb, row)).rejects.toThrow(/Insert variant failed: 400 .*23502/)
    expect(calls).toHaveLength(1)
  })

  it('does not retry a unique violation on some other constraint', async () => {
    const { sb, calls } = scripted([res(409, { code: '23505', message: 'violates unique constraint "media_assets_pkey"' })])
    await expect(insertEditVariant(sb, row)).rejects.toThrow(/409/)
    expect(calls).toHaveLength(1)
  })

  it('stops after 20 attempts instead of looping forever', async () => {
    const { sb, calls } = scripted(Array.from({ length: 20 }, taken))
    await expect(insertEditVariant(sb, row)).rejects.toThrow(/20 live variants/)
    expect(calls).toHaveLength(20)
  })
})

describe('api/media/[id]/edit.js variant mode', () => {
  it('inserts its variant through insertEditVariant, not a bare POST', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../../api/media/[id]/edit.js', import.meta.url), 'utf8')
    expect(src).toMatch(/await insertEditVariant\(sb, variantRow\)/)
    expect(src).not.toMatch(/sb\('media_assets',\s*\{\s*method:\s*'POST'/)
  })
})
