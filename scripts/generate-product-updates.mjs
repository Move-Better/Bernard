#!/usr/bin/env node
// Local dry-run/manual-run wrapper for api/_lib/producer/productUpdatesGenerator.js
// — the same logic the nightly cron (api/_routes/cron/generate-product-updates.js)
// runs. One implementation, used from both places.
//
// Usage: node scripts/generate-product-updates.mjs [--dry-run]

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')

const envText = await readFile(join(ROOT, '.env.local'), 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const { generateProductUpdates } = await import(pathToFileURL(join(ROOT, 'api/_lib/producer/productUpdatesGenerator.js')))

if (!process.env.GITHUB_TOKEN_BERNARD_READ) { console.error('Missing GITHUB_TOKEN_BERNARD_READ'); process.exit(1) }
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_URL/SUPABASE_SERVICE_KEY'); process.exit(1) }
if (!process.env.AI_GATEWAY_API_KEY) { console.error('Missing AI_GATEWAY_API_KEY'); process.exit(1) }

const result = await generateProductUpdates({ dryRun: DRY_RUN })
console.log(`${result.candidates} candidate PR(s), ${result.inserted} entr${result.inserted === 1 ? 'y' : 'ies'} ${DRY_RUN ? 'would be written' : 'written'}`)
if (DRY_RUN) console.log(JSON.stringify(result.entries, null, 2))
