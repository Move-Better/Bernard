// A workspace whose pinned custom reel template was deleted must fall back to
// the built-in captions_only floor (Q, 2026-08-10), not hook_card. Before the
// fix the pin went straight to resolveVideoTemplate, whose not-found fallback
// is hook_card, so a deleted pin silently brought back the headline card Q
// ruled out (audit 2026-11-18, P2).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

process.env.SUPABASE_URL = 'http://supabase.test'
process.env.SUPABASE_SERVICE_KEY = 'service-key'

const { resolveWorkspaceTemplate } = await import('../../api/_lib/reelFactory.js')

const PIN = '66666666-6666-4666-8666-666666666666'
let customs
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(customs), { status: 200 })))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.unstubAllGlobals())

describe('reel template resolution', () => {
  it('falls back to captions_only when the pinned custom template is gone', async () => {
    customs = []
    const t = await resolveWorkspaceTemplate({ id: 'ws', reel_preset: PIN })
    expect(t.id).toBe('captions_only')
  })

  it('falls back to the workspace default custom template when the pin is gone', async () => {
    customs = [{ id: 'dflt', name: 'Default', config: {}, is_default: true }]
    const t = await resolveWorkspaceTemplate({ id: 'ws', reel_preset: PIN })
    expect(t.id).toBe('dflt')
  })

  it('still honours a pinned custom template that exists', async () => {
    customs = [{ id: PIN, name: 'Mine', config: {}, is_default: false }]
    const t = await resolveWorkspaceTemplate({ id: 'ws', reel_preset: PIN })
    expect(t.id).toBe(PIN)
  })

  it('still honours a pinned built-in (hook_card opt-in)', async () => {
    customs = []
    const t = await resolveWorkspaceTemplate({ id: 'ws', reel_preset: 'hook_card' })
    expect(t.id).toBe('hook_card')
  })
})
