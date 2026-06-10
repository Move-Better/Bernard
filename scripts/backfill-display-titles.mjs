#!/usr/bin/env node
// Backfill display_title on existing media_assets rows.
//
// Migration 127 added display_title (the human-readable name that replaces
// IMG_*.mov across Slate / Library / picker). New uploads get a title from
// tagAsset at tag time; this script covers everything tagged before that.
//
// Text-only generation: titles derive from the metadata the tagger already
// extracted (transcription / visual_narrative / ai_tags) — no video download,
// no vision call. Rows with none of those signals are skipped, not guessed
// (per the no-fabricated-data rule); they'll get a title on their next re-tag.
//
// Usage (from project root):
//   cd "/Users/qbook/Claude Projects/Bernard" && \
//   set -a && source .env.local && set +a && \
//   node scripts/backfill-display-titles.mjs [--dry-run] [--limit N]
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, AI_GATEWAY_API_KEY in env.
// Idempotent — only touches rows where display_title IS NULL.

import { generateText } from 'ai'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const DRY_RUN      = process.argv.includes('--dry-run')
const LIMIT_ARG    = (() => {
  const i = process.argv.indexOf('--limit')
  return i >= 0 ? parseInt(process.argv[i + 1], 10) || null : null
})()
const MODEL       = 'google/gemini-2.5-flash'
const BATCH_SIZE  = 50
const CONCURRENCY = 6

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required')
  process.exit(1)
}
if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('AI_GATEWAY_API_KEY is required')
  process.exit(1)
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

function buildPrompt(row) {
  const parts = [
    'Write a display title for one piece of clinic media: a natural 4–9 word title a producer recognizes at a glance — what is happening plus who or what is in frame.',
    'Examples: "Kettlebell hinge coaching with a patient", "Gym floor at golden hour", "Front-desk chat about first visits".',
    'Sentence case. Plain words. No hashtags, no quotes, no trailing period. Never echo the filename.',
    'Return ONLY the title text.',
    '',
    `Kind: ${row.kind}`,
  ]
  if (row.visual_narrative) parts.push(`What the camera shows: ${row.visual_narrative}`)
  if (row.transcription)    parts.push(`Spoken excerpt: ${String(row.transcription).slice(0, 1200)}`)
  if (Array.isArray(row.ai_tags) && row.ai_tags.length) parts.push(`Tags: ${row.ai_tags.join(', ')}`)
  return parts.join('\n')
}

function hasSignal(row) {
  return Boolean(
    (row.visual_narrative && row.visual_narrative.trim()) ||
    (row.transcription && row.transcription.trim()) ||
    (Array.isArray(row.ai_tags) && row.ai_tags.length > 0),
  )
}

async function titleFor(row) {
  const { text } = await generateText({
    model: MODEL,
    prompt: buildPrompt(row),
    temperature: 0.3,
  })
  const title = String(text || '')
    .trim()
    .replace(/^["'“”]+|["'“”.]+$/g, '')
    .slice(0, 120)
  // A title that's just the filename back, empty, or one word is a refusal.
  if (!title || title.split(/\s+/).length < 2) return null
  if (row.filename && title.toLowerCase() === String(row.filename).toLowerCase()) return null
  return title
}

async function run() {
  let offset = 0
  let updated = 0
  let skippedNoSignal = 0
  let failed = 0

  for (;;) {
    const r = await sb(
      `media_assets?display_title=is.null&archived_at=is.null&select=id,kind,filename,transcription,visual_narrative,ai_tags&order=created_at.desc&limit=${BATCH_SIZE}&offset=${offset}`,
      { headers: { Prefer: 'return=representation' } },
    )
    if (!r.ok) throw new Error(`fetch failed: ${r.status} ${await r.text()}`)
    const rows = await r.json()
    if (rows.length === 0) break

    let patchedThisPage = 0
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY)
      await Promise.all(chunk.map(async (row) => {
        if (LIMIT_ARG && updated >= LIMIT_ARG) return
        if (!hasSignal(row)) { skippedNoSignal++; return }
        try {
          const title = await titleFor(row)
          if (!title) { failed++; return }
          if (DRY_RUN) {
            console.log(`[dry] ${row.filename || row.id} → "${title}"`)
            updated++
            return
          }
          const upd = await sb(`media_assets?id=eq.${row.id}&display_title=is.null`, {
            method: 'PATCH',
            body: JSON.stringify({ display_title: title }),
          })
          if (!upd.ok) throw new Error(`patch ${upd.status}`)
          updated++
          patchedThisPage++
          console.log(`✓ ${row.filename || row.id} → "${title}"`)
        } catch (e) {
          failed++
          console.error(`✗ ${row.id}: ${e?.message}`)
        }
      }))
      if (LIMIT_ARG && updated >= LIMIT_ARG) break
    }

    if (LIMIT_ARG && updated >= LIMIT_ARG) break
    if (rows.length < BATCH_SIZE) break
    // Patched rows leave the display_title=is.null result set; skipped/failed
    // rows stay. Advance the window past exactly the rows that will reappear,
    // so an all-skip page can never refetch itself forever.
    offset += rows.length - patchedThisPage
  }

  console.log(`\nDone. ${DRY_RUN ? '(dry run) ' : ''}titled=${updated} no-signal-skipped=${skippedNoSignal} failed=${failed}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
