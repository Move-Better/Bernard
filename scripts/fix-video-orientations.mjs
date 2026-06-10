#!/usr/bin/env node
/**
 * Detect and fix videos whose PIXELS are stored in the wrong orientation.
 *
 * This is the vision-based complement to scripts/bulk-rotate-videos.mjs.
 * That script fixes videos carrying non-zero rotate/displaymatrix metadata.
 * This one catches the class the 2026-06-09 library sweep surfaced: files
 * that are landscape-coded with NO rotation metadata but whose content is
 * sideways (e.g. local-import camera files that lost their rotation hint
 * upstream). ffprobe cannot detect these — only looking at frames can.
 *
 * Per video row:
 *   DETECT
 *   1. Remote-probe the blob URL with ffmpeg (header only) for dims + any
 *      rotation metadata.
 *   2. Extract 3 small frames (10% / 45% / 80% of duration) straight from
 *      the blob URL — no full download — with ffmpeg's default autorotate,
 *      so the frame matches what a browser shows.
 *   3. Ask a vision model (AI Gateway, same pattern as api/_lib/tagAsset.js)
 *      what correction each frame needs: none / rotate_90_clockwise /
 *      rotate_90_counterclockwise / rotate_180.
 *   4. Flag for fixing only when ALL THREE frames agree on the same non-none
 *      correction and at least two are high-confidence. Anything mixed or
 *      low-confidence is reported as 'unclear' and left untouched.
 *      (If the file carries rotation metadata instead, it's flagged as the
 *      legacy 'metadata' class and fixed via decode-side autorotate.)
 *
 *   FIX (flagged rows only)
 *   5. Stream-download the original, re-encode with the needed transpose
 *      (libx264 crf 23 veryfast + aac — same recipe as api/media/[id]/edit.js),
 *      stripping all rotation metadata from the output.
 *   6. VERIFY: extract a frame from the re-encode and ask the vision model
 *      again — output must come back 'none' or the row is NOT swapped.
 *   7. Upload to media/raw/<workspace-uuid>/rotated/<asset-id>.mp4 (original
 *      blob is kept for revert), update blob_url + width + height.
 *   8. Regenerate the poster thumbnail from the fixed file (480px JPEG to
 *      media/thumbs/, same shape as api/_lib/thumbnail.js).
 *   9. If the row had a Mux asset, create a fresh Mux asset from the fixed
 *      blob (passthrough = row id, policy from workspace.video_playback_policy)
 *      and set transcode_status='processing' — the existing webhook flips it
 *      to ready and fills mux_playback_id + dims, exactly like a new upload.
 *  10. Append every swap to a revert log (old blob/dims/thumb/mux ids).
 *
 * State lives in .claude/video-orientation/ (detect.jsonl, fixes.jsonl,
 * revert.jsonl, report.md). Both passes are resumable: rows already present
 * in the JSONL are skipped on re-run.
 *
 * Usage
 * -----
 *   node scripts/fix-video-orientations.mjs --detect-only            # pass 1 only
 *   node scripts/fix-video-orientations.mjs --asset=<uuid>           # one asset end-to-end
 *   node scripts/fix-video-orientations.mjs --limit=5                # smoke
 *   node scripts/fix-video-orientations.mjs                          # full run
 *   node scripts/fix-video-orientations.mjs --dry-run                # detect + plan, no writes
 *
 * Env (process.env or repo-root .env.local): MULTITENANT_DATABASE_URL,
 * BLOB_READ_WRITE_TOKEN, AI_GATEWAY_API_KEY, and (only for rows with Mux
 * assets) MUX_TOKEN_ID + MUX_TOKEN_SECRET.
 */

import pg from 'pg'
import { put } from '@vercel/blob'
import { generateObject } from 'ai'
import { z } from 'zod'
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import ffmpegStatic from 'ffmpeg-static'

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg'
const repoRoot = join(fileURLToPath(import.meta.url), '..', '..')

// ─── env: .env.local fills anything not already in process.env ─────────────
const envPath = join(repoRoot, '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
}
for (const k of ['MULTITENANT_DATABASE_URL', 'BLOB_READ_WRITE_TOKEN', 'AI_GATEWAY_API_KEY']) {
  if (!process.env[k] || process.env[k].includes('REDACTED')) {
    console.error(`ERROR: ${k} missing or redacted (set in env or repo-root .env.local)`)
    process.exit(1)
  }
}

