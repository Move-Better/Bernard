import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveFeedbackRow } from '../../api/_lib/resolveFeedback.js'

// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space into %20, which readFileSync ENOENTs.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const NOTICES_ROUTE = read('../../api/_routes/feedback/my-notices.js')
const BANNER = read('../../src/components/home/FeedbackResolvedBanner.jsx')

describe('a resolution note is required', () => {
  // It used to be optional, so a row could be resolved with nothing to say and
  // both the email and the banner fell back to "the issue you reported is
  // resolved" — which tells the reporter nothing about whether it's safe to go
  // back to the thing that broke.
  //
  // These assert BEFORE any network call: the guard sits above the first
  // fetch in resolveFeedbackRow, so a bad note can never reach Supabase.
  const ID = '11111111-2222-3333-4444-555555555555'

  it('rejects a missing note', async () => {
    expect(await resolveFeedbackRow({ id: ID })).toEqual({ status: 'note_required' })
  })

  it('rejects an empty or whitespace note', async () => {
    expect((await resolveFeedbackRow({ id: ID, note: '' })).status).toBe('note_required')
    expect((await resolveFeedbackRow({ id: ID, note: '      ' })).status).toBe('note_required')
  })

  it('rejects a shrugged one-word note', async () => {
    expect((await resolveFeedbackRow({ id: ID, note: 'done' })).status).toBe('note_required')
    expect((await resolveFeedbackRow({ id: ID, note: 'fixed' })).status).toBe('note_required')
  })

  it('still rejects a bad id first, so the id error is never masked', async () => {
    expect((await resolveFeedbackRow({ id: 'not-a-uuid', note: 'x' })).status).toBe('invalid_id')
  })
})

describe('both resolve routes surface note_required', () => {
  // The Clerk endpoint and the headless cron trigger share _lib/resolveFeedback
  // so their behaviour can't drift — but each still has to translate the new
  // status into an HTTP response, or it falls through to a misleading 200.
  const routes = {
    'feedback/resolve.js': read('../../api/_routes/feedback/resolve.js'),
    'cron/resolve-feedback.js': read('../../api/_routes/cron/resolve-feedback.js'),
  }

  for (const [name, src] of Object.entries(routes)) {
    it(`${name} returns 400 on note_required`, () => {
      expect(src).toMatch(/note_required/)
      expect(src).toMatch(/status\(400\)[\s\S]{0,60}note_required/)
    })

    it(`${name} documents the note as required, not optional`, () => {
      expect(src).not.toMatch(/note\s+string\s+optional/)
      expect(src).toMatch(/note\s+string\s+required/)
    })
  }
})

describe('GUARD — the banner can only render fields my-notices actually selects', () => {
  // Same family as the write-only-column bug (#2467): two lists that must
  // cover each other, with nothing to catch a mismatch. Here the failure is
  // silent in the other direction — the banner renders `undefined`, so a
  // missing field looks like a row that simply has no note or no date.
  //
  // This is exactly how `message` sat unused: the API selected it and the
  // component never read it, for as long as the banner existed.
  const select = NOTICES_ROUTE.match(/&select=([a-z_,]+)/i)?.[1]

  it('finds the select list — a rotted regex must not pass vacuously', () => {
    expect(select, 'could not parse the select list out of my-notices.js').toBeTruthy()
    expect(select.split(',').length).toBeGreaterThanOrEqual(5)
  })

  const selected = new Set((select || '').split(','))

  it('selects every notice field the banner reads', () => {
    // Every `notice.foo` / `n.foo` the component dereferences.
    const read = new Set(
      [...BANNER.matchAll(/\bnotice\.([a-z_]+)/g)].map((m) => m[1])
        .concat([...BANNER.matchAll(/\bn\.([a-z_]+)/g)].map((m) => m[1])),
    )
    expect(read.size).toBeGreaterThan(2)
    for (const field of read) {
      expect(selected.has(field), `banner reads notice.${field} but my-notices never selects it`).toBe(true)
    }
  })

  it('still selects the reporter’s own words', () => {
    // The point of the redesign. Losing this puts us back to a banner that
    // never says WHICH report was fixed.
    expect(selected.has('message')).toBe(true)
  })

  it('renders the reported message, not just the note', () => {
    expect(BANNER).toMatch(/notice\.message/)
  })
})
