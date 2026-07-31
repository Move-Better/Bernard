// Shared zod building blocks for HTTP REQUEST validation (query params, path
// params, PATCH/POST bodies) in api/_routes/**  and api/**  handlers.
//
// This is a DIFFERENT concern from the zod schemas already used across the
// repo in api/_lib/momentExtract.js, scoreMoments.js, segmentDetect.js, etc.
// — those describe the shape of an LLM's `generateObject` structured output
// and live next to the prompt/model code that produces it. Nothing here is
// ever passed to `generateObject`, and nothing there validates a request.
// Keep the two uses in separate files so "zod schema" always tells you which
// kind you're looking at from the import path alone.
//
// Before this file, every handler that needed to validate a uuid path/query
// param or a date string re-declared its own regex (132 files match
// `UUID_RE` as of 2026-07-31) — see the CLAUDE.md `UUID_RE` handler-checklist
// rule. These are the same patterns, centralized so new handlers import a
// schema instead of retyping a regex.

import { z } from 'zod'

// Matches the `UUID_RE` regex duplicated across ~130 handlers (see the API
// handler checklist in CLAUDE.md, rule #2).
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A uuid value that is already expected to be a string (query params, path
// params, scalar body fields). Rejects non-strings outright.
export const uuid = z.string().regex(UUID_RE)

// A uuid value coming from an array whose elements aren't guaranteed to be
// strings (e.g. a JSON body array). Coerces with String(...) before testing,
// matching the `UUID_RE.test(String(x))` pattern used for array-of-id checks
// (e.g. content_items.PATCH's targetLocations) — so a non-string element
// fails validation the same way it always has, rather than being rejected
// for a different reason (wrong type vs. not-a-uuid).
export const uuidCoerced = z.custom((v) => UUID_RE.test(String(v)), { message: 'invalid_uuid' })

// Accepts a date (YYYY-MM-DD) or a full ISO timestamp — mirrors the
// `ISO_DATE_RE` used by api/_routes/db/content.js to guard the from/to range
// filters and scheduledAt before they reach a PostgREST query string.
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/
export const isoDateOrTimestamp = z.string().regex(ISO_DATE_RE)

/**
 * Parse `data` against an object `schema` and return the legacy error key
 * for the FIRST field (in `order`) that failed — not just the first issue
 * zod happens to report. This is what lets a single declarative schema
 * replace a chain of short-circuiting `if (!x) return err(...)` checks
 * without changing which error a caller sees first: `order` should list
 * fields in the same sequence the old `if` chain checked them, and `keyMap`
 * maps each field name to the exact error string the endpoint already
 * returns (so the response body is byte-identical to before).
 *
 * Returns `null` when `data` is valid.
 */
export function firstFieldErrorKey(schema, data, order, keyMap) {
  const result = schema.safeParse(data)
  if (result.success) return null
  for (const field of order) {
    if (result.error.issues.some((issue) => issue.path[0] === field)) return keyMap[field]
  }
  // Fallback for a field not listed in `order` (shouldn't happen if `order`
  // covers every key in `schema`, but fail loud rather than return undefined).
  const fallbackField = result.error.issues[0]?.path[0]
  return keyMap[fallbackField] ?? 'invalid_request'
}
