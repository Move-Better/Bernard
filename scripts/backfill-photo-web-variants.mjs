#!/usr/bin/env node
/**
 * Backfill the web variant (and true dimensions + alt text) for catalogue photos
 * that were bulk-imported before the image pipeline existed.
 *
 * Why: media_assets photos with web_blob_url NULL have null width/height and a
 * 6-21 MB original as the only file, so GET /api/media/catalogue serves the
 * original with no dimensions. Rows that went through api/_lib/imagePipeline.js
 * have web_blob_url (<=3200px), web_width/web_height and alt_text.
 *
 * It runs the SAME processImageUpload() a fresh upload runs, then writes only
 * additive columns. `blob_url` is deliberately NOT repointed: posts' media_urls
 * snapshots and existing consumers keep the original; the catalogue's `url`
 * already prefers web_blob_url.
 *
 * Per row, written only where web_blob_url IS NULL (so re-runs are no-ops):
 *   original_blob_url = blob_url
 *   web_blob_url, web_width, web_height   = the new variant
 *   width, height = coalesce(width, <original dims, EXIF-oriented>)
 *   size_bytes    = coalesce(size_bytes, <original bytes>)
 *   alt_text      = <generated>   only where alt_text is null or ''
 *
 * Modes (always pass --workspace=<slug>; nothing runs across tenants):
 *   --snapshot-out=<file> [--dry-run]   select the rows, write the before-snapshot
 *                                       (read-only), print the literal writes. No downloads.
 *   --ids-file=<snapshot.json> --manifest=<file> [--limit=N]
 *                                       APPLY to exactly the snapshotted ids. Appends one
 *                                       JSON line per row to the manifest (new blob url, alt).
 *   --rollback=<snapshot.json> --manifest=<file> [--dry-run]
 *                                       restore the snapshotted values and delete the
 *                                       blobs listed in the manifest.
 *
 * Requires MULTITENANT_DATABASE_URL (+ BLOB_READ_WRITE_TOKEN and AI_GATEWAY_API_KEY
 * for apply / rollback) exported or in the primary checkout's .env.local.
 */

import pg from 'pg'
import sharp from 'sharp'
import { del as blobDel } from '@vercel/blob'
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs'
import { processImageUpload } from '../api/_lib/imagePipeline.js'
import { downloadImageCapped } from '../api/_lib/imageSource.js'

const args = process.argv.slice(2)
const flag = (n) => args.includes(`--${n}`)
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) || null
const DRY_RUN = flag('dry-run')
const WORKSPACE = opt('workspace')
const SNAPSHOT_OUT = opt('snapshot-out')
const IDS_FILE = opt('ids-file')
const ROLLBACK = opt('rollback')
const MANIFEST = opt('manifest')
const LIMIT = opt('limit') ? parseInt(opt('limit'), 10) : null
const MAX_BYTES = 60 * 1024 * 1024
const ROW_TIMEOUT_MS = 180_000

// A hung download or AI call once stalled a run for 42 minutes with no CPU use.
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms))])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

if (!WORKSPACE) { console.error('ERROR: --workspace=<slug> is required'); process.exit(1) }
if (!SNAPSHOT_OUT && !IDS_FILE && !ROLLBACK) { console.error('ERROR: pass --snapshot-out, --ids-file or --rollback'); process.exit(1) }

