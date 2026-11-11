import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { talkToBernardHref } from '../../src/lib/talkToBernard.js'

describe('talkToBernardHref', () => {
  it('sends live-call workspaces to the call topic screen', () => {
    expect(talkToBernardHref({ realtime_voice_enabled: true })).toBe('/new/live-interview')
  })

  it('sends everyone else to the text interview, never to the picker', () => {
    expect(talkToBernardHref({ realtime_voice_enabled: false })).toBe('/new/interview')
    expect(talkToBernardHref({})).toBe('/new/interview')
    expect(talkToBernardHref(null)).toBe('/new/interview')
    // Only a real boolean turns the live call on.
    expect(talkToBernardHref({ realtime_voice_enabled: 'true' })).toBe('/new/interview')
  })

  it('is what the sidebar, the phone bar and the search palette use', () => {
    const layout = readFileSync(new URL('../../src/components/Layout.jsx', import.meta.url), 'utf8')
    const palette = readFileSync(new URL('../../src/components/CommandPalette.jsx', import.meta.url), 'utf8')
    // Sidebar + phone top bar.
    expect(layout.match(/to=\{talkToBernardHref\(ws\)\}/g)?.length).toBe(2)
    expect(palette).toMatch(/to: talkToBernardHref\(ws\)/)
  })
})
