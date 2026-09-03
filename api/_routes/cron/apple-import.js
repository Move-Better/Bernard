// POST /api/cron/apple-import
//
// System trigger to import one Apple Business Connect monthly Insights recap,
// callable from a headless scheduled session with no browser and no Clerk
// sign-in. This is what /bernard-apple-insights runs on a schedule: Apple mails
// the recap, the routine reads the body out of Gmail, and posts it here.
//
// Not on a Vercel cron schedule (it isn't in vercel.json crons) — it lives under
// api/_routes/cron/ only to reuse the Bearer CRON_SECRET auth convention, the
// same way resolve-feedback does.
//
// Shares ALL logic with the Clerk endpoint (/api/integrations/apple/import) via
// _lib/appleImport.js. Nothing about parsing, the row shape, or the upsert is
// reimplemented here — that divergence is exactly the failure this shape avoids.
//
// The tenant is derived FROM the location rather than a Host header, so a
// workspace/location mismatch is structurally impossible on this route.
//
// Auth: Bearer CRON_SECRET.
// Body (JSON):
//   locationId  uuid    required — workspace_locations.id the recap belongs to
//   emailText   string  required — the recap email's plain-text body
//   sentAt      string  optional — the message's date (ISO); fallback for the year
//   subject     string  optional — recorded in raw_extract for traceability
//   preview     bool    optional — parse and return WITHOUT saving

import { verifyCronSecret } from '../../_lib/auth.js'
import {
  UUID_RE,
  parseAppleRecapInput,
  workspaceIdForLocation,
  buildInsightsRow,
  upsertInsightsRow,
  importResult,
} from '../../_lib/appleImport.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'unauthorized' })

  const body = req.body ?? {}
  const locationId = body.locationId == null ? null : String(body.locationId)
  if (!locationId || !UUID_RE.test(locationId)) return res.status(400).json({ error: 'invalid_location_id' })

  const r = await parseAppleRecapInput(body)
  if (r.status === 'missing_pdf') return res.status(400).json({ error: 'missing_text' })
  if (r.status === 'invalid_text_size') return res.status(400).json({ error: 'invalid_text_size' })
  if (r.status !== 'ok') return res.status(422).json({ error: 'parse_failed' })

  const parsed = r.parsed
  if (!parsed.ok) return res.status(422).json({ error: parsed.error || 'parse_failed', warnings: parsed.warnings })

  if (body.preview === true) return res.status(200).json(importResult(parsed, { preview: true }))

  const workspaceId = await workspaceIdForLocation(locationId)
  if (!workspaceId) return res.status(404).json({ error: 'location_not_found' })

  const row = buildInsightsRow({
    workspaceId,
    locationId,
    parsed,
    hasText: r.hasText,
    filename: null,
    subject: body.subject,
  })
  if (!(await upsertInsightsRow(row))) return res.status(500).json({ error: 'save_failed' })

  return res.status(200).json(importResult(parsed, { locationId }))
}

export const config = { runtime: 'nodejs' }
