#!/usr/bin/env node
// Backfill library tags (api/_lib/libraryTags.js) onto existing movebetter
// media so the website can search by pillar / condition / picture type.
// New uploads get them from tagAsset at tag time; this covers the rest.
//
// One image call per item (photo web variant / original, or a video's poster).
// Items with nothing to look at are skipped. Merges into ai_tags; never removes
// a tag. Idempotent: rows that already carry any library tag are skipped unless
// --force.
//
// Usage:
//   node scripts/backfill-library-tags.mjs [--dry-run] [--limit N] [--force]
// Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, AI_GATEWAY_API_KEY in env.

import { classifyLibraryTags, mergeLibraryTags, libraryTagImage, LIBRARY_TAGS } from '../api/_lib/libraryTags.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const DRY_RUN = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i >= 0 ? parseInt(process.argv[i + 1], 10) || null : null })()
const WORKSPACE_SLUG = 'movebetter'
const CONCURRENCY = 4

if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.AI_GATEWAY_API_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / AI_GATEWAY_API_KEY')
  process.exit(1)
}

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...init.headers },
})

const ws = (await (await sb(`workspaces?slug=eq.${WORKSPACE_SLUG}&select=id`)).json())[0]
if (!ws) { console.error('workspace not found'); process.exit(1) }

const rows = []
for (let off = 0; ; off += 500) {
  const r = await sb(`media_assets?workspace_id=eq.${ws.id}&archived_at=is.null&parent_id=is.null&select=id,kind,blob_url,web_blob_url,thumbnail_url,mime_type,ai_tags&order=id&limit=500&offset=${off}`)
  if (!r.ok) { console.error('list failed', r.status, await r.text()); process.exit(1) }
  const page = await r.json()
  rows.push(...page)
  if (page.length < 500) break
}

const lib = new Set(LIBRARY_TAGS)
let todo = rows.filter((x) => libraryTagImage(x))
const noImage = rows.length - todo.length
if (!FORCE) todo = todo.filter((x) => !(x.ai_tags || []).some((t) => lib.has(t)))
if (LIMIT) todo = todo.slice(0, LIMIT)
console.log(`${rows.length} active items, ${noImage} with no image, ${todo.length} to tag${DRY_RUN ? ' (dry run)' : ''}`)

const counts = {}
let done = 0, failed = 0, empty = 0
async function work(asset) {
  try {
    const tags = await classifyLibraryTags(asset)
    if (!tags.length) empty++
    for (const t of tags) counts[t] = (counts[t] || 0) + 1
    if (DRY_RUN) { console.log(asset.id, asset.kind, tags.join(',')); return }
    if (!tags.length) return
    const r = await sb(`media_assets?id=eq.${asset.id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH', body: JSON.stringify({ ai_tags: mergeLibraryTags(asset.ai_tags, tags) }),
    })
    if (!r.ok) throw new Error(`patch ${r.status}`)
  } catch (e) {
    failed++
    console.error(`fail ${asset.id}: ${e?.message}`)
  } finally {
    done++
    if (done % 25 === 0) console.log(`  ${done}/${todo.length}`)
  }
}
const queue = [...todo]
await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await work(queue.shift()) }))
console.log(`done: ${done}, no tags: ${empty}, failed: ${failed}`)
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}=${n}`).join(' '))