// ─── CLI ────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true']
  }),
)
const DRY_RUN     = args['dry-run'] === 'true'
const DETECT_ONLY = args['detect-only'] === 'true'
const limit       = args.limit ? parseInt(args.limit, 10) : null
const assetFilter = args.asset || null
const wsFilter    = args.workspace || null

// ─── state dir ──────────────────────────────────────────────────────────────
const stateDir = join(repoRoot, '.claude', 'video-orientation')
mkdirSync(stateDir, { recursive: true })
const detectLog = join(stateDir, 'detect.jsonl')
const fixLog    = join(stateDir, 'fixes.jsonl')
const revertLog = join(stateDir, 'revert.jsonl')

function loadJsonl(path) {
  if (!existsSync(path)) return new Map()
  const m = new Map()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { const o = JSON.parse(line); m.set(o.id, o) } catch { /* skip */ }
  }
  return m
}

// ─── ffmpeg helpers ─────────────────────────────────────────────────────────
function runFfmpeg(ffArgs, { captureStderr = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ffArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0 || captureStderr) resolve(stderr)
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`))
    })
  })
}

async function probe(input) {
  // `ffmpeg -i` exits 1 (no output file) — captureStderr resolves anyway.
  const stderr = await runFfmpeg(['-i', input], { captureStderr: true })
  const dim = stderr.match(/Stream #\d+:\d+(?:\[[^\]]+\]|\([^)]+\))*:\s*Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})/)
  const dur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const rot = stderr.match(/rotate\s*:\s*(-?\d+)/i)
  const dm  = stderr.match(/displaymatrix:\s*rotation of (-?[\d.]+)/i)
  const rRaw = rot ? parseInt(rot[1], 10) : (dm ? Math.round(parseFloat(dm[1])) : 0)
  const cw = dm && !rot ? -rRaw : rRaw
  return {
    width:  dim ? parseInt(dim[1], 10) : null,
    height: dim ? parseInt(dim[2], 10) : null,
    durationS: dur ? (+dur[1] * 3600 + +dur[2] * 60 + +dur[3]) : null,
    rotate: ((cw % 360) + 360) % 360,
  }
}

async function extractFrame(input, atSeconds, outPath, { width = 512 } = {}) {
  // -ss before -i = fast seek; default autorotate ON so the frame matches
  // what a browser/player shows for metadata-carrying files.
  await runFfmpeg([
    '-y', '-ss', String(Math.max(0, atSeconds)), '-i', input,
    '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '5', outPath,
  ])
}

// ─── vision ────────────────────────────────────────────────────────────────
const VISION_MODEL = 'google/gemini-2.5-flash' // same default as api/_lib/tagAsset.js
const orientationSchema = z.object({
  correction: z.enum(['none', 'rotate_90_clockwise', 'rotate_90_counterclockwise', 'rotate_180']),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
})
const VISION_SYSTEM = 'You judge whether a video frame is displayed in the correct orientation. ' +
  'Use gravity cues: standing people, ceiling lights and ducts (should be at top), floors and gym mats (bottom), ' +
  'readable signage/text, furniture. People may be lying down, bending over, or exercising on the floor — ' +
  'judge by the ROOM, not just the people. Answer with the correction needed to make the frame upright. ' +
  'If you cannot tell, answer none with low confidence.'

async function judgeFrame(jpegPath) {
  const img = await readFile(jpegPath)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { object } = await generateObject({
        model: VISION_MODEL,
        schema: orientationSchema,
        system: VISION_SYSTEM,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'What correction does this frame need?' },
          { type: 'file', data: img, mediaType: 'image/jpeg' },
        ] }],
        temperature: 0,
      })
      return object
    } catch (e) {
      if (attempt === 2) throw e
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
    }
  }
}

// Correction → ffmpeg transpose filter (correction is what the VIEWER needs,
// i.e. rotate_90_counterclockwise means "turn the frame 90° CCW to fix it").
function transposeFor(correction) {
  switch (correction) {
    case 'rotate_90_clockwise':        return 'transpose=1'
    case 'rotate_90_counterclockwise': return 'transpose=2'
    case 'rotate_180':                 return 'transpose=1,transpose=1'
    default: return null
  }
}

// ─── db / blob / mux helpers ────────────────────────────────────────────────
const { Client } = pg
const db = new Client({ connectionString: process.env.MULTITENANT_DATABASE_URL })
await db.connect()

async function downloadTo(url, outPath) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download HTTP ${r.status}`)
  await pipeline(Readable.fromWeb(r.body), createWriteStream(outPath))
  return (await stat(outPath)).size
}

