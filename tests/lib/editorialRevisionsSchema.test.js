import { describe, it, expect } from 'vitest'
import {
  revisionSubjectSchema,
  revisionDocSchema,
  revisionLabelSchema,
} from '../../api/_lib/requestSchemas/editorialRevisions.js'

const VALID_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6'

describe('requestSchemas/editorialRevisions', () => {
  describe('revisionSubjectSchema', () => {
    it('accepts video/slides + a valid uuid', () => {
      expect(revisionSubjectSchema.safeParse({ subjectType: 'video', subjectId: VALID_UUID }).success).toBe(true)
      expect(revisionSubjectSchema.safeParse({ subjectType: 'slides', subjectId: VALID_UUID }).success).toBe(true)
    })

    it('rejects a subjectType outside the fixed enum', () => {
      const r = revisionSubjectSchema.safeParse({ subjectType: 'photo', subjectId: VALID_UUID })
      expect(r.success).toBe(false)
      expect(r.error.issues.some((i) => i.path[0] === 'subjectType')).toBe(true)
    })

    it('rejects a malformed subjectId', () => {
      const r = revisionSubjectSchema.safeParse({ subjectType: 'video', subjectId: 'not-a-uuid' })
      expect(r.success).toBe(false)
      expect(r.error.issues.some((i) => i.path[0] === 'subjectId')).toBe(true)
    })
  })

  describe('revisionDocSchema', () => {
    it('accepts a plain object and an array (typeof both is "object", matching the original check)', () => {
      expect(revisionDocSchema.safeParse({ ops: [] }).success).toBe(true)
      expect(revisionDocSchema.safeParse([1, 2, 3]).success).toBe(true)
    })

    it('rejects null, undefined, and primitives', () => {
      expect(revisionDocSchema.safeParse(null).success).toBe(false)
      expect(revisionDocSchema.safeParse(undefined).success).toBe(false)
      expect(revisionDocSchema.safeParse('a string').success).toBe(false)
      expect(revisionDocSchema.safeParse(0).success).toBe(false)
      expect(revisionDocSchema.safeParse(false).success).toBe(false)
    })
  })

  describe('revisionLabelSchema', () => {
    it('passes a string through, truncated to 120 chars — never rejects', () => {
      expect(revisionLabelSchema.parse('short')).toBe('short')
      const long = 'x'.repeat(200)
      expect(revisionLabelSchema.parse(long)).toBe('x'.repeat(120))
    })

    it('coerces any non-string value to null', () => {
      expect(revisionLabelSchema.parse(undefined)).toBeNull()
      expect(revisionLabelSchema.parse(null)).toBeNull()
      expect(revisionLabelSchema.parse(42)).toBeNull()
      expect(revisionLabelSchema.parse({})).toBeNull()
    })
  })
})
