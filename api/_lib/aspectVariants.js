// Aspect variants — one source clip, rendered at a second aspect.
//
// Why this exists: Instagram carousels enforce ONE aspect across every item and
// reject anything below 0.8 (verified live 2026-07-29), so a 9:16 clip can only
// join a 4:5 deck as a real 4:5 re-bake. Letterboxing is not an acceptable
// answer for Bernard's own clips — they carry burned-in karaoke captions, and
// the whole point is that the bake re-places them for the new frame.
//
// STORAGE SHAPE — the master/variant family, NOT a sibling library row.
// The variant is a media_assets child carrying parent_id + variant_label, the
// same shape api/media/[id]/edit.js uses for rotate/crop variants. That choice
// is what satisfies "one master per upload in the library":
//   • MediaHub passes sources:true, which filters parent_id=is.null — so a
//     variant NEVER appears as its own tile in the Library grid.
//   • MediaDetail already renders variant_label rows collapsed under the master.
// Rendered once and reused by every piece that needs that clip at that aspect
// (a bake is deterministic given source + recipe + aspect), instead of burning
// ~60s of ffmpeg per content item.
//
// DELIBERATELY NOT INDEXED into visual memory. saveBroll indexes its rows
// because a b-roll clip is genuinely new content; an aspect variant is the SAME
// content in a different frame. clipSearch has no parent_id/variant_label
// filter, so indexing one would surface the master and its variant as two
// competing suggestions for the same shot.

import { generateAndPersistThumbnail } from './thumbnail.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(10_000),
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

// Stable, human-readable label per render channel. Stable matters: it is the
// idempotency key (parent_id + variant_label), so changing these strings would
// orphan every existing variant and start re-baking duplicates. It is also what
// MediaDetail shows under the master, so it reads as a frame, not a channel id.
const VARIANT_LABELS = {
  instagram_carousel_video: '4:5 carousel',
}

export function aspectVariantLabel(channel) {
  return VARIANT_LABELS[channel] || null
}

/** Channels that produce a reusable aspect variant rather than a one-off export. */
export function isAspectVariantChannel(channel) {
  return Object.prototype.hasOwnProperty.call(VARIANT_LABELS, channel)
}

/**
 * Find an existing aspect variant of `sourceAssetId` for `channel`.
 *
 * @returns {Promise<Object|null>} the media_assets row, or null
 */
export async function findAspectVariant({ sourceAssetId, channel, workspaceId }) {
  const label = aspectVariantLabel(channel)
  if (!label || !sourceAssetId || !workspaceId) return null
  const res = await sb(
    `media_assets?parent_id=eq.${encodeURIComponent(sourceAssetId)}` +
    `&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&variant_label=eq.${encodeURIComponent(label)}` +
    `&archived_at=is.null&limit=1`,
  )
  if (!res.ok) return null
  const rows = await res.json().catch(() => [])
  return rows[0] || null
}

/**
 * Persist a rendered aspect variant, replacing any prior variant for the same
 * (source, channel) pair rather than accumulating duplicates — re-cropping a
 * clip should REPLACE its 4:5 bake, not leave a graveyard of stale ones.
 *
 * `reframe` is stored in `transforms` so a later read can tell which crop
 * produced this bake, and therefore whether it is stale relative to the edit
 * draft. That matters because the 4:5 crop is a human decision the reel's own
 * reframe cannot supply (measured: replaying it puts the caption on the
 * subject's face — see .claude/video-aspect-bake-design.md).
 *
 * @param {Object}  p
 * @param {Object}  p.sourceAsset media_assets row the variant derives from
 * @param {string}  p.channel     render channel (must be an aspect-variant channel)
 * @param {Object}  p.render      { blobUrl, width, height, sizeBytes }
 * @param {Object}  [p.reframe]   the {zoom,x,y} used for THIS aspect
 * @param {Object}  p.scope       { column, id, workspace } — for thumbnail generation
 * @returns {Promise<Object|null>} the variant row
 */
