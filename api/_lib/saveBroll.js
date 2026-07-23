// Shared helper: save a rendered clip as a b-roll media_assets row
// and kick off visual-memory indexing in the background.
//
// Called from:
//   • api/editorial/clip-to-broll.js  (new manual b-roll output)
//   • api/editorial/approve-package.js library branch (existing package path)
//
// params:
//   {
//     ws         — workspace context object (must have .id)
//     renders    — Array<{ blobUrl, width, height, sizeBytes, channel? }>
//     staffId    — source staff_id (may be null)
//     notes      — human-readable provenance note
//     parentAssetId — source media_asset.id (for "clips cut" counter; nullable)
//     awaitThumbnails — await poster generation so the returned rows carry
//                       thumbnail_url (default false = background it)
//   }
//
// Returns: Array of inserted media_assets rows.

import { waitUntil } from '@vercel/functions'
import { indexMediaAsset } from './visualMemoryIndex.js'
import { generateAndPersistThumbnail } from './thumbnail.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

export async function saveBroll({ ws, renders, staffId, notes, parentAssetId, awaitThumbnails = false }) {
  const assetRows = renders.map((r) => {
    const isVideo = String(r.blobUrl || '').toLowerCase().endsWith('.mp4')
    const kind = isVideo ? 'video' : 'photo'
    const filename = (r.blobUrl || '').split('/').pop().split('?')[0] || `broll.mp4`
    const blobPathname = (() => {
      try { return new URL(r.blobUrl).pathname } catch { return filename }
    })()
    return {
      workspace_id:     ws.id,
      kind,
      asset_purpose:    kind === 'video' ? 'broll' : 'photo',
      source:           'moments',
      // 'tagged', not the retired 'approved' — see exportClipEngine.js.
      status:           'tagged',
      blob_url:         r.blobUrl,
      blob_pathname:    blobPathname,
      filename,
      mime_type:        isVideo ? 'video/mp4' : 'image/jpeg',
      width:            r.width  || null,
      height:           r.height || null,
      size_bytes:       r.sizeBytes || null,
      staff_id:         staffId || null,
      parent_asset_id:  parentAssetId || null,
      // Renders are already processed mp4s — skip Mux re-transcode.
      transcode_status: kind === 'video' ? 'skipped' : null,
      notes:            notes || null,
    }
  })

  const res = await sb('media_assets', {
    method: 'POST',
    body: JSON.stringify(assetRows),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`media_assets insert failed: ${res.status} ${text}`)
  }
  const assets = await res.json()

  // Index each new asset into visual memory for ranked Suggested media.
  // waitUntil keeps the Vercel instance alive past the HTTP response.
  waitUntil(Promise.allSettled(assets.map((a) => indexMediaAsset({ assetId: a.id }))))

  // Generate a poster frame for every video row.
  //
  // Any place that inserts a `kind: 'video'` media_assets row owes this call.
  // Today that is: recordUploadedAsset.js, integrations/drive/import.js,
  // media/[id]/edit.js, capture/upload.js, exportClipEngine.js and here. That
  // list is enforced rather than maintained by hand —
  // tests/lib/videoThumbnailCoverage greps for the INSERT rather than the
  // route, which is how the exportClipEngine and capture/upload misses were
  // found (a route-by-route audit never reaches a shared helper like this one).
  //
  // These rows are marked transcode_status:'skipped' above (renders are already
  // processed mp4s, so Mux has nothing to do) — and Mux's webhook was the ONLY
  // thing that ever wrote thumbnail_url for a b-roll clip. So until this call,
  // b-roll landed permanently poster-less unless a human hit the manual
  // /api/media/backfill-thumbnails endpoint. Confirmed on prod 2026-07-23: every
  // auto-drafted reel had thumbnail_url null, and the handful that did have one
  // shared a 30-second created_at cluster — the signature of one manual backfill
  // run, not of any automatic path.
  //
  // Best-effort: a poster is a nicety, and losing it must never cost the clip.
  const scope = { column: 'workspace_id', id: ws.id, workspace: ws }
  const videoAssets = assets.filter((a) => a.kind === 'video' && a.blob_url)
  const posters = Promise.allSettled(
    videoAssets.map((a) => generateAndPersistThumbnail(a, scope)),
  )

  if (awaitThumbnails) {
    // Callers that immediately snapshot the row into content_items.media_urls
    // (the reel factory) await, so the draft is born WITH its poster instead of
    // depending on the entry-sync write-back winning a race against their own
    // insert. Costs one ffmpeg pass on a path that just spent far longer
    // rendering the clip itself.
    const results = await posters
    videoAssets.forEach((a, i) => {
      const r = results[i]
      if (r.status === 'fulfilled' && r.value) a.thumbnail_url = r.value
      else if (r.status === 'rejected') {
        console.error('[saveBroll] thumbnail failed for', a.id, r.reason?.message)
      }
    })
  } else {
    waitUntil(
      posters.then((results) => {
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.error('[saveBroll] thumbnail failed for', videoAssets[i]?.id, r.reason?.message)
          }
        })
      }),
    )
  }

  return assets
}
