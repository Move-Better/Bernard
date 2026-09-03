import { withSentry } from '../../../_lib/sentry.js'
import { requireRole, requireCapability } from '../../../_lib/auth.js'
import { CAP_INTEGRATIONS_CONNECT } from '../../../_lib/capabilities.js'
import { workspaceContext } from '../../../_lib/workspaceContext.js'
import { enforceLimit } from '../../../_lib/ratelimit.js'
import { parseAppleRecapPdf, parseAppleRecapText, prepareRecapEmailText } from '../../../_lib/appleInsights.js'

// POST /api/integrations/apple/import
//
// Admin uploads a monthly Apple Business Connect Insights recap PDF (one per
// location). We parse the six Core metrics + headline YoY, upsert one row per
// (workspace, location, month), and DISCARD the PDF — extract-only.
//
// Two input shapes, one parser:
//   { pdfBase64, filename?, locationId? }            -- the uploaded recap PDF
//   { emailText, sentAt?, subject?, locationId? }     -- the recap EMAIL's body
//
// The email path exists because Apple mails the recap monthly and the body
// carries the same label-anchored text the PDF's text layer does. It is NOT a
// second parser: both shapes end up in parseAppleRecapText.
//
// `sentAt` is a fallback only. parseAppleRecapText resolves the report YEAR from
// the first "<Month> <D>, <YYYY>" it sees (a recap is always for the PRIOR
// month, so the send date disambiguates a December recap read in January). A PDF
// carries that date in its text; an email body may not, so we append it. Because
// the parser takes the FIRST match, appending can only ever act as a fallback --
// it cannot override a date already present in the body.

export const config = { runtime: 'nodejs' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const MAX_PDF_BYTES = 5 * 1024 * 1024
const MAX_TEXT_CHARS = 200_000

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

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
  const pdfBase64 = body.pdfBase64
  const emailText = body.emailText
  const hasPdf = typeof pdfBase64 === 'string' && pdfBase64.length > 0
  const hasText = typeof emailText === 'string' && emailText.trim().length > 0
  if (!hasPdf && !hasText) return res.status(400).json({ error: 'missing_pdf' })
  if (hasText && emailText.length > MAX_TEXT_CHARS) return res.status(400).json({ error: 'invalid_text_size' })

  let locationId = body.locationId == null ? null : String(body.locationId)
  if (locationId != null && !UUID_RE.test(locationId)) return res.status(400).json({ error: 'invalid_location_id' })

  let parsed
  if (hasText) {
    const text = prepareRecapEmailText(emailText, body.sentAt ?? null)
    try {
      parsed = parseAppleRecapText(text)
    } catch (e) {
      console.error('[apple/import] text parse failed:', e?.message)
      return res.status(422).json({ error: 'parse_failed' })
    }
  } else {
    let buffer
    try {
      buffer = Buffer.from(pdfBase64, 'base64')
    } catch {
      return res.status(400).json({ error: 'invalid_pdf' })
    }
    if (!buffer.length || buffer.length > MAX_PDF_BYTES) return res.status(400).json({ error: 'invalid_pdf_size' })

    try {
      parsed = await parseAppleRecapPdf(buffer)
    } catch (e) {
      console.error('[apple/import] parse failed:', e?.message)
      return res.status(422).json({ error: 'parse_failed' })
    }
  }
  if (!parsed.ok) return res.status(422).json({ error: parsed.error || 'parse_failed', warnings: parsed.warnings })

  // Preview mode — parse and return what we read, WITHOUT saving. The upload
  // card uses this to confirm the numbers before the tenant commits.
  if (body.preview === true) {
    return res.status(200).json({
      ok: true,
      preview: true,
      period: parsed.periodMonth,
      location: parsed.address,
      metrics: parsed.metrics,
      yoy: parsed.yoy,
      warnings: parsed.warnings,
    })
  }

  // Defense-in-depth: a supplied location must belong to THIS workspace.
  if (locationId) {
    const lr = await sb(`workspace_locations?id=eq.${locationId}&workspace_id=eq.${ws.id}&select=id&limit=1`)
    const rows = lr.ok ? await lr.json().catch(() => []) : []
    if (!rows.length) return res.status(400).json({ error: 'invalid_location_id' })
  }

  const row = {
    workspace_id: ws.id,
    location_id: locationId,
    location_label: parsed.address || null,
    period_month: parsed.periodMonth,
    place_card_views: parsed.metrics.placeCardViews,
    taps_from_search: parsed.metrics.tapsFromSearch,
    directions: parsed.metrics.directions,
    photos: parsed.metrics.photos,
    website: parsed.metrics.website,
    call: parsed.metrics.call,
    views_yoy_pct: parsed.yoy.viewsPct,
    taps_yoy_pct: parsed.yoy.tapsPct,
    raw_extract: {
      yoyInteractions: parsed.yoy.interactions,
      warnings: parsed.warnings,
      filename: typeof body.filename === 'string' ? body.filename.slice(0, 200) : null,
      subject: typeof body.subject === 'string' ? body.subject.slice(0, 300) : null,
      parsedAt: new Date().toISOString(),
    },
    source: hasText ? 'email_recap' : 'pdf_recap',
    updated_at: new Date().toISOString(),
  }

  const up = await sb('apple_insights?on_conflict=workspace_id,location_id,period_month', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  })
  if (!up.ok) {
    const t = await up.text().catch(() => '')
    console.error('[apple/import] upsert failed:', up.status, t.slice(0, 300))
    return res.status(500).json({ error: 'save_failed' })
  }

  return res.status(200).json({
    ok: true,
    period: parsed.periodMonth,
    location: parsed.address,
    metrics: parsed.metrics,
    yoy: parsed.yoy,
    warnings: parsed.warnings,
  })
}

export default withSentry(handler)
