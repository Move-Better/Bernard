// Request-shape validation for /api/db/content — the GET list's query
// params, the POST insert paths' scalar/id fields, and the PATCH body's
// scalar/enum fields. See api/_lib/requestSchemas/primitives.js for why
// this lives apart from the LLM-output zod schemas elsewhere in api/_lib/.
//
// VALID_STATUSES / VALID_PLATFORMS / REJECT_REASONS are allowlists for
// values interpolated into PostgREST query strings — without them, a
// crafted value like `draft,approved)&limit=10000` could break out of the
// intended clause and override server-side constraints. They're the single
// source of truth for this route: api/_routes/db/content.js imports them
// (and the schemas derived from them below) rather than re-declaring local
// Sets/regexes that could drift. The one exception left untouched by this
// pass is content.js's POST bulk-insert ownership lookups against
// Supabase (ck = await sb(`interviews?id=in.(${ids})...`)) — those are
// business logic, not request-shape validation, so they're out of scope
// here even though the id values they consume ARE validated via the
// schemas below first.

import { z } from 'zod'
import { uuidCoerced, isoDateOrTimestamp } from './primitives.js'
import { MODEL_REASON_KEYS, MODEL_NOTE_MAX } from '../../../src/lib/modelRating.js'

export const VALID_STATUSES = new Set(['draft', 'in_review', 'approved', 'published', 'scheduled', 'rejected'])
// T4 learning loop — fixed reason enum for a hard reject (see migration 180).
export const REJECT_REASONS = new Set(['wrong_visuals', 'wrong_words', 'wrong_topic', 'wrong_timing', 'other'])
export const VALID_PLATFORMS = new Set([
  // atom-namespace keys (ATOM_DEFINITIONS in api/_lib/atomPlan.js)
  'instagram', 'linkedin', 'facebook', 'gbp', 'tiktok', 'twitter',
  'threads', 'bluesky', 'mastodon',
  // single-output platforms
  'blog', 'email', 'landing_page', 'youtube', 'youtube_short',
  'google_ads', 'instagram_ads', 'ig_ads', 'instagram_post', 'instagram_reel',
])

// A single status value (PATCH body).
export const statusSchema = z.custom((v) => VALID_STATUSES.has(v), { message: 'invalid_status' })

// GET's `status` query param accepts a comma-separated list; every member
// must be a known status once trimmed — mirrors
// `status.split(',').some((s) => !VALID_STATUSES.has(s.trim()))`.
export const statusListSchema = z
  .string()
  .refine((s) => s.split(',').every((part) => VALID_STATUSES.has(part.trim())), { message: 'invalid_status_list' })

export const platformSchema = z.custom((v) => VALID_PLATFORMS.has(v), { message: 'invalid_platform' })

export const rejectReasonSchema = z.custom((v) => REJECT_REASONS.has(v), { message: 'invalid_reject_reason' })

// GET's `origin` query param has exactly one meaningful non-empty value.
export const originSchema = z.literal('post')

// PATCH's `targetLocations` — an array of location ids. String(...)-coerced
// per element, matching `targetLocations.every((lid) => UUID_RE.test(String(lid)))`.
export const targetLocationsSchema = z.array(uuidCoerced)

// PATCH's `modelReasons` — an array of fixed reason keys (src/lib/modelRating.js).
export const modelReasonsSchema = z.array(z.custom((v) => MODEL_REASON_KEYS.has(v), { message: 'invalid_model_reason' }))

// PATCH's `modelNote` — a free-text string capped at MODEL_NOTE_MAX.
export const modelNoteSchema = z.string().max(MODEL_NOTE_MAX)

// PATCH's `scheduledAt` — re-exported for a single import site in content.js.
export const scheduledAtSchema = isoDateOrTimestamp
