// Backfill: index approved/published content_items that are missing from the
// practice-memory RAG corpus (F6, 2026-06-27).
//
// The live indexing hook only fired on the `status -> 'approved'` PATCH, so
// publish-direct items (and bodies edited in place) never produced chunks —
// a prod probe found ~half of recent published rows had zero content_item
// chunks. The call-site fix (api/_routes/db/content.js) closes the gap going
// forward; this script fills the historical hole.
//
// It re-uses the real indexer (indexContentItem) so chunking/embedding/labels
// match exactly. Idempotent: indexContentItem upserts on the unique key and
// prunes orphan chunks, so re-running is safe.
//
// Required env (Sensitive — never echo): SUPABASE_URL, SUPABASE_SERVICE_KEY,
// OPENAI_API_KEY, AI_GATEWAY_API_KEY.
//
// Usage (from the project root, with env loaded):
//   node scripts/backfill-content-rag.mjs --dry-run   # list what's missing
//   node scripts/backfill-content-rag.mjs             # index the missing items
//   node scripts/backfill-content-rag.mjs --all       # re-index ALL approved/published

import { indexContentItem } from '../api/_lib/practiceMemoryRag.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const DRY_RUN = process.argv.includes('--dry-run')
const ALL = process.argv.includes('--all')

function requireEnv() {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY', 'AI_GATEWAY_API_KEY']
    .filter((k) => !process.env[k])
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(', ')}`)
    console.error('Load the Bernard env first (see header), then re-run.')
    process.exit(1)
  }
}

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  })
}

async function fetchAll(pathBase) {
  // PostgREST caps rows per response; page with Range until exhausted.
  const PAGE = 1000
  let from = 0
  const rows = []
  for (;;) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathBase}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Range: `${from}-${from + PAGE - 1}`,
      },
    })
    if (!r.ok) throw new Error(`fetch ${pathBase} ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const batch = await r.json()
    rows.push(...batch)
    if (batch.length < PAGE) break
    from += PAGE
  }
  return rows
}

async function main() {
  requireEnv()

  console.log('Loading approved/published content_items…')
  const items = await fetchAll('content_items?status=in.(approved,published)&select=id,workspace_id,status')
  console.log(`  ${items.length} corpus-eligible items`)

  console.log('Loading existing content_item chunks…')
  const chunks = await fetchAll('practice_memory_chunks?source_type=eq.content_item&select=source_id')
  const indexed = new Set(chunks.map((c) => c.source_id))
  console.log(`  ${indexed.size} items already have chunks`)

  const targets = ALL ? items : items.filter((it) => !indexed.has(it.id))
  console.log(`\n${ALL ? 'Re-indexing ALL' : 'Missing from corpus'}: ${targets.length} items`)

  if (DRY_RUN) {
    for (const it of targets) console.log(`  [dry-run] ${it.status}  ws=${it.workspace_id}  item=${it.id}`)
    console.log(`\nDry run — nothing written. ${targets.length} items would be indexed.`)
    return
  }

  let ok = 0
  let failed = 0
  let chunksWritten = 0
  for (const [i, it] of targets.entries()) {
    const res = await indexContentItem({ workspaceId: it.workspace_id, contentItemId: it.id })
    const n = res?.indexed ?? 0
    if (res?.error) {
      failed++
      console.error(`  [${i + 1}/${targets.length}] FAIL item=${it.id}: ${res.error}`)
    } else {
      ok++
      chunksWritten += n
      console.log(`  [${i + 1}/${targets.length}] item=${it.id} → ${n} chunk(s)${res?.skipped ? ` (skip: ${res.skipped})` : ''}`)
    }
  }

  console.log(`\nDone. ${ok} indexed (${chunksWritten} chunks), ${failed} failed of ${targets.length}.`)
  if (failed) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
