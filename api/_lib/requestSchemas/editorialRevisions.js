// Request-shape validation for GET/POST /api/editorial/revisions.
// See api/_lib/requestSchemas/primitives.js for why this lives apart from
// the LLM-output zod schemas elsewhere in api/_lib/.

import { z } from 'zod'
import { uuid } from './primitives.js'

export const REVISION_SUBJECT_TYPES = ['video', 'slides']

// Shared by GET (?subjectType=&subjectId=) and POST ({subjectType,
// subjectId, ...}) — both paths validate these two fields identically before
// anything else.
export const revisionSubjectSchema = z.object({
  subjectType: z.enum(REVISION_SUBJECT_TYPES),
  subjectId: uuid,
})

// Order mirrors the original short-circuiting `if` chain in revisions.js —
// subjectType is checked (and reported) before subjectId.
export const REVISION_SUBJECT_FIELD_ORDER = ['subjectType', 'subjectId']
export const REVISION_SUBJECT_ERROR_KEYS = {
  subjectType: 'invalid_subject_type',
  subjectId: 'invalid_subject_id',
}

// POST body's `doc` must be a non-null object — matches the original
// `!body.doc || typeof body.doc !== 'object'` check (which, being typeof-
// based, also accepts arrays; z.record()/z.object() would wrongly reject
// them, so this stays a targeted custom check rather than a stricter shape).
export const revisionDocSchema = z.custom((v) => v !== null && typeof v === 'object', {
  message: 'invalid_doc',
})

// POST body's `label` has no rejection path in the original handler — any
// non-string value silently becomes null, and a string is truncated (never
// rejected) to 120 chars. Modeled as a transform, not a validator, so the
// behavior stays a coercion rather than becoming a new 400 case.
export const revisionLabelSchema = z
  .any()
  .transform((v) => (typeof v === 'string' ? v.slice(0, 120) : null))
