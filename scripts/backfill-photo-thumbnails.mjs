#!/usr/bin/env node
/**
 * Backfill photo thumbnails, and repoint stale content_items.media_urls
 * snapshots to match.
 *
 * Two phases, both idempotent (safe to re-run):
 *
 *   1. GENERATE — every media_assets row with kind='photo' (or null) and no
 *      thumbnail_url gets one, via the SAME decodeBase/encodeVariant
 *      functions the live upload pipeline uses (api/_lib/imagePipeline.js,
 *      #2332). This is deliberately NOT a hand-rolled duplicate resize —
 *      importing the real pipeline means this script can never drift from
 *      what a fresh upload produces (400px wide JPEG, quality 78).
 *
 *   2. REPOINT — content_items.media_urls is a SNAPSHOT, not a join, so a
 *      thumbnail generated after a photo was already attached to a post
 *      (either by phase 1 just now, or historically before #2331 shipped a
 *      real thumbnailUrl instead of the full-resolution url) never reaches
 *      the stored entry on its own. Every non-video media_urls entry whose
 *      thumbnailUrl doesn't match its media_assets.thumbnail_url gets
 *      rewritten to match — pure JSONB update, no image processing, no
 *      network fetch of the photo itself.
 *
 * The bug this closes: /week's Day-view cards (and YourWeek's backlog rows)
 * render a media_urls entry's thumbnailUrl into a 40-64px tile. Without a
 * real thumbnail, that field was either null (falls back to a multi-MB
 * original or a 164KB web derivative) or — for entries created before
 * #2331 — literally set to the full-resolution url. See #2318 for the
 * measured cost: a 12.6MB / 8192x5464 original decoded into a 64px box.
 *
 * Usage:
 *   node scripts/backfill-photo-thumbnails.mjs --dry-run
 *   node scripts/backfill-photo-thumbnails.mjs --limit=20
 *   node scripts/backfill-photo-thumbnails.mjs --skip-generate   (repoint only)
 *   node scripts/backfill-photo-thumbnails.mjs --skip-repoint    (generate only)
 *   node scripts/backfill-photo-thumbnails.mjs --ids=<uuid>,<uuid>  (media_assets ids)
 *   node scripts/backfill-photo-thumbnails.mjs
 *
 * Requires: MULTITENANT_DATABASE_URL + BLOB_READ_WRITE_TOKEN in .env.local
 * (or already exported into the environment before running).
 */

import pg from 'pg'
import { put as blobPut } from '@vercel/blob'
import { readFileSync } from 'fs'
import { decodeBase, encodeVariant } from '../api/_lib/imagePipeline.js'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const SKIP_GENERATE = args.includes('--skip-generate')
const SKIP_REPOINT = args.includes('--skip-repoint')
const limitArg = args.find(a => a.startsWith('--limit='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : null
const idsArg = args.find(a => a.startsWith('--ids='))
const ONLY_IDS = idsArg ? idsArg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean) : null

const THUMB_LONG_EDGE = 400
const THUMB_JPEG_QUALITY = 78

function thumbPathname(workspaceId, assetId) {
  return `media/thumbs/${workspaceId}/${assetId}.jpg`
}

// ---------------------------------------------------------------------------
// .env.local — mirrors scripts/backfill-thumbnails.mjs so the script works
// the same way when invoked from the project root.
// ---------------------------------------------------------------------------
const envPath = '/Users/qbook/Claude Projects/Bernard/.env.local'
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
} catch { /* env may already be exported via `set -a && source .env.local` */ }

const dbUrl = process.env.MULTITENANT_DATABASE_URL
const blobToken = process.env.BLOB_READ_WRITE_TOKEN
if (!dbUrl)     { console.error('ERROR: MULTITENANT_DATABASE_URL not set'); process.exit(1) }
if (!blobToken) { console.error('ERROR: BLOB_READ_WRITE_TOKEN not set');    process.exit(1) }

