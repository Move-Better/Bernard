import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Post editor audit D (mockup signed off 2026-11-11): one name per tool, and
// each video-editor tab opens a panel with the same name. Renaming one side
// without the other fails here.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const rail = read('../../src/pages/video-editor/IconRail.jsx')
const PAIRS = [
  ['Words', 'PostCaptionInspector.jsx'],
  ['Moments', 'MomentsInspector.jsx'],
  ['Reframe', 'ClipInspector.jsx'],
  ['Media', 'MediaInspector.jsx'],
  ['Grade', 'GradeInspector.jsx'],
  ['Subtitles', 'CaptionInspector.jsx'],
  ['Transcript', 'TranscriptInspector.jsx'],
  ['Text', 'OverlayInspector.jsx'],
]

describe('video editor tab names', () => {
  it('lists the signed-off tabs in order', () => {
    const labels = [...rail.matchAll(/label: '([^']+)'/g)].map((m) => m[1])
    expect(labels).toEqual(['Words', 'Moments', 'Reframe', 'Media', 'Grade', 'Subtitles', 'Music', 'Transcript', 'Text'])
  })
  it.each(PAIRS)('the %s tab opens a panel headed %s', (label, file) => {
    expect(rail).toContain(`label: '${label}'`)
    // Every panel heading in the file (some panels have two states) must match.
    const headings = [...read(`../../src/pages/video-editor/inspectors/${file}`).matchAll(/<InspectorShell[^>]*?title="([^"]+)"/g)].map((m) => m[1])
    expect(headings.length).toBeGreaterThan(0)
    expect(new Set(headings)).toEqual(new Set([label]))
  })
  it('the post text is Words in every editor, never Caption', () => {
    expect(rail).not.toContain("label: 'Caption'")
    expect(read('../../src/components/editor/railSections.js')).toContain("words: { icon: MessageCircle, label: 'Words' }")
  })
})
