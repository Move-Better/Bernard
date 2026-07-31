import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  UUID_RE,
  uuid,
  uuidCoerced,
  ISO_DATE_RE,
  isoDateOrTimestamp,
  firstFieldErrorKey,
} from '../../api/_lib/requestSchemas/primitives.js'

const VALID_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6'

describe('requestSchemas/primitives', () => {
  describe('uuid', () => {
    it('accepts a valid lowercase or uppercase uuid string', () => {
      expect(uuid.safeParse(VALID_UUID).success).toBe(true)
      expect(uuid.safeParse(VALID_UUID.toUpperCase()).success).toBe(true)
    })

    it('rejects a malformed string', () => {
      expect(uuid.safeParse('not-a-uuid').success).toBe(false)
      expect(uuid.safeParse('').success).toBe(false)
    })

    it('rejects a non-string value outright (unlike uuidCoerced)', () => {
      expect(uuid.safeParse(12345).success).toBe(false)
      expect(uuid.safeParse(null).success).toBe(false)
      expect(uuid.safeParse(undefined).success).toBe(false)
    })
  })

  describe('uuidCoerced', () => {
    it('accepts a valid uuid string, matching UUID_RE.test(String(x)) semantics', () => {
      expect(uuidCoerced.safeParse(VALID_UUID).success).toBe(true)
    })

    it('rejects a non-uuid value after String() coercion', () => {
      expect(uuidCoerced.safeParse(12345).success).toBe(false)
      expect(uuidCoerced.safeParse(null).success).toBe(false)
      expect(uuidCoerced.safeParse({}).success).toBe(false)
    })
  })

  it('UUID_RE is exported for any legacy .test() call site', () => {
    expect(UUID_RE.test(VALID_UUID)).toBe(true)
    expect(UUID_RE.test('nope')).toBe(false)
  })

  describe('isoDateOrTimestamp', () => {
    it('accepts a bare date and a full ISO timestamp', () => {
      expect(isoDateOrTimestamp.safeParse('2026-07-31').success).toBe(true)
      expect(isoDateOrTimestamp.safeParse('2026-07-31T12:00:00Z').success).toBe(true)
      expect(isoDateOrTimestamp.safeParse('2026-07-31T12:00:00+00:00').success).toBe(true)
    })

    it('rejects a non-date string', () => {
      expect(isoDateOrTimestamp.safeParse('is.null').success).toBe(false)
      expect(isoDateOrTimestamp.safeParse('tomorrow').success).toBe(false)
    })
  })

  it('ISO_DATE_RE is exported for any legacy .test() call site', () => {
    expect(ISO_DATE_RE.test('2026-07-31')).toBe(true)
  })

  describe('firstFieldErrorKey', () => {
    const schema = z.object({ a: z.enum(['x', 'y']), b: uuid })
    const keyMap = { a: 'invalid_a', b: 'invalid_b' }

    it('returns null when the data is valid', () => {
      expect(firstFieldErrorKey(schema, { a: 'x', b: VALID_UUID }, ['a', 'b'], keyMap)).toBeNull()
    })

    it('returns the mapped key for the first field (in `order`) that failed, even if a later field also failed', () => {
      // both a and b are invalid — order says report `a` first
      expect(firstFieldErrorKey(schema, { a: 'z', b: 'nope' }, ['a', 'b'], keyMap)).toBe('invalid_a')
    })

    it('reports the second field when only it is invalid', () => {
      expect(firstFieldErrorKey(schema, { a: 'x', b: 'nope' }, ['a', 'b'], keyMap)).toBe('invalid_b')
    })
  })
})
