import { describe, it, expect } from 'vitest'
import { assetIdListSchema } from '../../api/_lib/requestSchemas/collectionsItems.js'

const A = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
const B = 'a0e7e1c8-0f0a-4a3e-9c1a-2f6f0b7a1234'

describe('requestSchemas/collectionsItems: assetIdListSchema', () => {
  it('keeps only valid uuids, dropping non-uuid entries silently (never rejects)', () => {
    expect(assetIdListSchema.parse([A, 'garbage', B])).toEqual([A, B])
  })

  it('drops falsy entries before the uuid check (Boolean filter)', () => {
    expect(assetIdListSchema.parse([A, null, undefined, '', 0, B])).toEqual([A, B])
  })

  it('coerces non-string elements the same way UUID_RE.test(String(x)) would', () => {
    // a number can never look like a uuid, so it's dropped — same as before
    expect(assetIdListSchema.parse([A, 12345])).toEqual([A])
  })

  it('normalizes a non-array input to an empty list', () => {
    expect(assetIdListSchema.parse(undefined)).toEqual([])
    expect(assetIdListSchema.parse(null)).toEqual([])
    expect(assetIdListSchema.parse('not-an-array')).toEqual([])
    expect(assetIdListSchema.parse({})).toEqual([])
  })

  it('an all-invalid array reduces to an empty list, not a rejection', () => {
    expect(assetIdListSchema.parse(['x', 'y', null])).toEqual([])
  })
})
