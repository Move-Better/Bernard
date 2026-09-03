// Shared core for importing an Apple Business Connect monthly Insights recap.
//
// Two routes call this and MUST stay identical in behaviour:
//   POST /api/integrations/apple/import  — Clerk admin, the Settings upload card
//   POST /api/cron/apple-import          — Bearer CRON_SECRET, the monthly routine
//
// It lives here rather than inline in a handler for the reason the Buffer/bundle
// publish split taught us: two hand-synced copies of "the same" logic diverge,
// and the divergence is silent. A fix applied to one is not a fix to the other.
//
// Extract-only: the PDF/email text is parsed and DISCARDED. We store numbers.

import { parseAppleRecapPdf, parseAppleRecapText, prepareRecapEmailText } from './appleInsights.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_PDF_BYTES = 5 * 1024 * 1024
const MAX_TEXT_CHARS = 200_000

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

export { UUID_RE, MAX_TEXT_CHARS }

// Parse a recap from either input shape. Returns the parser's own result, or a
// { status } describing why we could not even get that far.
export async function parseAppleRecapInput({ pdfBase64, emailText, sentAt }) {
  const hasPdf = typeof pdfBase64 === 'string' && pdfBase64.length > 0
  const hasText = typeof emailText === 'string' && emailText.trim().length > 0

  if (!hasPdf && !hasText) return { status: 'missing_pdf' }
  if (hasText && emailText.length > MAX_TEXT_CHARS) return { status: 'invalid_text_size' }

  if (hasText) {
    try {
      return { status: 'ok', hasText: true, parsed: parseAppleRecapText(prepareRecapEmailText(emailText, sentAt ?? null)) }
    } catch (e) {
      console.error('[appleImport] text parse failed:', e?.message)
      return { status: 'parse_failed' }
    }
  }

  let buffer
  try {
    buffer = Buffer.from(pdfBase64, 'base64')
  } catch {
    return { status: 'invalid_pdf' }
  }
  if (!buffer.length || buffer.length > MAX_PDF_BYTES) return { status: 'invalid_pdf_size' }

  try {
    return { status: 'ok', hasText: false, parsed: await parseAppleRecapPdf(buffer) }
  } catch (e) {
    console.error('[appleImport] pdf parse failed:', e?.message)
    return { status: 'parse_failed' }
  }
}

// Confirm a location belongs to this workspace. Callers pass a location that
// arrived over the wire, so this is the authorization boundary, not a nicety:
// without it one tenant could write an insights row onto another's location.
export async function locationBelongsToWorkspace(locationId, workspaceId) {
  const r = await sb(`workspace_locations?id=eq.${locationId}&workspace_id=eq.${workspaceId}&select=id&limit=1`)
  const rows = r.ok ? await r.json().catch(() => []) : []
  return rows.length > 0
}

// Look up which workspace owns a location. The cron route has no Host header to
// resolve a tenant from, so the location IS the tenant key — which also makes a
// workspace/location mismatch structurally impossible there.
export async function workspaceIdForLocation(locationId) {
  const r = await sb(`workspace_locations?id=eq.${locationId}&select=workspace_id&limit=1`)
  const rows = r.ok ? await r.json().catch(() => []) : []
  return rows.length ? rows[0].workspace_id : null
}

export function buildInsightsRow({ workspaceId, locationId, parsed, hasText, filename, subject }) {
  return {
    workspace_id: workspaceId,
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
      filename: typeof filename === 'string' ? filename.slice(0, 200) : null,
      subject: typeof subject === 'string' ? subject.slice(0, 300) : null,
      parsedAt: new Date().toISOString(),
    },
    source: hasText ? 'email_recap' : 'pdf_recap',
    updated_at: new Date().toISOString(),
  }
}

export async function upsertInsightsRow(row) {
  const up = await sb('apple_insights?on_conflict=workspace_id,location_id,period_month', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  })
  if (!up.ok) {
    const t = await up.text().catch(() => '')
    console.error('[appleImport] upsert failed:', up.status, t.slice(0, 300))
    return false
  }
  return true
}

// What both routes return on success, and what preview returns without saving.
export function importResult(parsed, extra = {}) {
  return {
    ok: true,
    ...extra,
    period: parsed.periodMonth,
    location: parsed.address,
    metrics: parsed.metrics,
    yoy: parsed.yoy,
    warnings: parsed.warnings,
  }
}
