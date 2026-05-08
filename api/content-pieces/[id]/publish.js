// Publish dispatcher for one content_piece.
//
// Routing: POST /api/content-pieces/:id/publish
//
// Body shape:
//   { consentConfirmed?: true, stage?: true }
//
// Flow:
//   1. requireRole(['admin','editor']) — same gate as PATCH on the brief.
//   2. Load brief (brand-scoped). Must be status='returned' with final_asset_id.
//   3. Load final + source asset rows. Source asset is needed for the
//      patient-consent gate; final is the actual file we publish.
//   4. Consent gate — if source.patient_pseudonym is set OR
//      source.speaker_role === 'patient_guest', body.consentConfirmed === true
//      is REQUIRED. Otherwise reject with 400 { error: 'consent-required' }.
//      The front-end shows a confirm dialog and resubmits with the flag.
//   5. Resolve target platform — final_target_platform || ai_suggested_platform.
//   6. Dispatch:
//        - 'gbp'        → publishPieceToGbp; stamp status=published, target_id
//        - 'newsletter' → publishPieceToNewsletter; same
//        - reels/feed/story/shorts/tiktok/(other) → stream ZIP bundle to res
//          and stamp status=published BEFORE streaming (idempotent re-download
//          is supported; another publish call regenerates the ZIP).
//
// Runtime: Node (Fluid Compute). archiver + @clerk/backend are not edge-safe.

import { requireRole } from '../../_lib/auth.js'
import { publishPieceToGbp } from '../../_lib/publishToGbp.js'
import { publishPieceToNewsletter } from '../../_lib/publishToNewsletter.js'
import { pipeBundleToResponse } from '../../_lib/buildDownloadBundle.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Bundle platforms have no API publish path; they ship as a ZIP for the
// editor to manually upload to IG/Reels/TikTok/etc.
const BUNDLE_PLATFORMS = new Set(['reels', 'feed', 'story', 'shorts', 'tiktok'])
const API_PLATFORMS    = new Set(['gbp', 'newsletter'])

function brandId() {
  return (process.env.BRAND || process.env.VITE_BRAND || 'people').toLowerCase()
}

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

const PIECE_SELECT =
  'id,brand,source_asset_id,source_trim_start,source_trim_end,source_quote,' +
  'ai_suggested_platform,ai_caption,ai_hashtags,ai_cta_text,ai_reasoning,' +
  'final_caption,final_hashtags,final_cta_text,final_cta_url,target_platform,' +
  'final_asset_id,status,notes'

const ASSET_SELECT =
  'id,brand,kind,status,blob_url,blob_pathname,filename,mime_type,size_bytes,' +
  'patient_pseudonym,speaker_role'

async function loadPiece(id, brand) {
  const r = await sb(`content_pieces?id=eq.${id}&brand=eq.${brand}&select=${PIECE_SELECT}`)
  if (!r.ok) throw new Error('Database error loading piece')
  const rows = await r.json()
  return rows[0] || null
}

async function loadAsset(id, brand) {
  if (!id) return null
  const r = await sb(`media_assets?id=eq.${id}&brand=eq.${brand}&select=${ASSET_SELECT}`)
  if (!r.ok) throw new Error('Database error loading asset')
  const rows = await r.json()
  return rows[0] || null
}

