// POST /api/editorial/youtube-create
//
// Create the content_items row for the Library's "publish it whole" YouTube
// lane. The source video is attached AS-IS — no render, no trim, no re-encode —
// because this lane exists for footage that is already finished.
//
// Body: { assetId, title, description }
// 200:  { contentItemId }
// 400 / 401 / 403 / 404 / 409 (consent blocked) / 413 (file too large) / 500
//
// The row is created status='approved' with interview_id null. That is a
// DOCUMENTED pass in the words-approval gate (api/_lib/wordsApprovalGate.js) —
// the same exemption Moment Miner package content uses — because the publish
// dialog itself is the human checkpoint: the operator reads the exact title and
// description before confirming. The caller then publishes through the normal
// /api/publish/social route, which owns the dispatch claim and the terminal
// status commit; this handler deliberately does NOT publish, so there is only
// ever one publish path to keep correct.
//
// format stays null: content_items.format's CHECK allows only
// post/carousel/reel/story, and buildDataBlock's YOUTUBE branch keys off the
// platform id (youtube vs youtube_short), not the format.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { supabaseRest } from '../../_lib/supabaseRest.js'
import { isYouTubeEligible, checkYouTubeUploadSize } from '../../_lib/youtubeCopy.js'
import { YOUTUBE_TITLE_MAX, YOUTUBE_DESCRIPTION_MAX } from '../../_lib/social/bundlePublisher.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const sb = (path, init = {}) =>
  supabaseRest(path, init, { contentType: 'application/json', prefer: 'return=representation' })

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const body = req.body || {}
  const assetId = body.assetId ? String(body.assetId) : ''
  if (!assetId) return res.status(400).json({ error: 'assetId_required' })
  if (!UUID_RE.test(assetId)) return res.status(400).json({ error: 'invalid_assetId' })

  const title = String(body.title || '').trim().slice(0, YOUTUBE_TITLE_MAX)
  const description = String(body.description || '').trim().slice(0, YOUTUBE_DESCRIPTION_MAX)
  if (!title) return res.status(400).json({ error: 'title_required' })

  const aRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${ws.id}` +
      `&select=id,kind,width,height,blob_url,thumbnail_url,archived_at,size_bytes,staff_id,consent_status&limit=1`,
  )
  if (!aRes.ok) {
    console.error('[youtube-create] asset lookup failed:', aRes.status)
    return res.status(500).json({ error: 'db_error' })
  }
  const asset = (await aRes.json())?.[0]
  if (!asset) return res.status(404).json({ error: 'asset_not_found' })
  if (!isYouTubeEligible(asset)) return res.status(400).json({ error: 'not_eligible' })

  // Consent gate — enforced server-side, mirroring clip-to-post. These are
  // patient interviews; a revoked release must not reach a public channel even
  // if a stale tab still shows the button.
  if (asset.consent_status === 'pending') {
    return res.status(409).json({ error: 'consent_pending' })
  }
  if (asset.consent_status === 'revoked') {
    return res.status(409).json({ error: 'consent_revoked' })
  }

  // Size is checked here as well as in the dialog: the dialog's copy explains
  // it, but the server is what actually has to hold, since a stale client would
  // otherwise burn a ~100s upload before bundle's gateway times it out.
  const size = checkYouTubeUploadSize(asset)
  if (!size.ok) {
    return res.status(413).json({
      error: 'file_too_large',
      sizeBytes: size.sizeBytes,
      maxBytes: size.maxBytes,
    })
  }

  const row = {
    workspace_id: ws.id,
    platform:     'youtube',
    status:       'approved',
    approved_at:  new Date().toISOString(),
    seo_title:    title,
    content:      description,
    media_urls:   [{
      url:          asset.blob_url,
      type:         'video',
      kind:         'video',
      mediaAssetId: asset.id,
      ...(asset.thumbnail_url ? { thumbnailUrl: asset.thumbnail_url } : {}),
    }],
    staff_id:     asset.staff_id || null,
    // CHECK allows only 'bernard' | 'human' — the operator picked this exact
    // video out of the Library by hand, so it is human-sourced media.
    media_source: 'human',
    notes:        `Full-length video published from the Library (asset ${asset.id})`,
  }

  const insRes = await sb('content_items', { method: 'POST', body: JSON.stringify(row) })
  if (!insRes.ok) {
    const text = await insRes.text().catch(() => '')
    console.error('[youtube-create] insert failed:', insRes.status, text)
    return res.status(500).json({ error: 'insert_failed' })
  }
  const contentItemId = (await insRes.json())?.[0]?.id
  if (!contentItemId) return res.status(500).json({ error: 'insert_returned_no_id' })

  return res.status(200).json({ contentItemId })
}
