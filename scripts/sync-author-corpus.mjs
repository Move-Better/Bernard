#!/usr/bin/env node
// Sync Q's Move Better interviews into the qbook Author Mode corpus.
//
// Same logic as the Vercel cron (api/cron/sync-author-corpus.js) but runs
// locally from the command line — useful for the initial seed once qbook is
// set up, and for on-demand refreshes.
//
// Usage:
//   node scripts/sync-author-corpus.mjs [--dry-run]
//
// --dry-run  Show what would sync without indexing
//
// Required env (read from .env.local):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY

import { readFile } from 'node:fs/promises'
import { join }     from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT    = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const envText = await readFile(join(ROOT, '.env.local'), 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY']
for (const k of need) {
  if (!process.env[k] || process.env[k].includes('REDACTED')) {
    console.error(`Missing or redacted env: ${k}`); process.exit(1)
  }
}

const DRY_RUN = process.argv.includes('--dry-run')

const { syncAuthorCorpus } = await import('../api/cron/sync-author-corpus.js')
const result = await syncAuthorCorpus({ log: true, dryRun: DRY_RUN })

if (result.note) console.log(`\nNote: ${result.note}`)
console.log(`\nDone. synced=${result.synced} skipped=${result.skipped}${DRY_RUN ? ' (dry-run)' : ''}`)
if (result.wouldIndex) console.log(`Would index: ${result.wouldIndex}`)
