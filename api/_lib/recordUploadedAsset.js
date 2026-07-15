// Shared post-upload row insert + AI pipeline kickoff.
//
// Used by both the single-shot upload completion webhook
// (api/media/upload.js → handleUpload.onUploadCompleted) and the resumable
// multipart completion endpoint (api/media/multipart/complete.js). Both paths
// must produce byte-identical media_assets rows and dispatch the same
// downstream pipeline (audit, tag, segment, index, image pipeline, Mux,
// thumbnail, dimension probe, faststart probe).
//
// Input shape:
//   blob:         { url, pathname, contentType, size }
//   tokenPayload: parsed object (NOT a JSON string) carrying scope + meta:
//                 { scopeColumn, scopeId, filename, createdBy, patientPseudonym,
//                   condition, capturedAt, notes, assetPurpose, speakerRole,
//                   parentId, contentPieceId, collectionId, staffId }
//
// Returns the inserted media_assets row (or null on insert failure).

import { spawn } from 'node:child_process'
import { waitUntil } from '@vercel/functions'
import sharp from 'sharp'
import ffmpegStaticPath from 'ffmpeg-static'
import { tagAndPersist } from './tagAsset.js'
import { indexMediaAsset } from './visualMemoryIndex.js'
import { segmentAndPersist } from './segmentInterview.js'
import { generateAndPersistThumbnail } from './thumbnail.js'
import { processImageUpload } from './imagePipeline.js'
import { createAsset as createMuxAsset, muxConfigured } from './muxClient.js'
import { recordAudit, snapshot } from './audit.js'
import { workspaceById } from './workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const FFMPEG_BIN   = process.env.FFMPEG_PATH || ffmpegStaticPath || 'ffmpeg'

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

const PURPOSES = new Set(['interview', 'broll', 'photo', 'brand'])

function kindFromMime(mime) {
  if (!mime) return null
  if (mime.startsWith('image/')) return 'photo'
  if (mime.startsWith('video/')) return 'video'
  return null
}

function defaultPurpose(kind) {
  return kind === 'video' ? 'interview' : 'photo'
}

async function probeImageDimsFromUrl(url) {
  const res = await fetch(url, { headers: { Range: 'bytes=0-65535' } })
  if (!res.ok) throw new Error(`image-dims probe failed: ${res.status}`)
  let buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 65536) {
    console.warn('[recordUploadedAsset] Range request returned oversized buffer; truncating', buf.length)
    buf = buf.subarray(0, 65536)
  }
  const meta = await sharp(buf).metadata()
  return { width: meta.width || null, height: meta.height || null }
}

function probeVideoDimsFromUrl(url) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG_BIN, ['-i', url], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', () => {
      const m = stderr.match(/Stream #\d+:\d+(?:\([^)]+\))?:\s*Video:[^\n]*?\s(\d+)x(\d+)/)
      if (m) resolve({ width: parseInt(m[1], 10), height: parseInt(m[2], 10) })
      else resolve({ width: null, height: null })
    })
    proc.on('error', () => resolve({ width: null, height: null }))
  })
}

