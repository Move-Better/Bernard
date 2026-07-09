// Backfill body-region / theme tags onto existing interviews + content_items.
//
// One-shot after migration 164. Classifies each interview's topic (cached by
// topic string so we pay one model call per distinct topic) and stamps
// region/theme onto the interview and every content_item generated from it, plus
// any interview-less content_items that still carry a topic. Only fills rows
// where region IS NULL — never clobbers a value already set.
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, AI_GATEWAY_API_KEY in env.
// Run:  node scripts/backfill-content-region.mjs [--dry-run]
import { classifyTopicRegion, regionLabel } from '../api/_lib/topicRegion.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const DRY = process.argv.includes('--dry-run')

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1)
}
if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('Missing AI_GATEWAY_API_KEY — classifier would return general for everything'); process.exit(1)
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...init.headers,
    },
  })
}

const cache = new Map() // normalized topic -> { region, theme }
async function classifyCached(topic) {
  const key = String(topic || '').trim().toLowerCase()
  if (!key) return { region: 'general', theme: null }
  if (cache.has(key)) return cache.get(key)
  const out = await classifyTopicRegion(topic)
  cache.set(key, out)
  return out
}

async function main() {
  // 1) Interviews without a region.
  const ivRes = await sb('interviews?region=is.null&select=id,workspace_id,topic&limit=5000')
  if (!ivRes.ok) throw new Error(`interviews fetch ${ivRes.status}: ${await ivRes.text()}`)
  const interviews = await ivRes.json()
  console.log(`Interviews to classify: ${interviews.length}`)

  let ivDone = 0
  const tally = {}
  for (const iv of interviews) {
    const { region, theme } = await classifyCached(iv.topic)
    tally[region] = (tally[region] || 0) + 1
    if (!DRY) {
      const body = JSON.stringify({ region, theme })
      const wsFilter = `workspace_id=eq.${iv.workspace_id}`
      const a = await sb(`interviews?id=eq.${iv.id}&${wsFilter}`, { method: 'PATCH', body })
      if (!a.ok) console.error(`  interview ${iv.id} PATCH ${a.status}`)
      const b = await sb(`content_items?interview_id=eq.${iv.id}&${wsFilter}&region=is.null`, { method: 'PATCH', body })
      if (!b.ok) console.error(`  content_items(interview ${iv.id}) PATCH ${b.status}`)
    }
    ivDone++
    if (ivDone % 25 === 0) console.log(`  ...${ivDone}/${interviews.length}`)
  }

  // 2) Interview-less content_items that still carry a topic (imports/manual).
  const ciRes = await sb('content_items?region=is.null&interview_id=is.null&topic=not.is.null&select=id,workspace_id,topic&limit=5000')
  if (!ciRes.ok) throw new Error(`content_items fetch ${ciRes.status}: ${await ciRes.text()}`)
  const orphans = await ciRes.json()
  console.log(`Interview-less content_items to classify: ${orphans.length}`)
  for (const ci of orphans) {
    if (!String(ci.topic || '').trim()) continue
    const { region, theme } = await classifyCached(ci.topic)
    tally[region] = (tally[region] || 0) + 1
    if (!DRY) {
      const r = await sb(`content_items?id=eq.${ci.id}&workspace_id=eq.${ci.workspace_id}`, {
        method: 'PATCH', body: JSON.stringify({ region, theme }),
      })
      if (!r.ok) console.error(`  content_item ${ci.id} PATCH ${r.status}`)
    }
  }

  console.log(`\n${DRY ? '[dry-run] ' : ''}Classified region tally (by source row):`)
  for (const [slug, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${regionLabel(slug).padEnd(22)} ${n}`)
  }
  console.log(`\nDistinct topics classified (model calls): ${cache.size}`)
}

main().then(() => { console.log('Done.'); process.exit(0) })
  .catch((e) => { console.error(e); process.exit(1) })
