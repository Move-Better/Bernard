import { describe, it, expect } from 'vitest'
import {
  FROZEN_PATCH_FIELDS,
  LOCKED_STATUSES,
  canUnschedule,
  checkPatchAgainstLock,
  isPieceLocked,
  patchNeedsLockCheck,
} from '../../src/lib/publishLock.js'

// The editor's real save shapes, so a rename in the client can't quietly make
// these tests describe fields nobody sends any more.
const CONTENT_EDIT = { content: 'rewritten caption' }
const MEDIA_SWAP = { mediaUrls: [{ url: 'https://blob/x.jpg', type: 'photo' }] }
const RATING = { isModelPost: true, modelReasons: ['hook_grabs'], modelNote: 'opener lands' }
const WINNER = { performedWell: true }

describe('lock membership', () => {
  it('locks exactly scheduled and published', () => {
    expect([...LOCKED_STATUSES].sort()).toEqual(['published', 'scheduled'])
  })

  it.each(['draft', 'in_review', 'approved', 'rejected', 'failed'])(
    'leaves %s editable',
    (status) => {
      expect(isPieceLocked({ status })).toBe(false)
      expect(checkPatchAgainstLock(status, CONTENT_EDIT).ok).toBe(true)
    },
  )

  it('keeps failed editable — a failed post needs the editor to fix and retry', () => {
    expect(checkPatchAgainstLock('failed', { ...CONTENT_EDIT, ...MEDIA_SWAP }).ok).toBe(true)
  })
})

describe('frozen content fields', () => {
  // Non-vacuity: if a refactor empties this list the whole guard becomes a
  // no-op that still passes every assertion below.
  it('covers the fields the editors actually write', () => {
    expect(FROZEN_PATCH_FIELDS).toEqual(
      expect.arrayContaining(['content', 'slides', 'mediaUrls', 'overlayText', 'textCard']),
    )
    expect(FROZEN_PATCH_FIELDS.length).toBeGreaterThanOrEqual(10)
  })

  it.each(LOCKED_STATUSES)('rejects a caption rewrite on a %s post', (status) => {
    const v = checkPatchAgainstLock(status, CONTENT_EDIT)
    expect(v.ok).toBe(false)
    expect(v.fields).toContain('content')
  })

  it.each(LOCKED_STATUSES)('rejects a media swap on a %s post', (status) => {
    expect(checkPatchAgainstLock(status, MEDIA_SWAP).ok).toBe(false)
  })

  it.each(FROZEN_PATCH_FIELDS)('rejects %s individually on a published post', (field) => {
    const v = checkPatchAgainstLock('published', { [field]: 'x' })
    expect(v.ok).toBe(false)
    expect(v.fields).toContain(field)
  })

  it('reports every offending field, not just the first', () => {
    const v = checkPatchAgainstLock('published', { ...CONTENT_EDIT, ...MEDIA_SWAP })
    expect(v.fields).toEqual(expect.arrayContaining(['content', 'mediaUrls']))
  })
})

describe('judgment stays live', () => {
  it.each(LOCKED_STATUSES)('allows the keeper rating on a %s post', (status) => {
    expect(checkPatchAgainstLock(status, RATING).ok).toBe(true)
  })

  it.each(LOCKED_STATUSES)('allows the winner toggle on a %s post', (status) => {
    expect(checkPatchAgainstLock(status, WINNER).ok).toBe(true)
  })

  it('allows notes and archiving on a published post', () => {
    expect(checkPatchAgainstLock('published', { notes: 'ran during the seminar push' }).ok).toBe(true)
    expect(checkPatchAgainstLock('published', { archivedAt: '2026-08-03T00:00:00Z' }).ok).toBe(true)
  })

  it('allows a rating and a note together in one save', () => {
    expect(checkPatchAgainstLock('published', { ...RATING, notes: 'n' }).ok).toBe(true)
  })
})

describe('the unschedule escape', () => {
  it('is offered on scheduled and refused on published', () => {
    expect(canUnschedule({ status: 'scheduled' })).toBe(true)
    expect(canUnschedule({ status: 'published' })).toBe(false)
  })

  it('lets a scheduled post return to approved, clearing its time', () => {
    expect(checkPatchAgainstLock('scheduled', { status: 'approved', scheduledAt: null }).ok).toBe(true)
  })

  it('lets a scheduled post return to draft', () => {
    expect(checkPatchAgainstLock('scheduled', { status: 'draft', scheduledAt: null }).ok).toBe(true)
  })

  it('refuses to smuggle a content edit through the unschedule', () => {
    const v = checkPatchAgainstLock('scheduled', { status: 'approved', ...CONTENT_EDIT })
    expect(v.ok).toBe(false)
    expect(v.fields).toContain('content')
  })

  it('refuses a bare reschedule — moving the time of a committed post', () => {
    expect(checkPatchAgainstLock('scheduled', { scheduledAt: '2026-09-01T10:00:00Z' }).ok).toBe(false)
  })

  it('gives published no way back to an editable status', () => {
    expect(checkPatchAgainstLock('published', { status: 'draft' }).ok).toBe(false)
    expect(checkPatchAgainstLock('published', { status: 'approved' }).ok).toBe(false)
    expect(checkPatchAgainstLock('published', { scheduledAt: null }).ok).toBe(false)
  })
})

describe('patchNeedsLockCheck gates the status read', () => {
  it('skips the read for judgment-only saves', () => {
    expect(patchNeedsLockCheck(RATING)).toBe(false)
    expect(patchNeedsLockCheck(WINNER)).toBe(false)
    expect(patchNeedsLockCheck({ notes: 'n' })).toBe(false)
  })

  // The property that matters: anything checkPatchAgainstLock could ever refuse
  // must first be routed to the read. A gap here silently unlocks that field.
  it.each(FROZEN_PATCH_FIELDS)('demands the read for %s', (field) => {
    expect(patchNeedsLockCheck({ [field]: 'x' })).toBe(true)
  })

  it('demands the read for status and scheduledAt', () => {
    expect(patchNeedsLockCheck({ status: 'draft' })).toBe(true)
    expect(patchNeedsLockCheck({ scheduledAt: null })).toBe(true)
  })

  it('never refuses a patch it declined to check', () => {
    // Exhaustive over the union of both statuses and every single-key patch the
    // frozen list plus the special cases can produce.
    const keys = [...FROZEN_PATCH_FIELDS, 'status', 'scheduledAt', 'notes', 'performedWell', 'isModelPost']
    for (const status of LOCKED_STATUSES) {
      for (const k of keys) {
        const patch = { [k]: k === 'scheduledAt' ? null : 'x' }
        if (!patchNeedsLockCheck(patch)) {
          expect(checkPatchAgainstLock(status, patch).ok).toBe(true)
        }
      }
    }
  })
})

describe('the lock reads stored status, never the caller claim', () => {
  it('cannot be unlocked by asserting a draft status alongside the edit', () => {
    // The handler passes the row's own status; a body claiming otherwise is
    // just another field. This is the whole reason checkPatchAgainstLock takes
    // currentStatus as its first argument instead of reading patch.status.
    const v = checkPatchAgainstLock('published', { status: 'draft', ...CONTENT_EDIT })
    expect(v.ok).toBe(false)
  })
})
