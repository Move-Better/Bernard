import { describe, it, expect } from 'vitest'
import {
  formatStoryDate,
  stripStoryDatePrefix,
  formatStoryDisplayTitle,
} from '../../src/lib/storyTitle.js'

// ── formatStoryDate ──────────────────────────────────────────────────────────

describe('formatStoryDate', () => {
  it('renders UTC MM/DD/YY with zero-padding', () => {
    expect(formatStoryDate('2026-01-05T00:00:00Z')).toBe('01/05/26')
    expect(formatStoryDate('2026-07-10T15:00:00Z')).toBe('07/10/26')
  })

  it('returns empty string on an invalid date', () => {
    expect(formatStoryDate('not-a-date')).toBe('')
  })
})

// ── stripStoryDatePrefix ─────────────────────────────────────────────────────

describe('stripStoryDatePrefix', () => {
  it('strips a leading MM/DD/YY em-dash prefix', () => {
    expect(stripStoryDatePrefix('07/10/26 — Hip and shoulder')).toBe('Hip and shoulder')
  })

  it('strips en-dash and hyphen separators too', () => {
    expect(stripStoryDatePrefix('03/04/26 – En dash')).toBe('En dash')
    expect(stripStoryDatePrefix('01/02/26 - Hyphen')).toBe('Hyphen')
  })

  it('strips the long-form month-name date used by legacy auto-titles', () => {
    expect(stripStoryDatePrefix('July 10, 2026 — Hip and shoulder')).toBe('Hip and shoulder')
    expect(stripStoryDatePrefix('Jan. 5, 2026 – Abbreviated month')).toBe('Abbreviated month')
  })

  it('strips lenient numeric variants (1-2 digit, 2-4 year)', () => {
    expect(stripStoryDatePrefix('7/5/2026 — Single digits')).toBe('Single digits')
  })

  it('leaves an un-dated subject untouched (including a plain month word)', () => {
    expect(stripStoryDatePrefix('Just a subject')).toBe('Just a subject')
    expect(stripStoryDatePrefix('July recap of the quarter')).toBe('July recap of the quarter')
  })

  it('is idempotent and null-safe', () => {
    expect(stripStoryDatePrefix(stripStoryDatePrefix('07/10/26 — X'))).toBe('X')
    expect(stripStoryDatePrefix(null)).toBe('')
    expect(stripStoryDatePrefix(undefined)).toBe('')
  })
})

// ── formatStoryDisplayTitle ──────────────────────────────────────────────────

describe('formatStoryDisplayTitle', () => {
  it('prepends the created_at date to a pure subject', () => {
    expect(
      formatStoryDisplayTitle({ topic: 'Hip and shoulder', created_at: '2026-07-10T15:00:00Z' }),
    ).toBe('07/10/26 — Hip and shoulder')
  })

  it('does not double-prefix a topic that already bakes in a date (outbound call path)', () => {
    expect(
      formatStoryDisplayTitle({ topic: '07/10/26 — Hip and shoulder', created_at: '2026-07-10T15:00:00Z' }),
    ).toBe('07/10/26 — Hip and shoulder')
  })

  it('always dates from created_at, ignoring a stale baked-in date', () => {
    expect(
      formatStoryDisplayTitle({ topic: '07/09/26 — Late call', created_at: '2026-07-10T01:00:00Z' }),
    ).toBe('07/10/26 — Late call')
  })

  it('falls back to a subject for an empty topic', () => {
    expect(
      formatStoryDisplayTitle({ topic: '', created_at: '2026-07-10T15:00:00Z' }),
    ).toBe('07/10/26 — Untitled interview')
  })

  it('honors a custom fallback', () => {
    expect(
      formatStoryDisplayTitle({ topic: null, created_at: '2026-07-10T15:00:00Z' }, { fallback: 'Weekly call' }),
    ).toBe('07/10/26 — Weekly call')
  })

  it('renders the bare subject when created_at is missing (never defaults to today)', () => {
    expect(formatStoryDisplayTitle({ topic: 'No date' })).toBe('No date')
  })

  it('renders the bare subject when created_at is invalid', () => {
    expect(formatStoryDisplayTitle({ topic: 'Bad date', created_at: 'nope' })).toBe('Bad date')
  })

  it('falls back to a title field when topic is absent', () => {
    expect(
      formatStoryDisplayTitle({ title: 'From title', created_at: '2026-07-10T15:00:00Z' }),
    ).toBe('07/10/26 — From title')
  })
})
