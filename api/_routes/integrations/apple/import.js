import { withSentry } from '../../../_lib/sentry.js'
import { requireRole, requireCapability } from '../../../_lib/auth.js'
import { CAP_INTEGRATIONS_CONNECT } from '../../../_lib/capabilities.js'
import { workspaceContext } from '../../../_lib/workspaceContext.js'
import { enforceLimit } from '../../../_lib/ratelimit.js'
import {
  UUID_RE,
  parseAppleRecapInput,
  locationBelongsToWorkspace,
  buildInsightsRow,
  upsertInsightsRow,
  importResult,
} from '../../../_lib/appleImport.js'

// POST /api/integrations/apple/import
//
// Admin uploads a monthly Apple Business Connect Insights recap (one per
// location). We parse the six Core metrics + headline YoY, upsert one row per
// (workspace, location, month), and DISCARD the source — extract-only.
//
// Two input shapes, one parser:
//   { pdfBase64, filename?, locationId? }          -- the uploaded recap PDF
//   { emailText, sentAt?, subject?, locationId? }   -- the recap EMAIL's body
//
// All parsing, the location check, the row shape and the upsert live in
// _lib/appleImport.js, shared verbatim with POST /api/cron/apple-import (the
// headless monthly routine). This handler is auth + HTTP status mapping only.

export const config = { runtime: 'nodejs' }

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const cap = await requireCapability(req, ws, [CAP_INTEGRATIONS_CONNECT])
  if (!cap.ok) return res.status(403).json({ error: cap.reason, missing: cap.missing })

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const body = req.body || {}

  let locationId = body.locationId == null ? null : String(body.locationId)
  if (locationId != null && !UUID_RE.test(locationId)) return res.status(400).json({ error: 'invalid_location_id' })

  const r = await parseAppleRecapInput(body)
  if (r.status === 'missing_pdf') return res.status(400).json({ error: 'missing_pdf' })
  if (r.status === 'invalid_text_size') return res.status(400).json({ error: 'invalid_text_size' })
  if (r.status === 'invalid_pdf') return res.status(400).json({ error: 'invalid_pdf' })
  if (r.status === 'invalid_pdf_size') return res.status(400).json({ error: 'invalid_pdf_size' })
  if (r.status !== 'ok') return res.status(422).json({ error: 'parse_failed' })

  const parsed = r.parsed
  if (!parsed.ok) return res.status(422).json({ error: parsed.error || 'parse_failed', warnings: parsed.warnings })

  // Preview mode — parse and return what we read, WITHOUT saving. The upload
  // card uses this to confirm the numbers before the tenant commits.
  if (body.preview === true) return res.status(200).json(importResult(parsed, { preview: true }))

  // Defense-in-depth: a supplied location must belong to THIS workspace.
  if (locationId && !(await locationBelongsToWorkspace(locationId, ws.id))) {
    return res.status(400).json({ error: 'invalid_location_id' })
  }

  const row = buildInsightsRow({
    workspaceId: ws.id,
    locationId,
    parsed,
    hasText: r.hasText,
    filename: body.filename,
    subject: body.subject,
  })
  if (!(await upsertInsightsRow(row))) return res.status(500).json({ error: 'save_failed' })

  return res.status(200).json(importResult(parsed))
}

export default withSentry(handler)
