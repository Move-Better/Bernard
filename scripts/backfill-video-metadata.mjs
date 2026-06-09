// scripts/backfill-video-metadata.mjs
//
// One-time + idempotent backfill of media_assets video METADATA — width, height,
// aspect_ratio, duration_s — for rows that were ingested without it (the legacy
// `local-import` batch and any upload whose ffmpeg probe failed at ingest time).
//
// WHY: ~85% of library videos landed with null width/height (Mux `ready` webhooks
// frequently omit `data.tracks`, and the local-import path never probed). The
// Library/Slate grid can't shape a tile without dimensions, so portrait clips get
// object-cover-cropped into landscape tiles and read as "rotated / wrong". This
// fills the missing metadata so the grid can render each tile at its true aspect.
//
// This NEVER re-encodes, rotates, moves, or rewrites a single byte of the source
// blobs — it only reads stream headers over HTTP (ffmpeg -i, which stops after the
// container header) and PATCHes three currently-null columns. Fully reversible.
//
// DISPLAY dimensions: a file may store landscape pixels + a 90/270° rotation flag
// (standard for iPhone/Sony portrait capture). We store the DISPLAY dims (post-
// rotation) so they match what Mux already stores for the rows it populated, and
// what the player/grid actually renders. coded WxH is swapped when |rotation| = 90.
//
// Usage (from the project root or this worktree):
//   set -a && source "/Users/qbook/Claude Projects/Bernard/.env.local" && set +a \
//     && node scripts/backfill-video-metadata.mjs --dry-run
//   ... then without --dry-run to apply.
//
// Flags:
//   --dry-run        probe + print, do not PATCH
//   --limit=N        process at most N rows (default: all)
//   --concurrency=N  parallel probes (default 5)
//   --id=<uuid>      process a single asset (debugging)

import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in env. Source .env.local first.')
  process.exit(1)
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const LIMIT = (() => {
  const a = args.find((x) => x.startsWith('--limit='))
  return a ? parseInt(a.split('=')[1], 10) : null
})()
const CONCURRENCY = (() => {
  const a = args.find((x) => x.startsWith('--concurrency='))
  return a ? Math.max(1, parseInt(a.split('=')[1], 10) || 5) : 5
})()
const ONLY_ID = (() => {
  const a = args.find((x) => x.startsWith('--id='))
  return a ? a.split('=')[1] : null
})()

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

// Parse `ffmpeg -i <url>` stderr for coded dims, rotation, and duration. ffmpeg
// reads only the container header for a URL input and then errors ("At least one
// output file") — it does NOT download the whole file. We resolve from stderr.
function probe(url) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', url], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let err = ''
    proc.stderr.on('data', (d) => {
      err += d.toString()
      if (err.length > 512 * 1024) proc.kill('SIGKILL') // header is tiny; bail if a server streams
    })
    proc.on('close', () => resolve(parseProbe(err)))
    proc.on('error', () => resolve(null))
  })
}

function parseProbe(stderr) {
  // First video stream's coded dimensions.
  const dim = stderr.match(/Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})/)
  if (!dim) return null
  const codedW = parseInt(dim[1], 10)
  const codedH = parseInt(dim[2], 10)

  // Rotation: legacy `rotate:` atom (CW) or `displaymatrix: rotation of N` (CCW).
  // We only need whether the display is swapped vs the coded frame.
  const rotAtom = stderr.match(/rotate\s*:\s*(-?\d+)/i)
  const dm = stderr.match(/displaymatrix:\s*rotation of (-?[\d.]+)/i)
  const rawDeg = rotAtom ? parseInt(rotAtom[1], 10) : dm ? Math.round(parseFloat(dm[1])) : 0
  const absDeg = ((Math.abs(rawDeg) % 360) + 360) % 360
  const swap = absDeg === 90 || absDeg === 270

  const dispW = swap ? codedH : codedW
  const dispH = swap ? codedW : codedH

  // Duration.
  const dur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  let durationS = null
  if (dur) {
    durationS = parseInt(dur[1], 10) * 3600 + parseInt(dur[2], 10) * 60 + parseFloat(dur[3])
    durationS = Math.round(durationS * 1000) / 1000
  }

  return { codedW, codedH, dispW, dispH, rotation: absDeg, durationS }
}

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b)
  while (b) { [a, b] = [b, a % b] }
  return a || 1
}

