#!/usr/bin/env node
/**
 * Re-render the reels the factory drafted before the template work landed.
 *
 * The five drafts from 2026-07-22/23 have their old look baked into the pixels:
 * a full-bleed brand band containing a truncated sentence, a black attribution
 * bar sitting under Instagram's own UI, small captions, and — on assets that
 * predate the Whisper fix — words silently deleted from the transcript. None of
 * that is fixable by config, because it is already in the mp4.
 *
 * IN PLACE, deliberately. It would be simpler to delete the drafts and let the
 * factory make new ones, but that discards the generated caption, the review
 * state, and the draft id anyone may have linked to. This renders the same
 * segment window with current code, uploads to a NEW blob path, then repoints
 * the existing media_assets row and the content_items.media_urls snapshot at it.
 * A new path rather than an overwrite so no CDN can serve the old bytes.
 *
 * Usage:
 *   node scripts/rerender-reel-drafts.mjs --dry-run
 *   node scripts/rerender-reel-drafts.mjs --ids=<content_item_id>,...
 *   node scripts/rerender-reel-drafts.mjs
 *
 * Requires: MULTITENANT_DATABASE_URL, BLOB_READ_WRITE_TOKEN, OPENAI_API_KEY,
 * AI_GATEWAY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */

import pg from 'pg'
import { readFileSync } from 'node:fs'
import { put as blobPut } from '@vercel/blob'
import { renderVideoChannel } from '../api/_lib/brandRenderVideo.js'
import { sliceWordsToWindow } from '../api/_lib/karaokeCaptions.js'
import { generateHeadline } from '../api/_lib/headlineGen.js'
import { resolveVideoTemplate, headlineHoldSeconds, isCustomTemplateId } from '../api/_lib/videoTemplates.js'
import { generateAndPersistThumbnail } from '../api/_lib/thumbnail.js'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
// Repair posters without re-rendering. A render is minutes; a poster is seconds,
// and the two failing independently is exactly what happened the first time.
const POSTERS_ONLY = args.includes('--posters-only')
const idsArg = args.find((a) => a.startsWith('--ids='))
const ONLY = idsArg ? idsArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : null

const envPath = '/Users/qbook/Claude Projects/Bernard/.env.local'
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
} catch { /* may already be exported */ }

const dbUrl = process.env.MULTITENANT_DATABASE_URL
for (const [k, v] of Object.entries({
  MULTITENANT_DATABASE_URL: dbUrl,
  BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
})) {
  if (!v) { console.error(`ERROR: ${k} not set`); process.exit(1) }
}

