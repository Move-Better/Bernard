// Request-shape validation for POST/DELETE /api/collections/items.
// See api/_lib/requestSchemas/primitives.js for why this lives apart from
// the LLM-output zod schemas elsewhere in api/_lib/.

import { z } from 'zod'
import { UUID_RE } from './primitives.js'

// `assetIds` (POST body / DELETE body fallback) is normalized, not rejected:
// a non-array becomes [] (matches `Array.isArray(x) ? x : []`), then every
// falsy entry is dropped, then every entry that isn't a valid uuid (coerced
// through String(...), same as the original `UUID_RE.test(String(id))`) is
// dropped too. The caller decides what an EMPTY result means (400 vs. a
// no-op) — this schema only produces the cleaned list.
export const assetIdListSchema = z
  .preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown()))
  .transform((arr) => arr.filter(Boolean).filter((id) => UUID_RE.test(String(id))))
