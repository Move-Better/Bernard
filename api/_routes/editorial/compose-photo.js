// POST /api/editorial/compose-photo
//
// Photo Compositor P1. Bakes an editorial treatment (graded photo + scrim +
// brand-font headline + author rule) onto a content item's primary photo, on
// the SAME server renderer that publish uses — so preview == publish.
//
// The baked image is written back into content_items.media_urls (the primary
// image entry's url → composite; original preserved as entry.sourceUrl), and
// the treatment spec is persisted so the editor can re-render from the original.
// Because publish ships media_urls as-is, the composite ships automatically.
//
// Body:
//   { pieceId: string, treatment: { headline, headlineSize, grade, aspect, scrim, sourceUrl? } }
//
// Auth: Clerk JWT + workspace org-id check + EDITOR_ROLES.
//
// Response 200: { url, width, height, treatment }
// Errors: 400 / 401 / 403 / 404 / 500.

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { put as blobPut } from '@vercel/blob'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { renderEditorialPhoto } from '../../_lib/brandRender.js'
import { renderWhoopPhoto, WHOOP_TEMPLATE_IDS } from '../../_lib/whoopTemplates.js'

// Templates that render a full card without a source photo.
const NO_PHOTO_TEMPLATES = new Set(['dark-claim', 'light-claim'])

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

function isImageEntry(m) {
  if (!m || typeof m !== 'object') return false
  const t = (m.type || m.kind || '').toLowerCase()
  return !t.startsWith('video')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'ai'))) return

  const body = req.body || {}
  const pieceId = String(body.pieceId || '').trim()
  if (!pieceId) return res.status(400).json({ error: 'pieceId_required' })

  const treatment = (body.treatment && typeof body.treatment === 'object') ? body.treatment : {}

  // Load the content item, scoped to this workspace.
  const itemRes = await sb(
    `content_items?id=eq.${pieceId}&workspace_id=eq.${ws.id}&select=id,media_urls,staff_id,photo_treatment,photo_template_id`,
  )
  if (!itemRes.ok) {
    const txt = await itemRes.text().catch(() => '')
    console.error('[compose-photo] item load failed:', itemRes.status, txt)
    return res.status(500).json({ error: 'db_error' })
  }
  const itemRows = await itemRes.json()
  const item = itemRows?.[0]
  if (!item) return res.status(404).json({ error: 'piece_not_found' })

  // Explicit body.treatment.templateId wins; then fall back to the piece's
  // saved photo_template_id (if it's a WHOOP built-in); then default to 'editorial'.
  const explicitId = treatment.templateId
  const rowTemplateId = WHOOP_TEMPLATE_IDS.includes(item.photo_template_id) ? item.photo_template_id : null
  const templateId = String(explicitId || rowTemplateId || 'editorial')
  const isWhoop = WHOOP_TEMPLATE_IDS.includes(templateId)
  const needsPhoto = !NO_PHOTO_TEMPLATES.has(templateId)

  const mediaUrls = Array.isArray(item.media_urls) ? item.media_urls : []
  // Target a specific IMAGE entry (carousel support). imageIndex counts only
  // image entries and defaults to the first.
  const imageIdxs = mediaUrls.map((m, i) => (isImageEntry(m) ? i : -1)).filter((i) => i >= 0)
  const wantIdx = Number.isInteger(body.imageIndex) ? body.imageIndex : 0
  const primaryIdx = imageIdxs[wantIdx] ?? imageIdxs[0] ?? -1
  const primary = primaryIdx >= 0 ? mediaUrls[primaryIdx] : null

  if (needsPhoto && !primary) {
    return res.status(400).json({ error: 'no_photo', message: 'This template needs a photo. Attach one or use a claim card.' })
  }

  // Always render from the ORIGINAL photo of THIS entry, never a prior composite.
  // May be undefined for a no-photo claim card.
  const sourceUrl = treatment.sourceUrl
    || primary?.sourceUrl
    || primary?.url
    || null
  if (needsPhoto && !sourceUrl) return res.status(400).json({ error: 'no_source_url' })

  // Resolve author name for the lower rule.
  let staffName = ''
  if (item.staff_id) {
    const cRes = await sb(`staff?id=eq.${item.staff_id}&workspace_id=eq.${ws.id}&select=name`)
    if (cRes.ok) {
      const cRows = await cRes.json().catch(() => [])
      staffName = cRows?.[0]?.name || ''
    }
  }

  const fullTreatment = { ...treatment, sourceUrl }

  let render
  try {
    render = isWhoop
      ? await renderWhoopPhoto({ photoUrl: sourceUrl || undefined, treatment: fullTreatment, workspace: ws, staffName })
      : await renderEditorialPhoto({ photoUrl: sourceUrl, treatment: fullTreatment, workspace: ws, staffName })
  } catch (e) {
    console.error('[compose-photo] render failed:', e?.stack || e?.message || e)
    return res.status(500).json({ error: 'render_failed', message: e?.message || 'unknown' })
  }

  // Upload — ws.id (immutable) namespace; timestamp suffix busts the CDN cache
  // so a re-render is visible immediately rather than serving a stale object.
  const pathname = `media/composites/${ws.id}/${pieceId}-${Date.now()}.jpg`
  let blob
  try {
    blob = await blobPut(pathname, render.buffer, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      allowOverwrite: true,
    })
  } catch (e) {
    console.error('[compose-photo] blob upload failed:', e?.stack || e?.message || e)
    return res.status(500).json({ error: 'upload_failed', message: e?.message || 'unknown' })
  }

  // Write the composite back into media_urls (preserve the original source) so
  // the publish path ships the baked image with no further changes. For a
  // no-photo claim card on a post with no media, push a fresh image entry.
  const nextMedia = mediaUrls.slice()
  const composedEntry = {
    ...(primary || { type: 'image', kind: 'image', name: 'composite.jpg' }),
    url: blob.url,
    sourceUrl,
    composed: true,
    width: render.width,
    height: render.height,
    treatment: fullTreatment, // per-entry, so each carousel image remembers its own
  }
  if (primaryIdx >= 0) nextMedia[primaryIdx] = composedEntry
  else nextMedia.unshift(composedEntry)

  const patchRes = await sb(`content_items?id=eq.${pieceId}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      media_urls: nextMedia,
      photo_treatment: fullTreatment,
      photo_composite_url: blob.url,
    }),
  })
  if (!patchRes.ok) {
    const txt = await patchRes.text().catch(() => '')
    console.error('[compose-photo] patch failed:', patchRes.status, txt)
    return res.status(500).json({ error: 'db_error' })
  }

  return res.status(200).json({
    url: blob.url,
    width: render.width,
    height: render.height,
    treatment: fullTreatment,
  })
}
