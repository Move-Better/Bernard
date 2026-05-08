// Source-clip handoff for the editor.
//
// Routing: GET /api/content-pieces/:id/download-clip
//
// v1 contract (per the Phase 3 plan): NarrateRx does NOT trim source video
// server-side. CapCut / Opus Clip / Submagic already trim well; we just hand
// the editor the source URL and the moment's `source_trim_start..end` range
// so they can scrub to it and trim manually.
//
// Response shape (200):
//   {
//     videoUrl, filename, mimeType, kind,
//     trimStart, trimEnd,            // seconds; may be null when AI didn't
//                                    // produce timestamps (Phase 2 transcript
//                                    // is currently plain text)
//     sourceQuote, aiReasoning,      // editorial context to pre-seed CapCut
//     pieceId, sourceAssetId,
//   }
//
// Auth: any authenticated user (mirrors GET /api/content-pieces/:id, since
// this is a read-only handoff — same data the editor already sees in the
// brief detail, just packaged for one-click open in CapCut).

import { requireRole } from '../../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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
      ...init.headers,
    },
  })
}

const PIECE_SELECT =
  'id,brand,source_asset_id,source_trim_start,source_trim_end,source_quote,ai_reasoning'
const ASSET_SELECT =
  'id,brand,kind,blob_url,blob_pathname,filename,mime_type'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireRole(req)
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const url   = new URL(req.url, 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean)
  const id    = parts[parts.length - 2]
  if (!id) return res.status(400).json({ error: 'Missing id' })

  const brand = brandId()
  const pr = await sb(`content_pieces?id=eq.${id}&brand=eq.${brand}&select=${PIECE_SELECT}`)
  if (!pr.ok) return res.status(500).json({ error: 'Database error' })
  const piece = (await pr.json())[0]
  if (!piece) return res.status(404).json({ error: 'Not found' })

  if (!piece.source_asset_id) return res.status(400).json({ error: 'Brief has no source asset' })

  const ar = await sb(`media_assets?id=eq.${piece.source_asset_id}&brand=eq.${brand}&select=${ASSET_SELECT}`)
  if (!ar.ok) return res.status(500).json({ error: 'Database error loading source' })
  const source = (await ar.json())[0]
  if (!source) return res.status(404).json({ error: 'Source asset not found' })
  if (!source.blob_url) return res.status(400).json({ error: 'Source has no blob_url' })

  return res.status(200).json({
    pieceId:       piece.id,
    sourceAssetId: source.id,
    videoUrl:      source.blob_url,
    filename:      source.filename || source.blob_pathname?.split('/').pop() || null,
    mimeType:      source.mime_type || null,
    kind:          source.kind || null,
    trimStart:     piece.source_trim_start ?? null,
    trimEnd:       piece.source_trim_end ?? null,
    sourceQuote:   piece.source_quote || null,
    aiReasoning:   piece.ai_reasoning || null,
  })
}