try {
  for (const line of readFileSync('/Users/qbook/Claude Projects/Bernard/.env.local', 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
} catch { /* may already be exported */ }

const dbUrl = process.env.MULTITENANT_DATABASE_URL
if (!dbUrl) { console.error('ERROR: MULTITENANT_DATABASE_URL not set'); process.exit(1) }
const writing = IDS_FILE || (ROLLBACK && !DRY_RUN)
if (writing && !process.env.BLOB_READ_WRITE_TOKEN) { console.error('ERROR: BLOB_READ_WRITE_TOKEN not set'); process.exit(1) }

const s = dbUrl.replace(/^postgres(ql)?:\/\//, '')
const la = s.lastIndexOf('@')
const auth = s.slice(0, la); const hp = s.slice(la + 1)
const cIdx = auth.indexOf(':')
const [hostport, dbq = 'postgres'] = hp.split('/')
const [h, port = '5432'] = hostport.split(':')
const pool = new pg.Pool({
  host: h, port: +port, user: auth.slice(0, cIdx), password: auth.slice(cIdx + 1),
  database: (dbq || 'postgres').split('?')[0], ssl: { rejectUnauthorized: false }, max: 2,
})

const COLS = 'id, workspace_id, blob_url, original_blob_url, web_blob_url, web_width, web_height, width, height, size_bytes, mime_type, alt_text, thumbnail_url, updated_at'

async function wsId() {
  const { rows } = await pool.query('select id from workspaces where slug = $1', [WORKSPACE])
  if (rows.length !== 1) throw new Error(`workspace ${WORKSPACE} not found`)
  return rows[0].id
}

function loadSnapshot(file) {
  const snap = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(snap.rows) || !snap.rows.every((r) => UUID_RE.test(r.id))) throw new Error('bad snapshot file')
  return snap
}

// Same set GET /api/media/catalogue serves, minus rows that already have a web variant.
async function selectCandidates(ws) {
  const { rows } = await pool.query(
    `select ${COLS} from media_assets
      where workspace_id = $1 and kind = 'photo' and archived_at is null and parent_id is null
        and consent_status in ('obtained','not_required') and blob_url is not null and web_blob_url is null
      order by id`, [ws])
  return rows
}

async function originalDims(url) {
  const dl = await downloadImageCapped(url, MAX_BYTES)
  if (dl.tooLarge) return null
  const m = await sharp(dl.buffer).metadata()
  const swap = (m.orientation || 1) >= 5
  return { width: swap ? m.height : m.width, height: swap ? m.width : m.height, bytes: dl.buffer.length }
}

async function snapshotAndPlan() {
  const ws = await wsId()
  const rows = await selectCandidates(ws)
  const snap = { taken_at: new Date().toISOString(), workspace: WORKSPACE, workspace_id: ws, count: rows.length, rows }
  writeFileSync(SNAPSHOT_OUT, JSON.stringify(snap, null, 2))
  const knownBytes = rows.reduce((n, r) => n + (Number(r.size_bytes) || 0), 0)
  console.log(`snapshot: ${rows.length} rows -> ${SNAPSHOT_OUT}`)
  console.log(`rows with null width: ${rows.filter((r) => r.width == null).length}; null size_bytes: ${rows.filter((r) => r.size_bytes == null).length}; alt null/empty: ${rows.filter((r) => !r.alt_text).length}`)
  console.log(`originals to download: ${(knownBytes / 1048576).toFixed(0)} MB known (+ ${rows.filter((r) => r.size_bytes == null).length} unknown-size rows)`)
  console.log('\nWrites per row (only where web_blob_url IS NULL), $n bound from the pipeline result:')
  console.log(`  UPDATE media_assets SET
    original_blob_url = blob_url,
    web_blob_url = $1, web_width = $2, web_height = $3,
    width = coalesce(width, $4), height = coalesce(height, $5),
    size_bytes = coalesce(size_bytes, $6)
  WHERE id = $id AND workspace_id = $ws AND web_blob_url IS NULL;
  UPDATE media_assets SET alt_text = $7
  WHERE id = $id AND workspace_id = $ws AND (alt_text IS NULL OR alt_text = '');   -- only if alt text was generated`)
  console.log('\nNot written: blob_url, mime_type, thumbnail_url, tags, consent, any other column. No blob is deleted.')
}

async function apply() {
  if (!MANIFEST) throw new Error('--manifest=<file> is required with --ids-file')
  const ws = await wsId()
  const snap = loadSnapshot(IDS_FILE)
  if (snap.workspace_id !== ws) throw new Error('snapshot is for another workspace')
  let ids = snap.rows.map((r) => r.id)
  if (LIMIT) ids = ids.slice(0, LIMIT)
  const { rows } = await pool.query(
    `select ${COLS} from media_assets where workspace_id = $1 and id = any($2::uuid[]) and web_blob_url is null and blob_url is not null order by id`,
    [ws, ids])
  console.log(`applying to ${rows.length} of ${ids.length} snapshotted rows (rest already have a web variant)`)
  let ok = 0; const failed = []
  for (const r of rows) {
    try {
      const orig = await withTimeout(originalDims(r.blob_url), ROW_TIMEOUT_MS, 'original download')
      const res = await withTimeout(processImageUpload({ workspaceId: ws, assetId: r.id, blobUrl: r.blob_url, declaredMime: r.mime_type }), ROW_TIMEOUT_MS, 'pipeline')
      if (!res) throw new Error('pipeline skipped (too large or not an image)')
      // The pipeline always uploads a thumbnail we do not use (rows already have one): remove it.
      if (res.thumbnailUrl) await blobDel(res.thumbnailUrl).catch(() => {})
      const upd = await pool.query(
        `update media_assets set original_blob_url = blob_url, web_blob_url = $1, web_width = $2, web_height = $3,
           width = coalesce(width, $4), height = coalesce(height, $5), size_bytes = coalesce(size_bytes, $6)
         where id = $7 and workspace_id = $8 and web_blob_url is null`,
        [res.webBlobUrl, res.webWidth, res.webHeight, orig?.width ?? null, orig?.height ?? null, orig?.bytes ?? res.originalSizeBytes, r.id, ws])
      if (upd.rowCount !== 1) throw new Error('row changed underneath; web blob left in manifest for cleanup')
      let alt = null
      if (res.altText) {
        const a = await pool.query(
          `update media_assets set alt_text = $1 where id = $2 and workspace_id = $3 and (alt_text is null or alt_text = '')`,
          [res.altText, r.id, ws])
        if (a.rowCount === 1) alt = res.altText
      }
      appendFileSync(MANIFEST, JSON.stringify({ id: r.id, web_blob_url: res.webBlobUrl, alt_written: alt }) + '\n')
      ok++
      console.log(`  ok ${r.id} ${orig?.width}x${orig?.height} -> ${res.webWidth}x${res.webHeight}`)
    } catch (e) {
      failed.push(r.id)
      console.error(`  FAIL ${r.id}: ${e?.message}`)
    }
  }
  console.log(`done: ${ok} ok, ${failed.length} failed${failed.length ? ` (${failed.join(',')})` : ''}`)
}

async function rollback() {
  if (!MANIFEST || !existsSync(MANIFEST)) throw new Error('--manifest=<existing file> is required with --rollback')
  const ws = await wsId()
  const snap = loadSnapshot(ROLLBACK)
  const byId = new Map(snap.rows.map((r) => [r.id, r]))
  const done = readFileSync(MANIFEST, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}rolling back ${done.length} manifest rows`)
  for (const m of done) {
    const b = byId.get(m.id)
    if (!b) { console.error(`  skip ${m.id}: not in snapshot`); continue }
    if (DRY_RUN) { console.log(`  [dry-run] restore ${m.id}, delete ${m.web_blob_url}`); continue }
    await pool.query(
      `update media_assets set original_blob_url = $1, web_blob_url = null, web_width = null, web_height = null,
         width = $2, height = $3, size_bytes = $4 where id = $5 and workspace_id = $6 and web_blob_url = $7`,
      [b.original_blob_url, b.width, b.height, b.size_bytes, m.id, ws, m.web_blob_url])
    if (m.alt_written) {
      await pool.query(`update media_assets set alt_text = $1 where id = $2 and workspace_id = $3 and alt_text = $4`, [b.alt_text, m.id, ws, m.alt_written])
    }
    await blobDel(m.web_blob_url).catch((e) => console.error(`  blob delete failed ${m.web_blob_url}: ${e?.message}`))
    console.log(`  restored ${m.id}`)
  }
}

try {
  if (ROLLBACK) await rollback()
  else if (IDS_FILE) await apply()
  else await snapshotAndPlan()
} catch (e) {
  console.error('ERROR:', e?.message)
  process.exitCode = 1
} finally {
  await pool.end()
  process.exit(process.exitCode || 0)   // a timed-out request may still hold the loop open
}
