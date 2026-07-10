// POST /api/editorial/clip-to-broll
//
// Moment Miner — "Library b-roll" output.
//
// Saves a rendered clip as a media_assets broll row and kicks off
// visual-memory indexing so it surfaces in ranked Suggested media.
//
// Body: { assetId, renderedBlobUrl, width?, height?, sizeBytes?, captionText? }
//
// Response 200: { assetId: <new media_assets.id> }
// Errors: 400 / 401 / 403 / 404 / 409 (consent blocked) / 500

export const config = { runtime: 'nodejs' }

import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { saveBroll } from '../../_lib/saveBroll.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sb(path, init = {}) {
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const { assetId, renderedBlobUrl, width, height, sizeBytes, captionText = '', briefId } = req.body || {}
  if (!assetId) return res.status(400).json({ error: 'assetId_required' })
  if (!UUID_RE.test(assetId)) return res.status(400).json({ error: 'invalid_assetId' })
  if (!renderedBlobUrl) return res.status(400).json({ error: 'renderedBlobUrl_required' })

  // Fetch source asset — must belong to this workspace
  const assetRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}&select=id,staff_id,consent_status,filename`
  )
  if (!assetRes.ok) return res.status(500).json({ error: 'db_error' })
  const assets = await assetRes.json()
  const asset = assets?.[0]
  if (!asset) return res.status(404).json({ error: 'asset_not_found' })

  // Consent gate — enforced server-side
  if (asset.consent_status === 'pending') {
    return res.status(409).json({
      error: 'consent_pending',
      message: 'Source asset is awaiting consent. Resolve consent before saving to Library.',
    })
  }
  if (asset.consent_status === 'revoked') {
    return res.status(409).json({
      error: 'consent_revoked',
      message: 'Source asset consent has been revoked. This clip cannot be saved.',
    })
  }

  let savedAssets
  try {
    savedAssets = await saveBroll({
      ws,
      renders: [{ blobUrl: renderedBlobUrl, width: width || null, height: height || null, sizeBytes: sizeBytes || null }],
      staffId: asset.staff_id || null,
      notes: `B-roll clip from asset ${assetId}${captionText ? ` — "${String(captionText).slice(0, 80)}"` : ''}`,
      parentAssetId: assetId,
    })
  } catch (e) {
    console.error('[clip-to-broll] saveBroll failed:', e.message)
    return res.status(500).json({ error: 'insert_failed' })
  }

  const savedAssetId = savedAssets[0]?.id

  // Brief close-out — when this clip was opened from a Media Hub edit brief
  // ("Edit clip in Bernard"), saving it to the Library is the in-app equivalent
  // of the contractor "Upload final" round-trip: stamp the finished asset onto
  // the brief and flip it to 'returned'. Mirrors the return-upload write in
  // recordUploadedAsset.js. Scoped hard — the PATCH filter requires the brief to
  // be in THIS workspace AND to have this exact asset as its source, so a stray
  // or tampered briefId can never touch another brief. An id that matches no row
  // just no-ops (briefReturned=false); a bad save never fails over a brief link.
  let briefReturned = false
  if (briefId && savedAssetId) {
    if (!UUID_RE.test(briefId)) {
      console.warn('[clip-to-broll] ignoring non-UUID briefId')
    } else {
      try {
        const pr = await sb(
          `content_pieces?id=eq.${briefId}&workspace_id=eq.${ws.id}&source_asset_id=eq.${assetId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              final_asset_id: savedAssetId,
              status: 'returned',
              returned_at: new Date().toISOString(),
            }),
          },
        )
        if (pr.ok) {
          const rows = await pr.json().catch(() => [])
          briefReturned = Array.isArray(rows) && rows.length > 0
        } else {
          console.error('[clip-to-broll] brief close PATCH failed:', pr.status)
        }
      } catch (e) {
        console.error('[clip-to-broll] brief close failed:', e?.message)
      }
    }
  }

  return res.status(200).json({ assetId: savedAssetId, briefReturned })
}
