import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — verdict buttons take semantic color, never the brand teal default
// (the codebase's own house rule, stated inline at VideoEditor.jsx ~1992:
// "approve=green, reject=red, brand teal reads as navigation"). Two of the
// seven real Approve buttons in the app (EditorWorkflowBar, AssetsPane) were
// flagged by /bernard-audit full; a follow-up manual sweep of every file
// containing the word "Approve" found FOUR MORE using the plain default
// Button variant (PackageCard, YourWeek's raw <button>, VideoEditor's
// finalize-to-post button, WordsApproval) -- the audit's own scope (two
// grep-flagged sites) would have missed the majority of the real bug.
//
// A generic source-regex sweep for this is too noisy to be reliable (the
// word "Approve" also appears in comments, toast messages, tooltips, and
// unrelated titles like "Approve first" dozens of times across these same
// files) -- so this pins each of the seven confirmed real buttons by name
// rather than pattern-matching. AnswerReview.jsx's Approve button is
// deliberately excluded from the "must be green" list: it conditionally
// renders bg-action instead of bg-success specifically when overriding a
// voice-check flag ("Publish anyway"), which is correct, intentional
// design, not the same bug -- pinned separately below.
const FILES = {
  editorWorkflowBar: fileURLToPath(new URL('../../src/components/editor/EditorWorkflowBar.jsx', import.meta.url)),
  assetsPane: fileURLToPath(new URL('../../src/components/story-detail/AssetsPane.jsx', import.meta.url)),
  onHandTab: fileURLToPath(new URL('../../src/components/moments/OnHandTab.jsx', import.meta.url)),
  packageCard: fileURLToPath(new URL('../../src/components/moments/PackageCard.jsx', import.meta.url)),
  yourWeek: fileURLToPath(new URL('../../src/pages/YourWeek.jsx', import.meta.url)),
  videoEditor: fileURLToPath(new URL('../../src/pages/VideoEditor.jsx', import.meta.url)),
  wordsApproval: fileURLToPath(new URL('../../src/pages/WordsApproval.jsx', import.meta.url)),
  answerReview: fileURLToPath(new URL('../../src/pages/AnswerReview.jsx', import.meta.url)),
}

// Grabs a window of text around the first match of `needle`, wide enough to
// cover a multi-line <Button>...</Button> or <button>...</button> block.
function windowAround(src, needle, radius = 300) {
  const i = src.indexOf(needle)
  expect(i, `expected to find ${JSON.stringify(needle)} in the file`).toBeGreaterThan(-1)
  return src.slice(Math.max(0, i - radius), i + needle.length + radius)
}

describe('Approve buttons use semantic success color, never the brand-teal default', () => {
  it('EditorWorkflowBar — the two-step-gate Approve button', () => {
    const src = readFileSync(FILES.editorWorkflowBar, 'utf8')
    // Anchored on the conditional label expression rather than a bare
    // "Approve\n</Button>": blog now reads "Approve — sounds like me" (one
    // approval covering the article AND the story's words, Q 2026-08-29), so
    // the old literal-text anchor no longer matches. The button itself is
    // unchanged and must still be semantic green.
    const win = windowAround(src, "? 'Approve — sounds like me' : 'Approve'", 800)
    expect(win).toMatch(/variant="success"/)
  })

  it('AssetsPane — the story-detail Approve button', () => {
    const src = readFileSync(FILES.assetsPane, 'utf8')
    const win = windowAround(src, 'Approve\n          </Button>')
    expect(win).toMatch(/variant="success"/)
  })

  it('OnHandTab — the moment-review queue Approve button', () => {
    const src = readFileSync(FILES.onHandTab, 'utf8')
    const win = windowAround(src, '<Check className="h-4 w-4" />Approve')
    expect(win).toMatch(/variant="success"|bg-success/)
  })

  it('PackageCard — the package Approve button', () => {
    const src = readFileSync(FILES.packageCard, 'utf8')
    const win = windowAround(src, '<CheckCircle2 className="h-3 w-3 mr-1" />Approve', 800)
    expect(win).toMatch(/variant="success"/)
  })

  it('YourWeek — the /week card raw <button> Approve control', () => {
    const src = readFileSync(FILES.yourWeek, 'utf8')
    const win = windowAround(src, 'onClick={() => onApprove(item)}')
    expect(win).toMatch(/bg-success\b/)
    expect(win).not.toMatch(/bg-primary\b/)
  })

  it('VideoEditor — the finalize-clip-to-post Approve button', () => {
    const src = readFileSync(FILES.videoEditor, 'utf8')
    const win = windowAround(src, "'Rendering clip…' : 'Approve'", 500)
    expect(win).toMatch(/variant="success"/)
  })

  it('WordsApproval — the "Approve the words" button', () => {
    const src = readFileSync(FILES.wordsApproval, 'utf8')
    const win = windowAround(src, 'onClick={handleApprove} disabled={saving || !value.trim()}')
    expect(win).toMatch(/variant="success"/)
  })

  it('AnswerReview — correctly branches success/action, never the plain default (documented exception)', () => {
    const src = readFileSync(FILES.answerReview, 'utf8')
    const win = windowAround(src, "mutation.mutate({ id: active.id, action: 'approve' })", 500)
    // Both branches of the conditional must be semantic colors, not the bare default.
    expect(win).toMatch(/bg-success\b/)
    expect(win).toMatch(/bg-action\b/)
  })
})