function aspectString(w, h) {
  if (!w || !h) return null
  const g = gcd(w, h)
  return `${w / g}:${h / g}`
}

async function fetchCandidates() {
  if (ONLY_ID) {
    const r = await sb(
      `media_assets?id=eq.${ONLY_ID}&select=id,filename,source,width,height,duration_s,aspect_ratio,blob_url`,
    )
    return r.ok ? r.json() : []
  }
  // Any active video missing at least one of width / height / duration_s.
  // PostgREST OR across nullability:
  const select = 'id,filename,source,width,height,duration_s,aspect_ratio,blob_url'
  const q =
    `media_assets?kind=eq.video&archived_at=is.null` +
    `&or=(width.is.null,height.is.null,duration_s.is.null)` +
    `&select=${select}&order=created_at.desc`
  const r = await sb(q)
  if (!r.ok) {
    console.error('Candidate query failed:', r.status, await r.text().catch(() => ''))
    return []
  }
  return r.json()
}

async function processOne(row) {
  if (!row.blob_url) return { id: row.id, status: 'skip', reason: 'no_blob_url' }
  const p = await probe(row.blob_url)
  if (!p) return { id: row.id, status: 'fail', reason: 'probe_failed' }

  // Only set columns that are currently null — never clobber good Mux dims.
  const patch = {}
  if (row.width == null && p.dispW) patch.width = p.dispW
  if (row.height == null && p.dispH) patch.height = p.dispH
  if (row.aspect_ratio == null && p.dispW && p.dispH) patch.aspect_ratio = aspectString(p.dispW, p.dispH)
  if (row.duration_s == null && p.durationS != null) patch.duration_s = p.durationS

  if (Object.keys(patch).length === 0) {
    return { id: row.id, status: 'nochange', detail: `${p.dispW}x${p.dispH} ${p.durationS}s` }
  }

  const summary =
    `${row.filename || row.id}  ${p.codedW}x${p.codedH}` +
    `${p.rotation ? ` rot${p.rotation}` : ''} -> display ${p.dispW}x${p.dispH}` +
    `${patch.aspect_ratio ? ` (${patch.aspect_ratio})` : ''}` +
    `${patch.duration_s != null ? ` ${patch.duration_s}s` : ''}`

  if (DRY_RUN) return { id: row.id, status: 'dry', patch, summary }

  const r = await sb(`media_assets?id=eq.${row.id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (!r.ok) {
    return { id: row.id, status: 'fail', reason: `patch_${r.status}`, detail: await r.text().catch(() => '') }
  }
  return { id: row.id, status: 'ok', patch, summary }
}

async function runPool(rows, worker, concurrency) {
  const results = []
  let i = 0
  async function next() {
    while (i < rows.length) {
      const idx = i++
      results[idx] = await worker(rows[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, next))
  return results
}

async function main() {
  let rows = await fetchCandidates()
  if (LIMIT) rows = rows.slice(0, LIMIT)
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}candidates needing metadata: ${rows.length} (concurrency ${CONCURRENCY})\n`)

  const results = await runPool(rows, processOne, CONCURRENCY)

  const by = { ok: 0, dry: 0, nochange: 0, fail: 0, skip: 0 }
  for (const r of results) {
    by[r.status] = (by[r.status] || 0) + 1
    if (r.status === 'ok' || r.status === 'dry') console.log(`  ✓ ${r.summary}`)
    else if (r.status === 'fail') console.log(`  ✗ ${r.id}: ${r.reason}${r.detail ? ' — ' + String(r.detail).slice(0, 160) : ''}`)
    else if (r.status === 'skip') console.log(`  – ${r.id}: ${r.reason}`)
  }

  console.log(
    `\nDone. patched=${by.ok} dry=${by.dry} nochange=${by.nochange} failed=${by.fail} skipped=${by.skip}`,
  )
  if (by.fail > 0) console.log('Some probes failed (unreachable blob, non-video container, or header > 512KB). Re-run to retry — idempotent.')
}

main().catch((e) => {
  console.error('Fatal:', e?.stack || e?.message || e)
  process.exit(1)
})