async function probeFaststart(url) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-262143' } })
    if (!r.ok && r.status !== 206) return 'unknown'
    const buf = Buffer.from(await r.arrayBuffer())
    let off = 0
    while (off + 8 <= buf.length) {
      const size = buf.readUInt32BE(off)
      const type = buf.slice(off + 4, off + 8).toString('ascii')
      if (type === 'moov') return 'faststart'
      if (type === 'mdat') return 'tail'
      const step = size === 0
        ? Infinity
        : size === 1 && off + 16 <= buf.length
          ? Number(buf.readBigUInt64BE(off + 8))
          : size
      if (!Number.isFinite(step) || step < 8) break
      off += step
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function recordUploadedAsset({ blob, tokenPayload }) {
  const meta = tokenPayload && typeof tokenPayload === 'object' ? tokenPayload : {}

  const kind = kindFromMime(blob.contentType)
  if (!kind) return null

  const scopeColumn = meta.scopeColumn
  const scopeId = meta.scopeId
  if (!scopeColumn || !scopeId) {
    console.error('recordUploadedAsset: tokenPayload missing scopeColumn/scopeId; refusing to insert row')
    return null
  }

  const workspaceRow = await workspaceById(scopeId)
  if (!workspaceRow) {
    console.error(`recordUploadedAsset: workspace ${scopeId} not found or inactive; refusing to insert row`)
    return null
  }
  const innerScope = { column: scopeColumn, id: scopeId, workspace: workspaceRow }

  // Defense-in-depth: parent_id and staff_id arrive in the client-supplied
  // upload-token payload. Verify each references a row in THIS workspace before
  // storing it — same drop-if-not-owned pattern as the collectionId /
  // contentPieceId checks below. A cross-tenant or stale id is nulled, not stored.
  let parentId = null
  if (meta.parentId) {
    const pv = await sb(
      `media_assets?id=eq.${encodeURIComponent(meta.parentId)}&${scopeColumn}=eq.${scopeId}&select=id&limit=1`,
    )
    const pvRows = pv.ok ? await pv.json().catch(() => []) : []
    if (pvRows.length === 1) parentId = meta.parentId
    else console.warn(`recordUploadedAsset: parent_id ${meta.parentId} not in workspace ${scopeId}; dropping`)
  }

  let staffId = null
  if (meta.staffId) {
    const sv = await sb(
      `staff?id=eq.${encodeURIComponent(meta.staffId)}&${scopeColumn}=eq.${scopeId}&select=id&limit=1`,
    )
    const svRows = sv.ok ? await sv.json().catch(() => []) : []
    if (svRows.length === 1) staffId = meta.staffId
    else console.warn(`recordUploadedAsset: staff_id ${meta.staffId} not in workspace ${scopeId}; dropping`)
  }

  const isReturnUpload = !!parentId
  const assetPurpose = PURPOSES.has(meta.assetPurpose)
    ? meta.assetPurpose
    : defaultPurpose(kind)
  const speakerRole = assetPurpose === 'interview'
    ? (meta.speakerRole || 'clinician')
    : null

  let probeWidth = null
  let probeHeight = null
  if (kind === 'photo') {
    try {
      const dims = await probeImageDimsFromUrl(blob.url)
      probeWidth = dims.width
      probeHeight = dims.height
    } catch { /* non-fatal */ }
  }

  const row = {
    [scopeColumn]: scopeId,
    kind,
    status: isReturnUpload ? 'approved' : 'raw',
    // Defaults to 'upload' (web uploader). The capture companion passes
    // source: 'capture_companion' so field captures stay distinguishable.
    source: meta.source || 'upload',
    blob_url: blob.url,
    blob_pathname: blob.pathname,
    filename: meta.filename || blob.pathname.split('/').pop(),
    mime_type: blob.contentType,
    size_bytes: blob.size || null,
    width: probeWidth,
    height: probeHeight,
    patient_pseudonym: meta.patientPseudonym || null,
    condition: meta.condition || null,
    captured_at: meta.capturedAt || null,
    notes: meta.notes || null,
    created_by: meta.createdBy || null,
    asset_purpose: assetPurpose,
    speaker_role: speakerRole,
    parent_id: parentId,
    staff_id: staffId,
    // Seed videos as 'pending' when Mux will transcode them, so the player
    // shows the "Transcoding…" placeholder immediately instead of falling
    // back to a native <video> that can't play a non-faststart .mov (moov
    // atom at the tail — common for iPhone captures). Flipped to 'processing'
    // once the Mux asset is created, then 'ready' by the webhook.
    transcode_status: kind === 'video' && !isReturnUpload && muxConfigured()
      ? 'pending'
      : null,
  }

  const ins = await sb('media_assets', { method: 'POST', body: JSON.stringify(row) })
  if (!ins.ok) {
    console.error('media_assets insert failed:', ins.status, await ins.text())
    return null
  }

  let insertedRow = null
  try {
    const inserted = await ins.json()
    insertedRow = inserted?.[0]
  } catch { /* empty */ }

  if (insertedRow?.id && meta.collectionId) {
    try {
      const verify = await sb(
        `collections?id=eq.${encodeURIComponent(meta.collectionId)}&${scopeColumn}=eq.${scopeId}&select=id&limit=1`,
      )
      const verifyRows = verify.ok ? await verify.json().catch(() => []) : []
      if (verifyRows.length === 1) {
        await sb('collection_items', {
          method: 'POST',
          body: JSON.stringify({
            collection_id: meta.collectionId,
            asset_id:      insertedRow.id,
            added_by:      meta.createdBy || null,
          }),
        })
      } else {
        console.warn(`recordUploadedAsset: collection ${meta.collectionId} not in workspace ${scopeId}; skipping link`)
      }
    } catch (e) {
      console.error('Pre-assign to collection failed:', e?.message)
    }
  }

  if (isReturnUpload && insertedRow?.id && meta.contentPieceId) {
    try {
      await sb(`content_pieces?id=eq.${meta.contentPieceId}&${scopeColumn}=eq.${scopeId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          final_asset_id: insertedRow.id,
          status: 'returned',
          returned_at: new Date().toISOString(),
        }),
      })
    } catch (e) {
      console.error('Brief link-up after return-upload failed:', e?.message)
    }
    return insertedRow  // skip auto-pipeline; finished media doesn't need re-tagging
  }

  try {
    if (insertedRow?.id) {
      waitUntil(recordAudit({
        assetId: insertedRow.id,
        action:  'upload',
        actor:   meta.createdBy || 'unknown',
        before:  null,
        after:   snapshot(insertedRow),
        scope:   innerScope,
      }).catch((e) => console.error('Audit record failed:', e?.message)))

      waitUntil(
        tagAndPersist(insertedRow, innerScope)
          .then(async (tagged) => {
            await indexMediaAsset({ assetId: insertedRow.id })
              .catch((e) => console.error('visualMemoryIndex failed:', e?.message))
            if (tagged?.kind !== 'video') return
            if (tagged?.asset_purpose !== 'interview') return
            const hasSpeech = tagged?.transcription?.trim()
            const hasVisual = tagged?.visual_narrative?.trim()
            if (hasSpeech || hasVisual) return segmentAndPersist(tagged, innerScope)
          })
          .catch((e) => console.error('Auto-pipeline failed:', e?.message)),
      )

      if (insertedRow.kind === 'photo') {
        waitUntil(
          processImageUpload({
            workspaceId:  innerScope.id,
            assetId:      insertedRow.id,
            blobUrl:      blob.url,
            declaredMime: blob.contentType,
          })
            .then(async (result) => {
              if (!result) return
              const patch = {
                original_blob_url: result.originalBlobUrl,
                web_blob_url:      result.webBlobUrl,
                web_width:         result.webWidth,
                web_height:        result.webHeight,
                blob_url:          result.webBlobUrl,
                mime_type:         result.webMime,
                size_bytes:        result.webSizeBytes,
                width:             result.webWidth,
                height:            result.webHeight,
              }
              const upd = await sb(
                `media_assets?id=eq.${insertedRow.id}&${scopeColumn}=eq.${scopeId}`,
                { method: 'PATCH', body: JSON.stringify(patch) },
              )
              if (!upd.ok) {
                console.error('[recordUploadedAsset] image-pipeline PATCH failed:', upd.status, await upd.text())
              }

              // alt_text is applied in a SEPARATE, conditionally-filtered PATCH
              // (alt_text=is.null) so a user who typed their own alt text while
              // this pipeline was still running can't have it silently
              // overwritten — the insert-time insertedRow.alt_text snapshot
              // above is stale by the time this fires, so we re-check on the
              // server via the filter instead of trusting it.
              if (result.altText) {
                const altUpd = await sb(
                  `media_assets?id=eq.${insertedRow.id}&${scopeColumn}=eq.${scopeId}&alt_text=is.null`,
                  { method: 'PATCH', body: JSON.stringify({ alt_text: result.altText }) },
                )
                if (!altUpd.ok) {
                  console.error('[recordUploadedAsset] alt_text PATCH failed:', altUpd.status, await altUpd.text())
                }
              }
            })
            .catch((e) => console.error('Image pipeline failed:', e?.message)),
        )
      }

      if (insertedRow.kind === 'video') {
        if (muxConfigured()) {
          waitUntil(
            (async () => {
              const policy = innerScope.workspace?.video_playback_policy === 'public'
                ? 'public'
                : 'signed'
              const { assetId, playbackId } = await createMuxAsset({
                inputUrl:       blob.url,
                playbackPolicy: policy,
                passthrough:    insertedRow.id,
              })
              const patch = {
                mux_asset_id:      assetId,
                transcode_status:  'processing',
                original_blob_url: blob.url,
              }
              if (playbackId) patch.mux_playback_id = playbackId
              const upd = await sb(
                `media_assets?id=eq.${insertedRow.id}&${scopeColumn}=eq.${scopeId}`,
                { method: 'PATCH', body: JSON.stringify(patch) },
              )
              if (!upd.ok) {
                console.error('[recordUploadedAsset] Mux PATCH failed:', upd.status, await upd.text())
              }
            })().catch(async (e) => {
              console.error('Mux create failed:', e?.message)
              await sb(
                `media_assets?id=eq.${insertedRow.id}&${scopeColumn}=eq.${scopeId}`,
                {
                  method: 'PATCH',
                  body: JSON.stringify({ transcode_status: 'errored' }),
                },
              ).catch(() => {})
            }),
          )
        } else {
          waitUntil(
            sb(
              `media_assets?id=eq.${insertedRow.id}&${scopeColumn}=eq.${scopeId}`,
              { method: 'PATCH', body: JSON.stringify({ transcode_status: 'skipped' }) },
            ).catch((e) => console.error('Mux skip-mark PATCH failed:', e?.message)),
          )
        }

        waitUntil(
          generateAndPersistThumbnail(insertedRow, innerScope)
            .catch((e) => console.error('Thumbnail generation failed:', e?.message)),
        )
        waitUntil(
          probeVideoDimsFromUrl(blob.url)
            .then(({ width, height }) => {
              if (!width || !height) return
              return sb(`media_assets?id=eq.${insertedRow.id}&${scopeColumn}=eq.${scopeId}`, {
                method: 'PATCH',
                body: JSON.stringify({ width, height }),
              })
            })
            .catch((e) => console.error('Video dimension probe failed:', e?.message)),
        )
        waitUntil(
          probeFaststart(blob.url)
            .then((status) => {
              if (status === 'tail') {
                console.warn(
                  `[recordUploadedAsset] non-faststart video uploaded id=${insertedRow.id} size=${blob.size} — playback start latency will be slow until normalize lands`,
                )
              } else if (status === 'unknown') {
                console.warn(`[recordUploadedAsset] faststart probe inconclusive id=${insertedRow.id}`)
              }
            })
            .catch((e) => console.error('Faststart probe failed:', e?.message)),
        )
      }
    }
  } catch (e) {
    console.error('Auto-pipeline dispatch error:', e?.message)
  }

  return insertedRow
}
