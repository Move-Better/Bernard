// scripts/backfill-clip-detection.mjs
//
// One-time backfill: run AI clip DETECTION over the existing library so every
// genuine source video that has never been processed gets standalone-clip
// PROPOSALS waiting in the Slate/ClipFinder review queue — "use the content we
// already have."
//
// DETECTION ONLY. This is deliberate and matches the product stance:
//   - It transcribes each source (Whisper) and runs ONE LLM pass proposing
//     standalone ≤60s moments, persisted as video_segments rows (status
//     'proposed') via the SAME production code path (api/_lib/segmentDetect.js).
//   - It does NOT render clips, does NOT create content_items drafts, and does
//     NOT publish anything. A human still reviews keep/discard and approves.
//     (Auto-minting hundreds of drafts would be exactly the volume-slop we are
//     betting against; the human curation gate stays.)
//
// Idempotent: detectSegmentsForAsset() clears prior 'proposed'/'rendering' rows
// before inserting, and we only select sources with segment_status IS NULL by
// default, so re-running is safe.
//
// Scope: source uploads / captures / local-imports that are NOT derived clips
// (parent_asset_id IS NULL) and are long enough to contain a standalone moment
// (duration_s >= MIN_SOURCE_SECONDS). Too-short b-roll is skipped and REPORTED
// (no silent caps).
//
// Env required (transcription hits api.openai.com directly; the LLM pass uses the
// Vercel AI gateway):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY   (from .env.local)
//   AI_GATEWAY_API_KEY                   (from .env.local)
//   OPENAI_API_KEY                       (from the 1Password bernard-local mount)
//
// Usage (from this worktree) — note we source BOTH env files; the 1Password mount
// supplies OPENAI_API_KEY which .env.local lacks:
//   set -a \
//     && source "/Users/qbook/Claude Projects/Bernard/.env.local" \
//     && source "/Users/qbook/Claude Projects/Bernard/.env.local.1pw" \
//     && set +a \
//     && node scripts/backfill-clip-detection.mjs --dry-run
//   ... then without --dry-run to run for real.
//
// Flags:
//   --dry-run         list what WOULD be processed (no transcription, no LLM, no writes)
//   --limit=N         process at most N candidates
//   --min-seconds=N   minimum source duration to attempt (default 20)
//   --max-segments=N  cap proposals per source (default 8)
//   --concurrency=N   parallel detections (default 2 — each is ffmpeg+Whisper+LLM)
//   --include-failed  also retry sources whose previous detection failed

import { detectSegmentsForAsset } from '../api/_lib/segmentDetect.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function need(name) {
  if (!process.env[name]) {
    console.error(`Missing ${name}. Source .env.local AND .env.local.1pw first (see header).`)
    process.exit(1)
  }
}
need('SUPABASE_URL'); need('SUPABASE_SERVICE_KEY'); need('AI_GATEWAY_API_KEY'); need('OPENAI_API_KEY')

const args = process.argv.slice(2)
const flag = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split('=')[1] : def
}
const DRY_RUN = args.includes('--dry-run')
const INCLUDE_FAILED = args.includes('--include-failed')
const LIMIT = flag('limit') ? parseInt(flag('limit'), 10) : null
const MIN_SECONDS = parseInt(flag('min-seconds', '20'), 10)
const MAX_SEGMENTS = parseInt(flag('max-segments', '8'), 10)
const CONCURRENCY = Math.max(1, parseInt(flag('concurrency', '2'), 10) || 2)

const WS_FIELDS = 'id,app_name,display_name,location,clinic_context,audience_short,brand_voice'

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

const _wsCache = new Map()
async function getWorkspace(id) {
  if (_wsCache.has(id)) return _wsCache.get(id)
  const r = await sb(`workspaces?id=eq.${id}&select=${WS_FIELDS}`)
  const ws = r.ok ? (await r.json())?.[0] : null
  _wsCache.set(id, ws)
  return ws
}