async function createMuxAsset({ inputUrl, playbackPolicy, passthrough }) {
  const auth = 'Basic ' + Buffer.from(`${process.env.MUX_TOKEN_ID}:${process.env.MUX_TOKEN_SECRET}`).toString('base64')
  const r = await fetch('https://api.mux.com/video/v1/assets', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: [{ url: inputUrl }],
      playback_policy: [playbackPolicy],
      video_quality: 'basic',
      passthrough,
    }),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`mux create ${r.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return { assetId: body?.data?.id || null, playbackId: body?.data?.playback_ids?.[0]?.id || null }
}

// ─── load rows ──────────────────────────────────────────────────────────────
let sql = `
  SELECT m.id, m.filename, m.mime_type, m.width, m.height, m.duration_s,
         m.blob_url, m.thumbnail_url, m.mux_asset_id, m.mux_playback_id,
         m.size_bytes, m.source, m.created_at,
         w.id AS workspace_id, w.slug AS workspace_slug,
         w.video_playback_policy
  FROM media_assets m
  JOIN workspaces w ON w.id = m.workspace_id
  WHERE m.kind = 'video' AND m.blob_url IS NOT NULL
`
const params = []
if (assetFilter) { params.push(assetFilter); sql += ` AND m.id = $${params.length}` }
if (wsFilter)    { params.push(wsFilter);    sql += ` AND w.slug = $${params.length}` }
sql += ' ORDER BY m.created_at DESC'
if (limit) sql += ` LIMIT ${limit}`

const { rows } = await db.query(sql, params)
console.error(`Loaded ${rows.length} video rows${DRY_RUN ? ' [DRY RUN]' : ''}`)

// ─── pass 1: detect ─────────────────────────────────────────────────────────
const detected = loadJsonl(detectLog)
const tmp = await mkdtemp(join(tmpdir(), 'orient-'))
let detectErrors = 0

for (let i = 0; i < rows.length; i++) {
  const row = rows[i]
  if (detected.has(row.id)) continue
  const tag = `[detect ${i + 1}/${rows.length}] ${row.workspace_slug} ${row.id.slice(0, 8)} ${row.filename}`
  const rec = { id: row.id, filename: row.filename, workspace_slug: row.workspace_slug, at: new Date().toISOString() }
  try {
    const p = await probe(row.blob_url)
    rec.probe = p
    if (!p.width) throw new Error('probe found no video stream')
    if (p.rotate !== 0) {
      rec.verdict = 'metadata'
      rec.correction = null
      console.error(`${tag} → METADATA rotate=${p.rotate}`)
    } else {
      const dur = Number(row.duration_s) || p.durationS || 10
      const points = dur >= 8
        ? [dur * 0.10, dur * 0.45, dur * 0.80]
        : [Math.min(0.5, dur / 2), dur / 2, Math.max(0, dur - 1)]
      const judgments = []
      for (let f = 0; f < 3; f++) {
        const fp = join(tmp, `${row.id}-f${f}.jpg`)
        await extractFrame(row.blob_url, points[f], fp)
        judgments.push(await judgeFrame(fp))
        await rm(fp, { force: true }).catch(() => {})
      }
      rec.judgments = judgments
      const corrections = judgments.map((j) => j.correction)
      const highCount = judgments.filter((j) => j.confidence === 'high').length
      // The video is rotated when EVERY frame reads as non-upright. The
      // model occasionally disagrees on the DIRECTION (an early frame can be
      // mostly floor) — take the majority direction; a wrong pick is caught
      // by the post-encode verify, which retries with the direction the
      // verify frame suggests.
      const allRotated = corrections.every((c) => c !== 'none')
      if (allRotated && highCount >= 2) {
        const counts = {}
        for (const c of corrections) counts[c] = (counts[c] || 0) + 1
        const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
        rec.verdict = 'rotated'
        rec.correction = majority[0]
        console.error(`${tag} → ROTATED needs ${majority[0]} (${corrections.join(',')} | ${judgments.map((j) => j.confidence).join('/')})`)
      } else if (corrections.every((c) => c === 'none')) {
        rec.verdict = 'ok'
        console.error(`${tag} → ok`)
      } else {
        rec.verdict = 'unclear'
        console.error(`${tag} → UNCLEAR ${corrections.join(',')} (${judgments.map((j) => j.confidence).join('/')})`)
      }
    }
  } catch (e) {
    rec.verdict = 'error'
    rec.error = e.message
    detectErrors++
    console.error(`${tag} ✗ ${e.message}`)
  }
  appendFileSync(detectLog, JSON.stringify(rec) + '\n')
  detected.set(row.id, rec)
}

const flagged = rows.filter((r) => {
  const d = detected.get(r.id)
  return d && (d.verdict === 'rotated' || d.verdict === 'metadata')
})
const tallies = {}
for (const r of rows) {
  const v = detected.get(r.id)?.verdict || 'missing'
  tallies[v] = (tallies[v] || 0) + 1
}
console.error('\n── Detection summary ──')
for (const [k, v] of Object.entries(tallies).sort((a, b) => b[1] - a[1])) console.error(`  ${k.padEnd(10)} ${v}`)

if (DETECT_ONLY || DRY_RUN) {
  console.error(`\n${flagged.length} videos flagged for fixing. ${DRY_RUN ? '[dry-run, stopping]' : '[detect-only, stopping]'}`)
  await rm(tmp, { recursive: true, force: true }).catch(() => {})
  await db.end()
  process.exit(0)
}

// ─── pass 2: fix ────────────────────────────────────────────────────────────
const fixed = loadJsonl(fixLog)
const fixTally = { fixed: 0, skipped: 0, failed: 0, verify_failed: 0 }

for (let i = 0; i < flagged.length; i++) {
  const row = flagged[i]
  if (fixed.has(row.id) && fixed.get(row.id).status === 'fixed') { fixTally.skipped++; continue }
  const det = detected.get(row.id)
  const tag = `[fix ${i + 1}/${flagged.length}] ${row.workspace_slug} ${row.id.slice(0, 8)} ${row.filename}`
  const inPath  = join(tmp, `${row.id}.in`)
  const outPath = join(tmp, `${row.id}.out.mp4`)
  const thumbPath = join(tmp, `${row.id}.thumb.jpg`)
  const rec = { id: row.id, filename: row.filename, at: new Date().toISOString() }

  try {
    if (row.mux_asset_id && (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET)) {
      throw new Error('row has a Mux asset but MUX_TOKEN_ID/SECRET are not set')
    }
    const bytes = await downloadTo(row.blob_url, inPath)
    console.error(`${tag} downloaded ${(bytes / 1e6).toFixed(0)}MB, re-encoding (${det.verdict})…`)

    // Encode + verify, with one retry if the verify frame says the first
    // direction was wrong (e.g. detection majority picked cw when the truth
    // was ccw — the verify frame then reads rotate_180 and we re-encode from
    // the ORIGINAL with the composed correction).
    // metadata class: decode-side autorotate does the rotation (vf=null);
    // vision class: explicit transpose. Both strip rotation tags.
    const encode = async (vf) => {
      const ffArgs = ['-y', '-i', inPath]
      if (vf) ffArgs.push('-vf', vf)
      ffArgs.push(
        '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        '-map_metadata', '-1',
        '-metadata:s:v:0', 'rotate=',
        outPath,
      )
      await runFfmpeg(ffArgs)
      const p = await probe(outPath)
      if (!p.width || !(await stat(outPath)).size) throw new Error('re-encode produced no usable output')
      const vfFrame = join(tmp, `${row.id}.verify.jpg`)
      await extractFrame(outPath, Math.min(2, (p.durationS || 4) / 2), vfFrame)
      const verdict = await judgeFrame(vfFrame)
      await rm(vfFrame, { force: true }).catch(() => {})
      return { outProbe: p, verdict }
    }
    // Compose two corrections (each is "rotate the frame by X to fix it").
    const DEG = { none: 0, rotate_90_clockwise: 90, rotate_90_counterclockwise: 270, rotate_180: 180 }
    const BY_DEG = { 0: null, 90: 'rotate_90_clockwise', 180: 'rotate_180', 270: 'rotate_90_counterclockwise' }
    let appliedCorrection = det.verdict === 'rotated' ? det.correction : null
    let { outProbe, verdict } = await encode(appliedCorrection ? transposeFor(appliedCorrection) : null)
    if (verdict.correction !== 'none' && det.verdict === 'rotated') {
      const composed = BY_DEG[(DEG[appliedCorrection] + DEG[verdict.correction]) % 360]
      if (composed) {
        console.error(`${tag} verify says ${verdict.correction} after ${appliedCorrection} — retrying with ${composed}`)
        appliedCorrection = composed
        ;({ outProbe, verdict } = await encode(transposeFor(composed)))
        rec.retried_with = composed
      }
    }
    if (verdict.correction !== 'none') {
      fixTally.verify_failed++
      rec.status = 'verify_failed'
      rec.verify = verdict
      console.error(`${tag} ✗ VERIFY FAILED (model says fixed file needs ${verdict.correction}) — not swapping`)
      appendFileSync(fixLog, JSON.stringify(rec) + '\n')
      continue
    }

    // Upload fixed video (original blob is left in place for revert).
    const { url: newUrl } = await put(
      `media/raw/${row.workspace_id}/rotated/${row.id}.mp4`,
      createReadStream(outPath),
      { access: 'public', contentType: 'video/mp4', token: process.env.BLOB_READ_WRITE_TOKEN, addRandomSuffix: true },
    )

    // Fresh poster thumbnail from the fixed file.
    let newThumbUrl = null
    try {
      await extractFrame(outPath, 0.5, thumbPath, { width: 480 })
      const t = await put(
        `media/thumbs/${row.id}-rotated.jpg`,
        createReadStream(thumbPath),
        { access: 'public', contentType: 'image/jpeg', token: process.env.BLOB_READ_WRITE_TOKEN, addRandomSuffix: true },
      )
      newThumbUrl = t.url
    } catch (e) {
      console.error(`${tag} thumbnail regen failed (non-fatal): ${e.message}`)
    }

    // Revert log BEFORE the row swap.
    appendFileSync(revertLog, JSON.stringify({
      id: row.id,
      old: { blob_url: row.blob_url, width: row.width, height: row.height, thumbnail_url: row.thumbnail_url, mux_asset_id: row.mux_asset_id, mux_playback_id: row.mux_playback_id },
      new: { blob_url: newUrl, width: outProbe.width, height: outProbe.height, thumbnail_url: newThumbUrl },
      at: new Date().toISOString(),
    }) + '\n')

    // Swap the row.
    const sets = ['blob_url=$1', 'width=$2', 'height=$3', 'updated_at=now()']
    const vals = [newUrl, outProbe.width, outProbe.height]
    if (newThumbUrl) { vals.push(newThumbUrl); sets.push(`thumbnail_url=$${vals.length}`) }
    vals.push(row.id)
    await db.query(`UPDATE media_assets SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals)

    // Re-ingest into Mux if the old row had a Mux asset.
    let muxNote = ''
    if (row.mux_asset_id) {
      const policy = row.video_playback_policy === 'public' ? 'public' : 'signed'
      const { assetId, playbackId } = await createMuxAsset({ inputUrl: newUrl, playbackPolicy: policy, passthrough: row.id })
      const muxSets = ['mux_asset_id=$1', 'transcode_status=$2']
      const muxVals = [assetId, 'processing']
      if (playbackId) { muxVals.push(playbackId); muxSets.push(`mux_playback_id=$${muxVals.length}`) }
      muxVals.push(row.id)
      await db.query(`UPDATE media_assets SET ${muxSets.join(', ')} WHERE id=$${muxVals.length}`, muxVals)
      muxNote = ` mux→${assetId} (old ${row.mux_asset_id} left in place)`
    }

    rec.status = 'fixed'
    rec.new_blob_url = newUrl
    rec.new_dims = `${outProbe.width}x${outProbe.height}`
    fixTally.fixed++
    console.error(`${tag} ✓ fixed → ${outProbe.width}x${outProbe.height}${muxNote}`)
  } catch (e) {
    rec.status = 'failed'
    rec.error = e.message
    fixTally.failed++
    console.error(`${tag} ✗ ${e.message}`)
  } finally {
    await rm(inPath, { force: true }).catch(() => {})
    await rm(outPath, { force: true }).catch(() => {})
    await rm(thumbPath, { force: true }).catch(() => {})
  }
  appendFileSync(fixLog, JSON.stringify(rec) + '\n')
  fixed.set(row.id, rec)
}

await rm(tmp, { recursive: true, force: true }).catch(() => {})
await db.end()

console.error('\n── Fix summary ──')
console.error(`  flagged        ${flagged.length}`)
console.error(`  fixed          ${fixTally.fixed}`)
console.error(`  already done   ${fixTally.skipped}`)
console.error(`  verify_failed  ${fixTally.verify_failed}`)
console.error(`  failed         ${fixTally.failed}`)
console.error(`  detect errors  ${detectErrors}`)
console.error(`\nState: ${stateDir}`)