export async function saveAspectVariant({ sourceAsset, channel, render, reframe = null, scope }) {
  const label = aspectVariantLabel(channel)
  if (!label) throw new Error(`Not an aspect-variant channel: ${channel}`)
  if (!sourceAsset?.id) throw new Error('saveAspectVariant requires a source asset')
  if (!render?.blobUrl) throw new Error('saveAspectVariant requires a rendered blobUrl')

  const workspaceId = scope?.id
  const existing = await findAspectVariant({ sourceAssetId: sourceAsset.id, channel, workspaceId })

  // asset_purpose is NOT NULL on media_assets, and callers do NOT reliably
  // carry it: resolveClipRender selects only
  // id,kind,blob_url,filename,staff_id,archived_at,consent_status,transcript_words,
  // so `sourceAsset.asset_purpose` is undefined on the render path and a
  // `|| null` turns that into an explicit null → 23502 on every insert.
  //
  // Read the master's real values instead of defaulting to a guess: the variant
  // should inherit its parent's purpose and speaker role, and inventing 'broll'
  // for an interview clip would mislabel it everywhere purpose is filtered on.
  let inherited = { asset_purpose: sourceAsset.asset_purpose, speaker_role: sourceAsset.speaker_role }
  if (inherited.asset_purpose === undefined) {
    const mRes = await sb(
      `media_assets?id=eq.${encodeURIComponent(sourceAsset.id)}` +
      `&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
      `&select=asset_purpose,speaker_role&limit=1`,
    )
    const mRow = mRes.ok ? (await mRes.json().catch(() => []))[0] : null
    if (mRow) inherited = { asset_purpose: mRow.asset_purpose, speaker_role: mRow.speaker_role }
  }

  const blobPathname = (() => {
    try { return new URL(render.blobUrl).pathname } catch { return null }
  })()

  const body = {
    blob_url:      render.blobUrl,
    blob_pathname: blobPathname,
    width:         render.width  || null,
    height:        render.height || null,
    size_bytes:    render.sizeBytes || null,
    transforms:    { aspectChannel: channel, ...(reframe ? { reframe } : {}) },
    updated_at:    new Date().toISOString(),
  }

  let variant
  if (existing) {
    const upd = await sb(
      `media_assets?id=eq.${encodeURIComponent(existing.id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    )
    if (!upd.ok) throw new Error(`aspect variant update failed: ${upd.status} ${await upd.text().catch(() => '')}`)
    variant = (await upd.json().catch(() => []))[0] || null
  } else {
    const row = {
      workspace_id:  workspaceId,
      kind:          sourceAsset.kind,
      status:        'tagged',
      source:        'edit',
      filename:      sourceAsset.filename,
      mime_type:     'video/mp4',
      parent_id:     sourceAsset.id,
      variant_label: label,
      asset_purpose: inherited.asset_purpose || 'broll',
      speaker_role:  inherited.speaker_role  || null,
      staff_id:      sourceAsset.staff_id || null,
      // Renders are already-processed mp4s — Mux has nothing to do.
      transcode_status: 'skipped',
      ...body,
    }
    const ins = await sb('media_assets', { method: 'POST', body: JSON.stringify(row) })
    if (!ins.ok) {
      // Include PostgREST's OWN message, not just the status. A bare
      // "insert failed: 400" says nothing about which column or constraint —
      // diagnosing one cost a full deploy cycle plus a hand-run SQL insert to
      // prove the columns were fine and the fault was in the request. The
      // codebase's dbErr() helper already logs the full body for this reason;
      // this matches it. Server-side only — the route still returns an opaque
      // key to the client.
      throw new Error(`aspect variant insert failed: ${ins.status} ${await ins.text().catch(() => '')}`)
    }
    variant = (await ins.json().catch(() => []))[0] || null
  }

  // Poster frame. Every `kind:'video'` media_assets insert owes this call — the
  // rule is enforced by tests/lib/videoThumbnailCoverage, which greps for the
  // INSERT rather than the route (a route-by-route audit never reaches a shared
  // helper like this one). Awaited, not backgrounded: the caller shows this
  // variant in the editor immediately, and a blank tile reads as a failed bake.
  // Best-effort by design — a missing poster must never cost the render.
  if (variant?.id && variant.kind === 'video') {
    try {
      await generateAndPersistThumbnail(variant, scope)
    } catch (e) {
      console.error('[aspectVariants] thumbnail failed:', e?.message)
    }
  }

  return variant
}
