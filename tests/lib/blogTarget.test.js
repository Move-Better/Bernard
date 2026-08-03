import { describe, it, expect } from 'vitest'
import {
  blogTargetFor, monthKey, dayOfMonth, countsTowardMonth, progressFor,
  DEFAULT_BLOG_TARGET_PER_MONTH,
} from '../../api/_lib/blogTarget.js'

describe('blogTargetFor', () => {
  it('defaults to ON at the practice default when a workspace has no config', () => {
    // Opting out must be explicit — a tenant that never opens settings should
    // still get the target, not silently have it disabled by omission.
    expect(blogTargetFor({})).toEqual({ enabled: true, perClinicianPerMonth: DEFAULT_BLOG_TARGET_PER_MONTH })
    expect(blogTargetFor({ cadence_policy: {} }).enabled).toBe(true)
    expect(blogTargetFor(null).enabled).toBe(true)
  })

  it('honours an explicit opt-out and an explicit target', () => {
    expect(blogTargetFor({ cadence_policy: { blog_target: { enabled: false } } }).enabled).toBe(false)
    expect(blogTargetFor({ cadence_policy: { blog_target: { per_clinician_per_month: 3 } } }).perClinicianPerMonth).toBe(3)
  })

  it('falls back to the default on a junk or non-positive target', () => {
    for (const bad of [0, -2, 'two', null, undefined, NaN]) {
      expect(blogTargetFor({ cadence_policy: { blog_target: { per_clinician_per_month: bad } } }).perClinicianPerMonth)
        .toBe(DEFAULT_BLOG_TARGET_PER_MONTH)
    }
  })

  it('reads the target from blog_target, NOT from channels', () => {
    // Guards the shape decision: a blog entry under `channels` would be handed
    // weekly slots by mergeSlotsIntoCadence and the Strategist would start
    // planning weekly blog atoms. A target parked there must not be honoured.
    const ws = { cadence_policy: { channels: { blog: { per_clinician_per_month: 9, enabled: true } } } }
    expect(blogTargetFor(ws).perClinicianPerMonth).toBe(DEFAULT_BLOG_TARGET_PER_MONTH)
  })
})

describe('monthKey / dayOfMonth — timezone boundary', () => {
  it('credits a late-night Pacific blog to the month the clinician was in', () => {
    // 2026-08-31 23:30 Pacific is 2026-09-01 06:30 UTC. A UTC-keyed counter
    // would credit this to September — a month its author had already been
    // nudged about for being empty.
    const iso = '2026-09-01T06:30:00Z'
    expect(monthKey(iso, 'America/Los_Angeles')).toBe('2026-08')
    expect(monthKey(iso, 'UTC')).toBe('2026-09')
    expect(dayOfMonth(iso, 'America/Los_Angeles')).toBe(31)
  })

  it('returns empty rather than throwing on an unparseable date', () => {
    expect(monthKey('not-a-date')).toBe('')
    expect(dayOfMonth('not-a-date')).toBe(0)
  })
})

describe('countsTowardMonth', () => {
  const row = (over = {}) => ({ platform: 'blog', status: 'in_review', created_at: '2026-08-12T17:00:00Z', ...over })

  it('counts a blog created in the month', () => {
    expect(countsTowardMonth(row(), '2026-08', 'America/Los_Angeles')).toBe(true)
  })

  it('does not count another month, another platform, or a missing date', () => {
    expect(countsTowardMonth(row(), '2026-07', 'America/Los_Angeles')).toBe(false)
    expect(countsTowardMonth(row({ platform: 'instagram' }), '2026-08', 'America/Los_Angeles')).toBe(false)
    expect(countsTowardMonth(row({ created_at: null }), '2026-08', 'America/Los_Angeles')).toBe(false)
    expect(countsTowardMonth(null, '2026-08')).toBe(false)
  })

  it('does not count a decided-against piece', () => {
    expect(countsTowardMonth(row({ status: 'rejected' }), '2026-08', 'America/Los_Angeles')).toBe(false)
    expect(countsTowardMonth(row({ status: 'archived' }), '2026-08', 'America/Los_Angeles')).toBe(false)
  })

  // The rule that makes the nudge fair. A clinician's contribution is the
  // interview; whether a producer has attached a hero yet is not their work, so
  // an unpublished draft must still count or the nudge blames the wrong person.
  it('counts a draft still awaiting the producer, not just published work', () => {
    for (const status of ['draft', 'in_review', 'approved', 'published']) {
      expect(countsTowardMonth(row({ status }), '2026-08', 'America/Los_Angeles')).toBe(true)
    }
  })
})

describe('progressFor', () => {
  it('reports count/target/met over a mixed set', () => {
    const rows = [
      { platform: 'blog', status: 'approved',  created_at: '2026-08-02T17:00:00Z' },
      { platform: 'blog', status: 'rejected',  created_at: '2026-08-03T17:00:00Z' }, // decided against
      { platform: 'blog', status: 'published', created_at: '2026-07-30T17:00:00Z' }, // last month
      { platform: 'instagram', status: 'approved', created_at: '2026-08-04T17:00:00Z' },
    ]
    expect(progressFor(rows, '2026-08', 1, 'America/Los_Angeles')).toEqual({ count: 1, target: 1, met: true })
    expect(progressFor(rows, '2026-08', 2, 'America/Los_Angeles')).toEqual({ count: 1, target: 2, met: false })
  })

  it('is zero-safe on no rows — the real state of every clinician early in a month', () => {
    expect(progressFor([], '2026-08', 1)).toEqual({ count: 0, target: 1, met: false })
    expect(progressFor(null, '2026-08', 1)).toEqual({ count: 0, target: 1, met: false })
  })
})
