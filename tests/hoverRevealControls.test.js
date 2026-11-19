// Guards for the 2026-11-18 audit items 12-13 (mockup signed off by Q 2026-11-19,
// .claude/mockups/link-colour-and-hover-reveal.html).
//
// 1. A row control that hides until hover must use the shared `.nx-reveal`
//    class, which also shows it on keyboard focus and ALWAYS on touch screens.
//    A hand-rolled `opacity-0 group-hover:opacity-100` on a button is invisible
//    on a phone forever.
// 2. Link rows on the Home recap and the Producer tile carry `text-foreground`,
//    because index.css paints every <a> teal at rest.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name)
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out)
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(rel)
  }
  return out
}

// Places where hover-only is fine because the element is NOT a control: a
// tooltip, a pointer-events-none overlay hint, or a decorative icon inside a
// row that is itself the click target. A new entry here needs that reason.
const DECORATIVE_HOVER_ONLY = {
  'src/components/Layout.jsx': 1, // nav tooltip
  'src/components/FeedbackWidget.jsx': 1, // tooltip
  'src/components/settings/PatientArchetypes.jsx': 1, // pencil icon in a clickable row
  'src/pages/settings/InterviewSetupPage.jsx': 1, // chevron icon in a clickable row
  'src/components/story-detail/slide-editor/SuggestionThumb.jsx': 1, // pointer-events-none overlay
  'src/components/story-detail/slide-editor/PhotoInspector.jsx': 1, // pointer-events-none overlay
  'src/components/storyboard/CandidateCard.jsx': 1, // pointer-events-none badge
  'src/components/editor/UnifiedEditor.jsx': 1, // pointer-events-none "attach" overlay
  'src/pages/video-editor/Canvas.jsx': 1, // pointer-events-none play overlay
}

describe('hover-only row controls', () => {
  it('index.css shows .nx-reveal on hover, focus-within and always on touch', () => {
    const css = read('src/index.css')
    expect(css).toMatch(/\.nx-reveal\s*\{\s*opacity:\s*0;/)
    expect(css).toMatch(/\.group:hover \.nx-reveal/)
    expect(css).toMatch(/\.group:focus-within \.nx-reveal/)
    expect(css).toMatch(/@media \(hover: none\)\s*\{\s*\.nx-reveal\s*\{\s*opacity:\s*1;/)
  })

  it('no new hand-rolled group-hover:opacity-100 outside the decorative allowlist', () => {
    const found = {}
    for (const f of walk('src')) {
      const n = (read(f).match(/group-hover:opacity-100/g) || []).length
      if (n) found[f] = n
    }
    for (const [f, n] of Object.entries(found)) {
      expect(
        n,
        `${f} hides something until hover. If it is a button, use the nx-reveal class (src/index.css) so touch screens can see it; if it is purely decorative, add it to DECORATIVE_HOVER_ONLY with the reason.`,
      ).toBeLessThanOrEqual(DECORATIVE_HOVER_ONLY[f] || 0)
    }
  })

  it.each([
    ['src/components/PhotoTemplates.jsx', 1],
    ['src/components/BrandAnchorsEditor.jsx', 1],
    ['src/components/home/PointCapture.jsx', 1],
    ['src/pages/StoryDetail.jsx', 1],
    ['src/pages/Book.jsx', 1],
    ['src/components/book/ExcludeFromBookToggle.jsx', 1],
    ['src/components/storyboard/DraftContextPanel.jsx', 1],
    ['src/components/editor/UnifiedEditor.jsx', 1],
  ])('%s uses nx-reveal for its hover control', (file, n) => {
    expect((read(file).match(/\bnx-reveal\b/g) || []).length).toBeGreaterThanOrEqual(n)
  })
})

describe('link rows are ink at rest, not teal', () => {
  it('Home recap rows carry text-foreground (published, captured, scheduled, in review)', () => {
    const src = read('src/components/overview/WeeklyRecapPanel.jsx')
    expect(src).toContain("const cls = 'flex items-center gap-3 group text-foreground border-l-2 border-l-success")
    for (const border of ['border-l-info pl-2.5', 'border-l-warning pl-2.5']) {
      const lines = src.split('\n').filter((l) => l.includes('<Link') && l.includes(border))
      expect(lines.length, border).toBeGreaterThan(0)
      for (const l of lines) expect(l, l.trim()).toContain('text-foreground')
    }
  })

  it('Producer "This week" tile link carries text-foreground', () => {
    expect(read('src/pages/ProducerSettings.jsx')).toContain('<Link to="/producer" className="group text-foreground">')
  })
})
