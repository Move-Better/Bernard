#!/usr/bin/env node
// Local dry-run/manual-run wrapper for api/_lib/producer/coachingNoteGenerator.js
// — the same logic the weekly cron (api/_routes/cron/generate-coaching-note.js)
// runs. One implementation, used from both places.
//
// Usage: node scripts/generate-coaching-note.mjs [--workspace=<slug>] [--dry-run]

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')
const ONLY_SLUG = process.argv.find((a) => a.startsWith('--workspace='))?.split('=')[1] || null

const envText = await readFile(join(ROOT, '.env.local'), 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const { generateCoachingNotes } = await import(pathToFileURL(join(ROOT, 'api/_lib/producer/coachingNoteGenerator.js')))

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_URL/SUPABASE_SERVICE_KEY'); process.exit(1) }
if (!process.env.AI_GATEWAY_API_KEY) { console.error('Missing AI_GATEWAY_API_KEY'); process.exit(1) }

const result = await generateCoachingNotes({ dryRun: DRY_RUN, onlySlug: ONLY_SLUG })
console.log(`${result.workspaces} workspace(s), ${result.written} note(s) ${DRY_RUN ? 'would be written' : 'written'}`)
for (const n of result.notes) console.log(`\n=== ${n.slug} ===\n${n.note}`)
