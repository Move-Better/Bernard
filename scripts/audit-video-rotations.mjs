#!/usr/bin/env node
/**
 * Probe-only audit of every video in `media_assets`.
 *
 * For each video row we:
 *   1. Stream-download the file to /tmp (no full buffer in RAM).
 *   2. Run `ffmpeg -i` to read the Stream line + rotate / displaymatrix
 *      metadata (same regex shipped in api/media/[id]/edit.js).
 *   3. Compare probed values to the DB row (`width`, `height`).
 *   4. Classify into one of:
 *        OK              — probed dims match DB, rotation = 0
 *        NEEDS_ROTATE    — probe reports non-zero rotation metadata
 *        DIM_MISMATCH    — DB dims disagree with probe (or are null)
 *        PROBE_FAILED    — couldn't parse a Stream line from stderr
 *        DOWNLOAD_FAILED — fetch errored or returned non-200
 *   5. Emit a CSV row to stdout + a status line to stderr per asset.
 *
 * NO WRITES. Safe to run anytime. Reads only.
 *
 * Usage
 * -----
 *   node scripts/audit-video-rotations.mjs > video-audit.csv
 *   node scripts/audit-video-rotations.mjs --workspace=movebetter-people > people.csv
 *   node scripts/audit-video-rotations.mjs --limit=5 > smoke.csv
 *
 * Requires: MULTITENANT_DATABASE_URL in .env.local. No blob token needed —
 * we read from the public CDN URL on each row.
 */

import pg from 'pg'
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import ffmpegStatic from 'ffmpeg-static'

// .env.local loader (same pattern as scripts/migrate-legacy-blobs.mjs)
const repoRoot = join(fileURLToPath(import.meta.url), '..', '..')
const envPath = join(repoRoot, '.env.local')
if (!existsSync(envPath)) { console.error('ERROR: .env.local not found'); process.exit(1) }
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq < 0) continue
  const k = t.slice(0, eq).trim()
  const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  if (!(k in process.env)) process.env[k] = v
}

const FFMPEG = ffmpegStatic || 'ffmpeg'

// ─── CLI ────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true']
  }),
)
const workspaceFilter = args.workspace || null
const limit = args.limit ? parseInt(args.limit, 10) : null

// ─── DB ─────────────────────────────────────────────────────────────────────
const { Client } = pg
const dbUrl = process.env.MULTITENANT_DATABASE_URL
if (!dbUrl || dbUrl.includes('REDACTED')) {
  console.error('ERROR: MULTITENANT_DATABASE_URL missing or redacted in .env.local')
  console.error('Restore from 1Password (Bernard vault) before running.')
  process.exit(1)
}
const db = new Client({ connectionString: dbUrl })
await db.connect()

let sql = `
  SELECT
    m.id, m.filename, m.kind, m.mime_type,
    m.width, m.height, m.duration_s,
    m.blob_url, m.created_at,
    w.slug AS workspace_slug
  FROM media_assets m
  JOIN workspaces w ON w.id = m.workspace_id
  WHERE m.kind = 'video'
`
const params = []
if (workspaceFilter) {
  params.push(workspaceFilter)
  sql += ` AND w.slug = $${params.length}`
}
sql += ` ORDER BY w.slug, m.created_at DESC`
if (limit) sql += ` LIMIT ${limit}`

const { rows } = await db.query(sql, params)
console.error(`Found ${rows.length} video rows to probe${workspaceFilter ? ` (workspace=${workspaceFilter})` : ''}`)

// ─── Probe helpers ──────────────────────────────────────────────────────────
function probe(path) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-i', path], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', () => {
      const dim = stderr.match(/Stream #\d+:\d+(?:\[[^\]]+\]|\([^)]+\))*:\s*Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})/)
      const rot = stderr.match(/rotate\s*:\s*(-?\d+)/i)
      const dm  = stderr.match(/displaymatrix:\s*rotation of (-?[\d.]+)/i)
      const rRaw = rot
        ? parseInt(rot[1], 10)
        : (dm ? Math.round(parseFloat(dm[1])) : 0)
      const cw = dm && !rot ? -rRaw : rRaw
      const rotate = ((cw % 360) + 360) % 360
      resolve({
        width:  dim ? parseInt(dim[1], 10) : null,
        height: dim ? parseInt(dim[2], 10) : null,
        rotate,
        rotateSource: rot ? 'rotate' : (dm ? 'displaymatrix' : null),
      })
    })
    proc.on('error', () => resolve({ width: null, height: null, rotate: 0, rotateSource: null }))
  })
}

async function download(url, outPath) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  await pipeline(Readable.fromWeb(r.body), createWriteStream(outPath))
  const s = await stat(outPath)
  return s.size
}

function classify(row, probed, status) {
  if (status) return status
  if (probed.rotate && probed.rotate !== 0) return 'NEEDS_ROTATE'
  const w = probed.width, h = probed.height
  if (!row.width || !row.height) return 'DIM_MISMATCH'
  if (row.width !== w || row.height !== h) return 'DIM_MISMATCH'
  return 'OK'
}

// ─── CSV header ─────────────────────────────────────────────────────────────
const cols = [
  'workspace_slug', 'asset_id', 'filename', 'mime_type',
  'db_width', 'db_height',
  'probed_width', 'probed_height', 'probed_rotate', 'rotate_source',
  'classification', 'file_bytes', 'created_at', 'blob_url',
]
process.stdout.write(cols.join(',') + '\n')

function csv(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// ─── Main loop ──────────────────────────────────────────────────────────────
const tmp = await mkdtemp(join(tmpdir(), 'video-audit-'))
const tally = {}

for (let i = 0; i < rows.length; i++) {
  const row = rows[i]
  const inPath = join(tmp, `${row.id}.mp4`)
  let bytes = null
  let status = null
  let probed = { width: null, height: null, rotate: 0, rotateSource: null }

  try {
    bytes = await download(row.blob_url, inPath)
    probed = await probe(inPath)
    if (!probed.width || !probed.height) status = 'PROBE_FAILED'
  } catch (e) {
    status = 'DOWNLOAD_FAILED'
    console.error(`  [${i + 1}/${rows.length}] ${row.id} download error: ${e.message}`)
  } finally {
    await rm(inPath, { force: true }).catch(() => {})
  }

  const classification = classify(row, probed, status)
  tally[classification] = (tally[classification] || 0) + 1

  process.stdout.write([
    csv(row.workspace_slug),
    csv(row.id),
    csv(row.filename),
    csv(row.mime_type),
    csv(row.width),
    csv(row.height),
    csv(probed.width),
    csv(probed.height),
    csv(probed.rotate),
    csv(probed.rotateSource),
    csv(classification),
    csv(bytes),
    csv(row.created_at?.toISOString?.() || row.created_at),
    csv(row.blob_url),
  ].join(',') + '\n')

  if ((i + 1) % 5 === 0 || i === rows.length - 1) {
    console.error(`  [${i + 1}/${rows.length}] ${row.workspace_slug} ${row.id.slice(0, 8)} → ${classification}`)
  }
}

await rm(tmp, { recursive: true, force: true }).catch(() => {})
await db.end()

console.error('\n── Summary ──')
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.error(`  ${k.padEnd(18)} ${v}`)
}
console.error(`  TOTAL              ${rows.length}`)