// ---------------------------------------------------------------------------
// pg pool — same connection-string parser as scripts/backfill-thumbnails.mjs
// so heroku-style URLs with @ in the password don't choke pg's default parser.
// ---------------------------------------------------------------------------
const s = dbUrl.replace(/^postgres(ql)?:\/\//, '')
const la = s.lastIndexOf('@')
const auth = s.slice(0, la); const hp = s.slice(la + 1)
const cIdx = auth.indexOf(':')
const u = auth.slice(0, cIdx); const p = auth.slice(cIdx + 1)
const [hostport, dbq = 'postgres'] = hp.split('/')
const [h, port = '5432'] = hostport.split(':')
const { Pool } = pg
const pool = new Pool({
  host: h, port: +port, user: u, password: p,
  database: (dbq || 'postgres').split('?')[0],
  ssl: { rejectUnauthorized: false },
  max: 4,
})

// ---------------------------------------------------------------------------
// Phase 1 — GENERATE
// ---------------------------------------------------------------------------
async function runGenerate() {
  const where = [
    `(kind = 'photo' OR kind IS NULL)`,
    `thumbnail_url IS NULL`,
    `blob_url IS NOT NULL`,
    `archived_at IS NULL`,
  ]
  const params = []
  if (ONLY_IDS && ONLY_IDS.length) {
    params.push(ONLY_IDS)
    where.push(`id = ANY($${params.length}::uuid[])`)
  }
  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : ''
  const { rows } = await pool.query(
    `SELECT id, workspace_id, filename, blob_url, mime_type
       FROM media_assets
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       ${limitClause}`,
    params,
  )

  console.log(`\n=== PHASE 1: GENERATE ===`)
  console.log(`→ ${rows.length} photo(s) missing thumbnails${ONLY_IDS ? ` (filtered to ${ONLY_IDS.length} id(s))` : ''}${LIMIT ? ` (limited to ${LIMIT})` : ''}\n`)
  if (rows.length === 0) {
    console.log('✓ Nothing to generate.')
    return { ok: 0, failed: 0 }
  }

  if (DRY_RUN) {
    for (const r of rows.slice(0, 20)) console.log(`  [dry-run] ${r.filename || r.id}`)
    if (rows.length > 20) console.log(`  …and ${rows.length - 20} more`)
    console.log(`\n(dry-run) Would generate ${rows.length} thumbnails. Re-run without --dry-run to apply.`)
    return { ok: 0, failed: 0 }
  }

  let ok = 0, failed = 0
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const label = `[${i + 1}/${rows.length}] ${r.filename || r.id}`
    try {
      const resp = await fetch(r.blob_url)
      if (!resp.ok) throw new Error(`fetch ${resp.status}`)
      const buf = Buffer.from(await resp.arrayBuffer())
      const base = decodeBase(buf)
      const thumb = await encodeVariant(base, {
        longEdge: THUMB_LONG_EDGE,
        mime: 'image/jpeg',
        quality: THUMB_JPEG_QUALITY,
      })
      const uploaded = await blobPut(thumbPathname(r.workspace_id, r.id), thumb.buffer, {
        access: 'public',
        contentType: 'image/jpeg',
        token: blobToken,
        addRandomSuffix: false,
        allowOverwrite: true,
      })
      await pool.query(
        `UPDATE media_assets SET thumbnail_url = $1, updated_at = now() WHERE id = $2`,
        [uploaded.url, r.id],
      )
      ok++
      console.log(`${label} → ${thumb.width}x${thumb.height}  ${(thumb.buffer.length / 1024).toFixed(0)} KB`)
    } catch (err) {
      failed++
      console.error(`${label} FAILED: ${err.message}`)
    }
  }
  console.log(`\nPhase 1: ${ok} succeeded, ${failed} failed.`)
  return { ok, failed }
}

// ---------------------------------------------------------------------------
// Phase 2 — REPOINT. Pure JSONB rewrite: every non-video media_urls entry
// whose thumbnailUrl doesn't match its asset's current thumbnail_url gets
// updated in place. No network fetch of the photo itself.
// ---------------------------------------------------------------------------
async function runRepoint() {
  console.log(`\n=== PHASE 2: REPOINT ===`)

  const { rows: items } = await pool.query(`
    SELECT ci.id, ci.media_urls
    FROM content_items ci
    WHERE jsonb_typeof(ci.media_urls) = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(ci.media_urls) AS e(elem)
        JOIN media_assets ma ON ma.id::text = e.elem->>'mediaAssetId'
        WHERE COALESCE(e.elem->>'type', e.elem->>'kind') IS DISTINCT FROM 'video'
          AND ma.thumbnail_url IS NOT NULL
          AND ma.thumbnail_url IS DISTINCT FROM (e.elem->>'thumbnailUrl')
      )
  `)

  console.log(`→ ${items.length} content_item(s) with a stale/missing photo thumbnailUrl\n`)
  if (items.length === 0) {
    console.log('✓ Nothing to repoint.')
    return { ok: 0, failed: 0, entriesChanged: 0 }
  }

  if (DRY_RUN) {
    for (const it of items.slice(0, 20)) console.log(`  [dry-run] ${it.id}`)
    if (items.length > 20) console.log(`  …and ${items.length - 20} more`)
    console.log(`\n(dry-run) Would repoint ${items.length} content_items. Re-run without --dry-run to apply.`)
    return { ok: 0, failed: 0, entriesChanged: 0 }
  }

  // Batch-fetch every distinct mediaAssetId referenced by these items' entries
  // in one query, so per-row repoint is a pure in-memory map, not N asset reads.
  const assetIds = new Set()
  for (const it of items) {
    for (const e of it.media_urls || []) {
      if (e?.mediaAssetId) assetIds.add(e.mediaAssetId)
    }
  }
  const { rows: assets } = await pool.query(
    `SELECT id, thumbnail_url FROM media_assets WHERE id = ANY($1::uuid[])`,
    [Array.from(assetIds)],
  )
  const thumbById = new Map(assets.map(a => [a.id, a.thumbnail_url]))

  let ok = 0, failed = 0, entriesChanged = 0
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const label = `[${i + 1}/${items.length}] ${it.id}`
    try {
      let changed = false
      const next = (it.media_urls || []).map((e) => {
        if (!e || !e.mediaAssetId) return e
        const isVideo = e.type === 'video' || e.kind === 'video'
        if (isVideo) return e
        const realThumb = thumbById.get(e.mediaAssetId)
        if (!realThumb || realThumb === e.thumbnailUrl) return e
        changed = true
        entriesChanged++
        return { ...e, thumbnailUrl: realThumb }
      })
      if (!changed) continue
      await pool.query(
        `UPDATE content_items SET media_urls = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(next), it.id],
      )
      ok++
      console.log(`${label} → repointed`)
    } catch (err) {
      failed++
      console.error(`${label} FAILED: ${err.message}`)
    }
  }
  console.log(`\nPhase 2: ${ok} content_items updated (${entriesChanged} entries repointed), ${failed} failed.`)
  return { ok, failed, entriesChanged }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let genResult = { ok: 0, failed: 0 }
let repointResult = { ok: 0, failed: 0, entriesChanged: 0 }

if (!SKIP_GENERATE) genResult = await runGenerate()
else console.log('\n=== PHASE 1: GENERATE — skipped (--skip-generate) ===')

if (!SKIP_REPOINT) repointResult = await runRepoint()
else console.log('\n=== PHASE 2: REPOINT — skipped (--skip-repoint) ===')

await pool.end()
process.exit(genResult.failed > 0 || repointResult.failed > 0 ? 1 : 0)
