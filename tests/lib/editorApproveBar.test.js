import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Post editor audit option A (mockup signed off 2026-11-11): one approve bar.
// Every editor reads Saved · voice · Reject · Approve · Schedule, then "More".
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const bar = read('../../src/components/editor/EditorWorkflowBar.jsx')
const editors = {
  slide: read('../../src/components/story-detail/SlideEditor.jsx'),
  video: read('../../src/pages/VideoEditor.jsx'),
  blog: read('../../src/components/editor/UnifiedEditor.jsx'),
}

describe('one approve bar', () => {
  it('puts Saved first and Reject before Approve', () => {
    const saved = bar.indexOf('<SaveStatus status={saveStatus} />')
    const voice = bar.indexOf('<VoiceChip piece={piece} />')
    expect(saved).toBeGreaterThan(-1)
    expect(saved).toBeLessThan(voice)
    // In the not-yet-approved branch, the reject control precedes the button.
    const branch = bar.slice(bar.indexOf('{canApproveNow && ('))
    expect(branch.indexOf('<RejectControl wf={wf} />')).toBeGreaterThan(-1)
    expect(branch.indexOf('<RejectControl wf={wf} />')).toBeLessThan(branch.indexOf('variant="success"'))
  })

  it('labels the button plain "Approve" in every editor', () => {
    expect(bar).not.toContain('Approve — sounds like me')
  })

  it.each(Object.entries(editors))('%s editor has a More menu and no loose extras', (name, src) => {
    expect(src).toContain('<EditorMoreMenu')
    expect(src).not.toContain('aria-label="Full publish panel"')
    expect(src).not.toMatch(/'Save video'/)
    expect(src).toMatch(/title=\{[^}\n]*postTitle\(/)
  })
})
