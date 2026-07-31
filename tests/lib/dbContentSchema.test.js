import { describe, it, expect } from 'vitest'
import {
  VALID_STATUSES,
  VALID_PLATFORMS,
  REJECT_REASONS,
  statusSchema,
  statusListSchema,
  platformSchema,
  rejectReasonSchema,
  originSchema,
  targetLocationsSchema,
  modelReasonsSchema,
  modelNoteSchema,
} from '../../api/_lib/requestSchemas/dbContent.js'
import { MODEL_REASON_KEYS, MODEL_NOTE_MAX } from '../../src/lib/modelRating.js'

const A = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
const B = 'a0e7e1c8-0f0a-4a3e-9c1a-2f6f0b7a1234'

describe('requestSchemas/dbContent', () => {
  it('the enums stay a single source of truth (non-vacuity pin, per the repo\'s own contentSelectCoversPatch pattern)', () => {
    expect(VALID_STATUSES.size).toBeGreaterThan(3)
    expect(VALID_PLATFORMS.size).toBeGreaterThan(3)
    expect(REJECT_REASONS.size).toBeGreaterThan(2)
    expect(VALID_STATUSES.has('draft')).toBe(true)
    expect(VALID_PLATFORMS.has('instagram')).toBe(true)
    expect(REJECT_REASONS.has('wrong_visuals')).toBe(true)
  })

  describe('statusSchema (single value, PATCH/POST body)', () => {
    it('accepts every known status', () => {
      for (const s of VALID_STATUSES) expect(statusSchema.safeParse(s).success).toBe(true)
    })
    it('rejects an unknown status', () => {
      expect(statusSchema.safeParse('bogus').success).toBe(false)
    })
  })

  describe('statusListSchema (GET ?status=, comma-separated)', () => {
    it('accepts a single known status', () => {
      expect(statusListSchema.safeParse('draft').success).toBe(true)
    })
    it('accepts a comma-separated list, trimming whitespace per element', () => {
      expect(statusListSchema.safeParse('draft, approved,published').success).toBe(true)
    })
    it('rejects if ANY element in the list is unknown', () => {
      expect(statusListSchema.safeParse('draft,bogus').success).toBe(false)
    })
  })

  describe('platformSchema', () => {
    it('accepts a known platform, rejects an unknown one', () => {
      expect(platformSchema.safeParse('linkedin').success).toBe(true)
      expect(platformSchema.safeParse('myspace').success).toBe(false)
    })
  })

  describe('rejectReasonSchema', () => {
    it('accepts a known reason, rejects everything else including undefined', () => {
      expect(rejectReasonSchema.safeParse('wrong_topic').success).toBe(true)
      expect(rejectReasonSchema.safeParse('because').success).toBe(false)
      expect(rejectReasonSchema.safeParse(undefined).success).toBe(false)
    })
  })

  describe('originSchema', () => {
    it('accepts only the literal "post"', () => {
      expect(originSchema.safeParse('post').success).toBe(true)
      expect(originSchema.safeParse('other').success).toBe(false)
      expect(originSchema.safeParse('').success).toBe(false)
    })
  })

  describe('targetLocationsSchema', () => {
    it('accepts an array of uuids, including an empty array (vacuous every() in the original)', () => {
      expect(targetLocationsSchema.safeParse([A, B]).success).toBe(true)
      expect(targetLocationsSchema.safeParse([]).success).toBe(true)
    })
    it('rejects a non-array or an array containing a non-uuid', () => {
      expect(targetLocationsSchema.safeParse('not-an-array').success).toBe(false)
      expect(targetLocationsSchema.safeParse([A, 'nope']).success).toBe(false)
    })
  })

  describe('modelReasonsSchema', () => {
    it('accepts a subset of the fixed reason-key vocabulary, including empty', () => {
      const [first, second] = [...MODEL_REASON_KEYS]
      expect(modelReasonsSchema.safeParse([first, second]).success).toBe(true)
      expect(modelReasonsSchema.safeParse([]).success).toBe(true)
    })
    it('rejects an array with an unknown reason key', () => {
      expect(modelReasonsSchema.safeParse(['not_a_real_reason']).success).toBe(false)
    })
  })

  describe('modelNoteSchema', () => {
    it('accepts a string up to MODEL_NOTE_MAX chars', () => {
      expect(modelNoteSchema.safeParse('a'.repeat(MODEL_NOTE_MAX)).success).toBe(true)
    })
    it('rejects a string over MODEL_NOTE_MAX chars, and any non-string', () => {
      expect(modelNoteSchema.safeParse('a'.repeat(MODEL_NOTE_MAX + 1)).success).toBe(false)
      expect(modelNoteSchema.safeParse(42).success).toBe(false)
    })
  })
})
