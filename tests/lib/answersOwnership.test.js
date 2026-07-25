import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A public answer publishes under a named clinician as medical-adjacent advice, so
// every action on it is gated on STRICT ownership — no admin exception (Q,
// 2026-07-25: "Clinicians should score and edit their own content. No admin back
// door should exist right now.").
//
// This is a deliberate divergence from the self-or-admin contract used elsewhere
// (staff rows, voice clone), which makes it exactly the kind of rule a later
// consistency pass would "fix" by adding isAdmin back. These tests exist to make
// that a red build rather than a silent regression.
//
// note: fileURLToPath, not .pathname — every project path here contains a space.
const SRC = readFileSync(
  fileURLToPath(new URL('../../api/_routes/answers.js', import.meta.url)),
  'utf8',
)

// Strip block comments so the documentation ABOUT the rule can't satisfy a check
// that's meant to inspect real code (a mention is not an implementation).
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('answers route — strict ownership, no admin back door', () => {
  it('has no isAdmin helper or usage left in executable code', () => {
    expect(CODE).not.toMatch(/isAdmin/)
    expect(CODE).not.toMatch(/permission_tier/)
  })

  it('gates row actions on exact staff ownership, with no admin escape hatch', () => {
    expect(CODE).toMatch(/row\.staff_id\s*!==\s*me\.id\s*\)\s*return res\.status\(403\)/)
  })

  it('gates drafting on exact staff ownership too', () => {
    expect(CODE).toMatch(/staffId\s*!==\s*me\.id\s*\)\s*return res\.status\(403\)/)
  })

  it('never widens an ownership check with a boolean OR', () => {
    // `staff_id !== me.id && !somethingElse` is the shape an escape hatch takes.
    const ownershipLines = CODE.split('\n').filter((l) => /!==\s*me\.id/.test(l))
    expect(ownershipLines.length).toBeGreaterThan(0) // non-vacuity
    for (const line of ownershipLines) expect(line).not.toMatch(/&&/)
  })

  // Non-vacuity: prove these assertions are reading real content, so a moved or
  // renamed file can't turn the whole suite into a silent pass.
  it('is actually reading the answers route', () => {
    expect(CODE).toMatch(/action === 'approve'/)
    expect(CODE).toMatch(/action === 'recheck'/)
    expect(CODE.length).toBeGreaterThan(4000)
  })
})