const s = dbUrl.replace(/^postgres(ql)?:\/\//, '')
const la = s.lastIndexOf('@')
const auth = s.slice(0, la); const hp = s.slice(la + 1)
const cIdx = auth.indexOf(':')
const u = auth.slice(0, cIdx); const p = auth.slice(cIdx + 1)
const [hostport, dbq = 'postgres'] = hp.split('/')
const [h, port = '5432'] = hostport.split(':')
const pool = new pg.Pool({
  host: h, port: +port, user: u, password: p,
  database: (dbq || 'postgres').split('?')[0],
  ssl: { rejectUnauthorized: false }, max: 4,
})

const CLIP_CHANNEL = 'instagram_reel'

async function templateFor(ws) {
  const pin = ws.reel_preset || null
  if (pin && !isCustomTemplateId(pin)) return resolveVideoTemplate(pin, [])
  const { rows } = await pool.query(
    'SELECT id, name, config, is_default FROM workspace_video_templates WHERE workspace_id = $1',
    [ws.id],
  )
  if (pin) return resolveVideoTemplate(pin, rows)
  return resolveVideoTemplate(rows.find((r) => r.is_default)?.id || 'hook_card', rows)
}

const { rows } = await pool.query(`
  SELECT ci.id AS content_item_id, ci.media_urls, ci.workspace_id,
         ma.id AS clip_asset_id, ma.filename AS clip_filename,
         vs.id AS segment_id, vs.start_sec, vs.end_sec, vs.hook, vs.transcript_excerpt, vs.staff_id,
         src.id AS source_asset_id, src.blob_url AS source_url, src.filename AS source_file,
         src.transcript_words,
         st.name AS staff_name,
         w.id AS ws_id, w.display_name, w.slug, w.brand_style, w.colors,
         w.brand_visual_identity, w.reel_preset
    FROM content_plan_atoms cpa
    JOIN content_items ci  ON ci.id = cpa.content_piece_id
    JOIN video_segments vs ON vs.id = cpa.source_segment_id
    JOIN media_assets src  ON src.id = vs.source_asset_id
    JOIN workspaces w      ON w.id = ci.workspace_id
    LEFT JOIN media_assets ma ON ma.id::text = (ci.media_urls->0->>'mediaAssetId')
    LEFT JOIN staff st ON st.id = vs.staff_id
   WHERE cpa.planned_by = 'reel_factory'
     AND ci.published_at IS NULL
   ORDER BY cpa.created_at DESC`)

const targets = ONLY ? rows.filter((r) => ONLY.includes(r.content_item_id)) : rows
console.log(`${targets.length} draft${targets.length === 1 ? '' : 's'} to re-render${DRY_RUN ? '  (DRY RUN)' : ''}\n`)

const stats = { ok: 0, failed: 0 }

for (const r of targets) {
  const startSec = Number(r.start_sec) || 0
  const durationSec = Math.max(1, (Number(r.end_sec) || 0) - startSec)
  const ws = {
    id: r.ws_id, display_name: r.display_name, slug: r.slug,
    brand_style: r.brand_style, colors: r.colors,
    brand_visual_identity: r.brand_visual_identity, reel_preset: r.reel_preset,
  }

  try {
    if (POSTERS_ONLY) {
      const scope = { column: 'workspace_id', id: ws.id, workspace: ws }
      const { rows: [cur] } = await pool.query('SELECT * FROM media_assets WHERE id = $1', [r.clip_asset_id])
      if (!cur) { console.log(`  ${r.source_file} — no clip asset, skipping`); continue }
      const thumb = await generateAndPersistThumbnail(cur, scope)
      const entries = Array.isArray(r.media_urls) ? [...r.media_urls] : []
      if (thumb && entries.length) {
        entries[0] = { ...entries[0], url: cur.blob_url, thumbnailUrl: thumb }
        await pool.query('UPDATE content_items SET media_urls = $1::jsonb WHERE id = $2',
          [JSON.stringify(entries), r.content_item_id])
      }
      console.log(`  ${r.source_file} — poster ${thumb ? 'ok' : 'FAILED'}`)
      stats.ok++
      continue
    }

    const template = await templateFor(ws)
    const words = Array.isArray(r.transcript_words) ? r.transcript_words : []
    const captionWords = words.length ? sliceWordsToWindow(words, startSec, durationSec) : null

    let headline = null
    if (template.headline.role) {
      try {
        headline = await generateHeadline({
          hook: r.hook || '', clipTranscript: r.transcript_excerpt || '', workspace: ws,
        })
      } catch (e) { console.log(`    headline gen failed (${e?.message?.slice(0, 60)}) — rendering without one`) }
    }

    console.log(`  ${r.source_file} ${startSec}s+${durationSec}s`)
    console.log(`    template ${template.id} · ${captionWords?.length ?? 0} stored words${words.length ? '' : ' (will transcribe live)'}${headline ? ` · "${headline}"` : ' · no headline'}`)
    if (DRY_RUN) { stats.ok++; continue }

    const overlays = headline && template.headline.role ? [{
      role: template.headline.role, text: headline, x: 0.5,
      y: template.headline.yFrac, widthFrac: template.headline.widthFrac, size: 1,
      color: template.blocks.headline.color, shadow: template.blocks.headline.shadow,
      fontWeight: template.blocks.headline.fontWeight, uppercase: template.blocks.headline.uppercase,
      in: 0, fadeIn: template.headline.fadeIn,
      out: headlineHoldSeconds(template, headline, durationSec),
    }] : []

    const { buffer, width, height } = await renderVideoChannel({
      videoUrl: r.source_url, channel: CLIP_CHANNEL, workspace: ws,
      staffName: r.staff_name || '', startSec, durationSec,
      subtitles: template.captions.enabled,
      overlayPosition: template.captions.position,
      captionSizeScale: template.captions.sizeScale,
      captionStyle: template.captions.style,
      ...(overlays.length ? { overlays } : {}),
      ...(captionWords?.length ? { captionWords } : {}),
    })

    // New path, not an overwrite — an overwritten blob URL can be served stale
    // from cache, and the whole point is that the old bytes stop existing.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safe = (r.source_file || 'clip').replace(/[^\w.-]/g, '_').replace(/\.\w+$/, '')
    const pathname = `media/clips/${ws.id}/${r.source_asset_id}/${r.segment_id}-${stamp}-${safe}.mp4`
    const blob = await blobPut(pathname, buffer, {
      access: 'public', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true,
    })

    await pool.query(
      `UPDATE media_assets
          SET blob_url = $1, blob_pathname = $2, size_bytes = $3,
              width = $4, height = $5, thumbnail_url = NULL, updated_at = now()
        WHERE id = $6`,
      [blob.url, new URL(blob.url).pathname, buffer.length, width, height, r.clip_asset_id],
    )

    // media_urls is a SNAPSHOT, not a join — repoint it or /week and the editor
    // keep rendering the old file.
    const entries = Array.isArray(r.media_urls) ? [...r.media_urls] : []
    if (entries.length) {
      entries[0] = { ...entries[0], url: blob.url, thumbnailUrl: null }
      await pool.query(
        'UPDATE content_items SET media_urls = $1::jsonb, updated_at = now() WHERE id = $2',
        [JSON.stringify(entries), r.content_item_id],
      )
    }

    // scope needs the resolved WORKSPACE object, not an id — requireScope()
    // checks `scope.workspace`. Passing {workspaceId} throws, and because the
    // poster is best-effort the throw is swallowed and every clip silently ends
    // up without one.
    const scope = { column: 'workspace_id', id: ws.id, workspace: ws }
    const { rows: [fresh] } = await pool.query('SELECT * FROM media_assets WHERE id = $1', [r.clip_asset_id])
    const thumb = await generateAndPersistThumbnail(fresh, scope).catch((e) => {
      console.log(`    thumbnail failed: ${e?.message?.slice(0, 80)}`)
      return null
    })
    if (thumb && entries.length) {
      entries[0] = { ...entries[0], thumbnailUrl: thumb }
      await pool.query(
        'UPDATE content_items SET media_urls = $1::jsonb WHERE id = $2',
        [JSON.stringify(entries), r.content_item_id],
      )
    }

    console.log(`    ok — ${(buffer.length / 1048576).toFixed(1)}MB${thumb ? ' + poster' : ''}`)
    stats.ok++
  } catch (e) {
    stats.failed++
    console.log(`    FAIL ${r.content_item_id}: ${e?.message?.slice(0, 200)}`)
  }
}

console.log(`\n${'─'.repeat(56)}\nre-rendered ${stats.ok}   failed ${stats.failed}`)
await pool.end()