async function markPublished(pieceId, brand, targetId) {
  const body = {
    status: 'published',
    published_at: new Date().toISOString(),
    published_target_id: targetId,
  }
  await sb(`content_pieces?id=eq.${pieceId}&brand=eq.${brand}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

function needsConsentGate(sourceAsset) {
  if (!sourceAsset) return false
  if (sourceAsset.speaker_role === 'patient_guest') return true
  if (sourceAsset.patient_pseudonym && String(sourceAsset.patient_pseudonym).trim()) return true
  return false
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireRole(req, ['admin', 'editor'])
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // /api/content-pieces/:id/publish — id is the second-to-last segment.
  const url   = new URL(req.url, 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean)
  const id    = parts[parts.length - 2]
  if (!id) return res.status(400).json({ error: 'Missing id' })

  const brand = brandId()
  const piece = await loadPiece(id, brand)
  if (!piece) return res.status(404).json({ error: 'Not found' })

  if (piece.status !== 'returned' && piece.status !== 'published') {
    return res.status(400).json({
      error: 'Brief must be in "returned" status before publishing — upload the finished file first',
      status: piece.status,
    })
  }

  if (!piece.final_asset_id) {
    return res.status(400).json({ error: 'Brief has no final_asset_id — upload the finished file first' })
  }

  const finalAsset = await loadAsset(piece.final_asset_id, brand)
  if (!finalAsset) return res.status(404).json({ error: 'Final asset not found' })
  if (!finalAsset.blob_url) return res.status(400).json({ error: 'Final asset has no blob_url' })

  const sourceAsset = await loadAsset(piece.source_asset_id, brand)
  // Consent gate: surfaces the same risk PR 1's amber warning surfaces in the
  // brief detail. Front-end resubmits with consentConfirmed=true after the
  // editor confirms the dialog. We don't persist the confirmation — the audit
  // is the published_at + actor stamp on the row.
  if (needsConsentGate(sourceAsset) && req.body?.consentConfirmed !== true) {
    return res.status(400).json({
      error: 'consent-required',
      message: 'This source involves a patient. Confirm written or recorded consent before publishing.',
      requiresConsentConfirmation: true,
      patient: sourceAsset?.patient_pseudonym || null,
      speakerRole: sourceAsset?.speaker_role || null,
    })
  }

  const target = piece.target_platform || piece.ai_suggested_platform
  if (!target) {
    return res.status(400).json({ error: 'Brief has no target_platform set' })
  }

  // ── GBP ────────────────────────────────────────────────────────────────
  if (target === 'gbp') {
    try {
      const result = await publishPieceToGbp({ piece, finalAsset })
      await markPublished(piece.id, brand, result.postId)
      return res.status(200).json({
        ok: true,
        target,
        publishedTargetId: result.postId,
        posted: result.posted,
        failed: result.failed,
      })
    } catch (e) {
      return res.status(502).json({ error: 'gbp-publish-failed', message: e?.message || 'GBP publish failed' })
    }
  }

  // ── Newsletter (TDC handoff) ──────────────────────────────────────────
  if (target === 'newsletter') {
    try {
      const result = await publishPieceToNewsletter({ piece, finalAsset })
      await markPublished(piece.id, brand, result.targetId)
      return res.status(200).json({
        ok: true,
        target,
        publishedTargetId: result.targetId,
        contentItemId: result.contentItemId,
        message: 'Staged in content_items for TDC copy-paste. Open the Content Hub to review and send.',
      })
    } catch (e) {
      return res.status(500).json({ error: 'newsletter-stage-failed', message: e?.message || 'Newsletter stage failed' })
    }
  }

  // ── ZIP bundle (reels / feed / story / shorts / tiktok / unknown) ─────
  if (BUNDLE_PLATFORMS.has(target) || !API_PLATFORMS.has(target)) {
    // Mark BEFORE streaming. The response is committed once the first ZIP
    // byte goes out, so we can't update the row mid-stream. Re-publishing
    // (re-downloading the bundle) is intentionally idempotent.
    const targetId = `download-bundle:${target}:${new Date().toISOString()}`
    await markPublished(piece.id, brand, targetId)

    try {
      await pipeBundleToResponse({
        res,
        piece,
        finalAsset,
        brand,
        dateIso: new Date().toISOString(),
      })
      // pipeBundleToResponse calls res.end via archiver.finalize → pipe.
      return
    } catch (e) {
      // If we haven't written headers yet, surface a JSON error. Once the
      // pipe started, archiver-side errors destroy the response.
      if (!res.headersSent) {
        return res.status(502).json({ error: 'bundle-failed', message: e?.message || 'Bundle stream failed' })
      }
      console.error('[publish] bundle stream error after headers:', e?.message)
    }
    return
  }

  return res.status(400).json({ error: `Unsupported target_platform: ${target}` })
}
