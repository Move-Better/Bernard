// The newsletter follows the Newsletter channel (enabled_outputs 'email'),
// Q 2026-11-16: off hides the "Write a newsletter" tile, the /new/newsletter
// page and the "Newsletter — assembling" card on /week.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { newsletterEnabled } from '../src/lib/outputChannels.js'
import { activeDigest } from '../api/_routes/content-plan/week-summary.js'

const digests = [{ id: 'patients', label: 'Patients', channel: 'email', enabled: true, frequency: 'monthly' }]

describe('newsletter channel switch', () => {
  it('is on only when the workspace has the email channel', () => {
    expect(newsletterEnabled({ enabled_outputs: ['blog', 'email'] })).toBe(true)
    expect(newsletterEnabled({ enabled_outputs: ['blog', 'gbp'] })).toBe(false)
    expect(newsletterEnabled({})).toBe(false)
    expect(newsletterEnabled(null)).toBe(false)
  })

  it('the /week digest card disappears when the channel is off, even with a digest enabled', () => {
    expect(activeDigest({ enabled_outputs: ['email'], cadence_policy: { digests } })).toMatchObject({ label: 'Patients' })
    expect(activeDigest({ enabled_outputs: ['blog'], cadence_policy: { digests } })).toBeNull()
    expect(activeDigest({ enabled_outputs: null, cadence_policy: { digests } })).toBeNull()
    expect(activeDigest({ enabled_outputs: ['email'], cadence_policy: {} })).toBeNull()
  })

  it('the tile and the page both read the switch', () => {
    const picker = readFileSync(new URL('../src/pages/CapturePicker.jsx', import.meta.url), 'utf8')
    expect(picker).toMatch(/newsletterEnabled\(workspace\)\s*\?\s*\[\{ key: 'newsletter'/)
    const page = readFileSync(new URL('../src/pages/NewNewsletter.jsx', import.meta.url), 'utf8')
    expect(page).toMatch(/source === 'db' && !newsletterEnabled\(workspace\)\) return <Navigate to="\/new" replace \/>/)
  })
})
