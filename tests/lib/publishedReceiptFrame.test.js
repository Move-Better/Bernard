import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Post editor audit E (2026-11-11).
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const receipt = read('../../src/components/story-detail/PublishedReceipt.jsx')
const page = read('../../src/pages/StoryboardPublish.jsx')
const unschedule = receipt.slice(receipt.indexOf('function UnscheduleControl'), receipt.indexOf('export default function PublishedReceipt'))

describe('published view', () => {
  it('unschedules through the cancel that reaches bundle.social, never a bare status patch', () => {
    // A status-only patch left the post queued at the network: it would still
    // have gone out, and rescheduling would have posted it twice.
    expect(unschedule.length).toBeGreaterThan(200)
    expect(unschedule).toContain('wf.cancelScheduled()')
    expect(unschedule).not.toMatch(/status:\s*'approved'/)
    expect(unschedule).not.toContain('useUpdateContentItem(')
  })

  it('uses the editors’ top bar and full-screen frame', () => {
    expect(receipt).toContain('<EditorChrome')
    expect(receipt).not.toContain('Back to Publish')
    const branch = page.slice(page.indexOf('if (isPieceLocked(piece))'), page.indexOf('<PublishedReceipt') + 400)
    expect(branch).toContain('h-[100dvh] overflow-hidden')
    expect(branch).toContain('onBack={goBack}')
  })
})