async function fetchCandidates() {
  const statusFilter = INCLUDE_FAILED
    ? `&or=(segment_status.is.null,segment_status.eq.failed)`
    : `&segment_status=is.null`
  const select = 'id,filename,source,workspace_id,staff_id,blob_url,duration_s'
  const q =
    `media_assets?kind=eq.video&archived_at=is.null` +
    `&parent_asset_id=is.null` +
    `&source=in.(upload,capture_companion,local-import)` +
    statusFilter +
    `&select=${select}&order=duration_s.desc.nullslast`
  const r = await sb(q)
  if (!r.ok) {
    console.error('Candidate query failed:', r.status, await r.text().catch(() => ''))
    process.exit(1)
  }
  return r.json()
}

function fmtDur(s) {
  if (s == null) return '?:??'
  const m = Math.floor(s / 60); const r = Math.round(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

async function runPool(items, worker, concurrency) {
  let i = 0
  const results = []
  async function next() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await worker(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next))
  return results
}

async function main() {
  const all = await fetchCandidates()
  const tooShort = all.filter((a) => (a.duration_s ?? 0) < MIN_SECONDS)
  let candidates = all.filter((a) => (a.duration_s ?? 0) >= MIN_SECONDS && a.blob_url)
  if (LIMIT) candidates = candidates.slice(0, LIMIT)

  const totalMin = (candidates.reduce((s, a) => s + (a.duration_s || 0), 0) / 60).toFixed(1)
  console.log(
    `${DRY_RUN ? '[DRY RUN] ' : ''}Clip-detection backfill\n` +
    `  candidates (>=${MIN_SECONDS}s, source, unclipped): ${candidates.length}  (~${totalMin} min of video)\n` +
    `  skipped too-short (<${MIN_SECONDS}s): ${tooShort.length}\n` +
    `  max-segments/source: ${MAX_SEGMENTS}   concurrency: ${CONCURRENCY}\n`,
  )
  if (tooShort.length) {
    console.log(`  (too-short b-roll NOT processed — left for manual use):`)
    for (const a of tooShort.slice(0, 12)) console.log(`     – ${a.filename} (${fmtDur(a.duration_s)})`)
    if (tooShort.length > 12) console.log(`     … and ${tooShort.length - 12} more`)
    console.log('')
  }

  if (DRY_RUN) {
    for (const a of candidates) console.log(`  · ${fmtDur(a.duration_s).padStart(6)}  ${a.source.padEnd(14)} ${a.filename}`)
    console.log(`\n[DRY RUN] would detect on ${candidates.length} sources. No transcription/LLM/writes performed.`)
    return
  }

  let done = 0
  const started = process.hrtime.bigint()
  const results = await runPool(candidates, async (a) => {
    const ws = await getWorkspace(a.workspace_id)
    if (!ws) {
      done++
      console.log(`  ✗ [${done}/${candidates.length}] ${a.filename}: workspace ${a.workspace_id} not found`)
      return { id: a.id, status: 'failed', count: 0 }
    }
    const res = await detectSegmentsForAsset({ workspace: ws, asset: a, maxSegments: MAX_SEGMENTS })
    done++
    const tag = res.status === 'ready' ? '✓' : '✗'
    console.log(
      `  ${tag} [${done}/${candidates.length}] ${a.filename} (${fmtDur(a.duration_s)}) → ` +
      `${res.status}, ${res.count} clip${res.count === 1 ? '' : 's'}${res.note ? ` — ${res.note}` : ''}`,
    )
    return { id: a.id, ...res }
  }, CONCURRENCY)

  const ready = results.filter((r) => r.status === 'ready')
  const totalClips = ready.reduce((s, r) => s + (r.count || 0), 0)
  const failed = results.filter((r) => r.status === 'failed')
  const elapsedMin = (Number(process.hrtime.bigint() - started) / 1e9 / 60).toFixed(1)
  console.log(
    `\nDone in ${elapsedMin} min. sources_ok=${ready.length} sources_failed=${failed.length} ` +
    `total_proposals=${totalClips}`,
  )
  if (failed.length) {
    console.log('Failed sources (re-run with --include-failed to retry):')
    for (const r of failed.slice(0, 20)) console.log(`   – ${r.id}`)
  }
}

main().catch((e) => {
  console.error('Fatal:', e?.stack || e?.message || e)
  process.exit(1)
})
