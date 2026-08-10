import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stripStoryDatePrefix } from '../../src/lib/storyTitle.js'

// A staff member reported the publish editor's top-left title reading
// "July 10, 2026 — Hip extension and opposite-shoulder stability" on an
// Instagram carousel whose slides mention neither a date nor hip extension.
//
// It was never slide content. `content_items.topic` carries the SOURCE STORY's
// title, and the weekly outbound-call path deliberately bakes a date into the
// stored topic (api/_lib/outboundCall.js `generateCallStoryTitle` returns
// `${MM/DD/YY} — ${subject}`), so the prefix is an ongoing data shape, not a
// one-off legacy row. src/lib/storyTitle.js exists precisely to strip it at
// display time — it was just never wired into the publish/editor spine.
//
// These pin the two halves that actually regress: the helper handling the real
// stored string, and every title-bearing render routing through it.

// `new URL(...).pathname` percent-encodes the space in "Claude Projects" —
// fileURLToPath is required for anything handed to fs.
const read = (rel) => {
  const raw = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  // Live code only: a commented-out call must not satisfy these assertions.
  return raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// The exact string that shipped to the reporter, verified in prod.
const REPORTED = 'July 10, 2026 — Hip extension and opposite-shoulder stability'
const SUBJECT = 'Hip extension and opposite-shoulder stability'

describe('the reported publish-editor title', () => {
  it('renders the bare subject, with no date prefix', () => {
    expect(stripStoryDatePrefix(REPORTED)).toBe(SUBJECT)
  })

  it('leaves no date-shaped text anywhere in the result', () => {
    const out = stripStoryDatePrefix(REPORTED)
    expect(out).not.toMatch(/\d{4}/)
    expect(out).not.toMatch(/July/)
    expect(out).not.toMatch(/[—–-]\s*$|^\s*[—–-]/)
  })

  it('is idempotent, so a pre-stripped topic is untouched', () => {
    expect(stripStoryDatePrefix(SUBJECT)).toBe(SUBJECT)
    expect(stripStoryDatePrefix(stripStoryDatePrefix(REPORTED))).toBe(SUBJECT)
  })

  it('handles the numeric form generateCallStoryTitle still writes today', () => {
    expect(stripStoryDatePrefix(`07/10/26 — ${SUBJECT}`)).toBe(SUBJECT)
  })

  it('does not eat a subject that merely opens with a month word', () => {
    expect(stripStoryDatePrefix('July recap of the quarter')).toBe('July recap of the quarter')
  })
})

// Every surface that paints a piece/interview topic as a user-facing title.
// The `raw` pattern is the anti-pattern: its presence means that surface would
// leak the date again. Both directions are asserted so a half-revert fails.
const TITLE_SITES = [
  {
    file: '../../src/pages/StoryboardPublish.jsx',
    what: 'publish page title (published receipt + Story branch)',
    raw: 'piece.topic || firstHeading',
    stripped: 'stripStoryDatePrefix(piece.topic) || firstHeading',
  },
  {
    file: '../../src/pages/StoryboardPublish.jsx',
    what: '"Next up" queue card',
    raw: '(nextPiece.topic || firstHeading',
    stripped: '(stripStoryDatePrefix(nextPiece.topic) || firstHeading',
  },
  {
    file: '../../src/components/story-detail/SlideEditor.jsx',
    what: 'carousel/photo editor chrome — the reported top-left title',
    raw: 'title={piece?.topic}',
    stripped: 'title={stripStoryDatePrefix(piece?.topic)}',
  },
  {
    file: '../../src/components/editor/UnifiedEditor.jsx',
    what: 'unified editor chrome (blog / email / text / video-no-asset)',
    raw: "title={piece?.topic || 'Untitled draft'}",
    stripped: "title={stripStoryDatePrefix(piece?.topic) || 'Untitled draft'}",
  },
  {
    file: '../../src/components/storyboard/DraftContextPanel.jsx',
    what: '"The draft" heading beside the media picker',
    raw: 'piece?.topic || firstHeading',
    stripped: 'stripStoryDatePrefix(piece?.topic) || firstHeading',
  },
  {
    file: '../../src/lib/useContentWorkflow.js',
    what: 'published blog <title> + URL slug — public-facing, not just chrome',
    raw: "headline || (piece.topic || 'Blog Post')",
    stripped: "headline || (stripStoryDatePrefix(piece.topic) || 'Blog Post')",
  },
]

describe('no title-bearing surface renders a raw topic', () => {
  // Non-vacuity: if a refactor renames these files or empties them, every
  // assertion below would trivially pass against an empty string.
  it('reads real source for every site', () => {
    for (const { file } of TITLE_SITES) {
      expect(read(file).length, `${file} is empty`).toBeGreaterThan(500)
    }
  })

  it.each(TITLE_SITES)('$what routes through the strip helper', ({ file, stripped }) => {
    expect(read(file)).toContain(stripped)
  })

  it.each(TITLE_SITES)('$what no longer renders the raw topic', ({ file, raw }) => {
    expect(read(file)).not.toContain(raw)
  })

  it.each([...new Set(TITLE_SITES.map((s) => s.file))])('%s imports the helper', (file) => {
    expect(read(file)).toMatch(/import \{[^}]*stripStoryDatePrefix[^}]*\} from/)
  })
})
