#!/usr/bin/env node
// Schema-drift check: catch the "code references a column that prod doesn't
// have yet" class of prod-500s.
//
// Bernard has NO migration tracker (scripts/apply-multitenant-migrations.mjs
// applies whatever you hand it; 158 files in supabase/multitenant/migrations).
// So it's easy to merge a PR that selects a new column while the migration that
// adds it hasn't been applied to prod — the handler then 500s on first hit.
// (CLAUDE.md documents this as a recurring failure mode.)
//
// This script makes the committed snapshot `supabase/expected-schema.json` act
// as the applied-migrations ledger Bernard never had:
//
//   • default (verify):  compare the snapshot against the LIVE public schema.
//       FAIL (exit 1) if any column present in the snapshot is MISSING from
//       prod — i.e. prod fell behind / a migration wasn't applied / a column
//       was dropped out from under code that expects it.
//       WARN (exit 0) on columns/tables that exist in prod but not the snapshot
//       — that just means the snapshot needs refreshing after a new migration.
//
//   • --write:  query the live DB and (re)write the snapshot. Run this AFTER
//       you apply a migration to prod, so the snapshot tracks "what's applied".
//
//   • --from-json <file>:  build the snapshot from a flat
//       [{table_name, column_name}, ...] dump (e.g. exported via the Supabase
//       MCP) without needing a direct DB connection. Used to seed the file.
//
// DB URL resolution: process.env.MULTITENANT_DATABASE_URL first (so CI can
// inject the secret), else parsed from .env.local for local runs.

import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const SNAPSHOT_PATH = 'supabase/expected-schema.json'

const COLUMNS_QUERY = `
  select c.table_name, c.column_name
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
  order by c.table_name, c.column_name
`

function groupRows(rows) {
  const out = {}
  for (const { table_name, column_name } of rows) {
    ;(out[table_name] ||= []).push(column_name)
  }
  for (const t of Object.keys(out)) out[t] = [...new Set(out[t])].sort()
  return Object.fromEntries(Object.keys(out).sort().map((t) => [t, out[t]]))
}

// Returns the connection string, or null if it can't be resolved (caller
// decides whether to skip or fail). Never returns a REDACTED value.
async function getDbUrl() {
  if (process.env.MULTITENANT_DATABASE_URL && process.env.MULTITENANT_DATABASE_URL.trim()) {
    return process.env.MULTITENANT_DATABASE_URL.trim()
  }
  const env = await readFile('.env.local', 'utf8').catch(() => '')
  const m = env.match(/^MULTITENANT_DATABASE_URL=(.+)$/m)
  if (!m) return null
  const v = m[1].trim().replace(/^"(.*)"$/, '$1')
  if (/REDACTED/.test(v)) return null
  return v
}

// In CI a missing secret should SKIP (exit 0), not redden every PR — the check
// activates once the MULTITENANT_DATABASE_URL secret is present. Locally, a
// missing URL is an explicit error so a dev isn't fooled by a silent skip.
function bailNoDb() {
  if (process.env.CI) {
    console.log('⏭️  verify-schema-drift SKIPPED — MULTITENANT_DATABASE_URL not available in this CI context.')
    process.exit(0)
  }
  console.error(
    'MULTITENANT_DATABASE_URL not set (env) and not usable in .env.local.\n' +
      'Set it in the environment or restore the real value to .env.local from 1Password.',
  )
  process.exit(2)
}

async function queryLive() {
  const url = await getDbUrl()
  if (!url) bailNoDb()
  const { Client } = require('pg')
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const { rows } = await client.query(COLUMNS_QUERY)
    return groupRows(rows)
  } finally {
    await client.end()
  }
}

async function writeSnapshot(schema) {
  await writeFile(SNAPSHOT_PATH, JSON.stringify(schema, null, 2) + '\n')
  const tables = Object.keys(schema).length
  const cols = Object.values(schema).reduce((n, c) => n + c.length, 0)
  console.log(`Wrote ${SNAPSHOT_PATH}: ${tables} tables, ${cols} columns.`)
}

async function main() {
  const args = process.argv.slice(2)
  const fromJsonIdx = args.indexOf('--from-json')

  if (fromJsonIdx !== -1) {
    const path = args[fromJsonIdx + 1]
    if (!path) {
      console.error('Usage: node scripts/verify-schema-drift.mjs --from-json <flat-dump.json>')
      process.exit(2)
    }
    const rows = JSON.parse(await readFile(path, 'utf8'))
    await writeSnapshot(groupRows(rows))
    return
  }

  if (args.includes('--write')) {
    await writeSnapshot(await queryLive())
    return
  }

  // Verify mode
  let snapshot
  try {
    snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'))
  } catch {
    console.error(
      `No snapshot at ${SNAPSHOT_PATH}. Seed it first:\n` +
        '  node scripts/verify-schema-drift.mjs --write   (needs MULTITENANT_DATABASE_URL)',
    )
    process.exit(2)
  }

  const live = await queryLive()
  const missing = [] // expected (snapshot) but absent in prod — DANGEROUS
  const extra = [] // present in prod but not snapshot — snapshot is stale (warn)

  for (const [table, cols] of Object.entries(snapshot)) {
    const liveCols = live[table]
    if (!liveCols) {
      missing.push(`${table} (entire table missing from prod)`)
      continue
    }
    const liveSet = new Set(liveCols)
    for (const col of cols) if (!liveSet.has(col)) missing.push(`${table}.${col}`)
  }
  for (const [table, cols] of Object.entries(live)) {
    const snapCols = snapshot[table]
    if (!snapCols) {
      extra.push(`${table} (new table not in snapshot)`)
      continue
    }
    const snapSet = new Set(snapCols)
    for (const col of cols) if (!snapSet.has(col)) extra.push(`${table}.${col}`)
  }

  if (extra.length) {
    console.warn(
      `\n⚠️  ${extra.length} column(s)/table(s) exist in prod but not in the snapshot ` +
        `(snapshot is behind — run "npm run schema:snapshot" after applying migrations):`,
    )
    for (const e of extra) console.warn(`    + ${e}`)
  }

  if (missing.length) {
    console.error(
      `\n❌ SCHEMA DRIFT: ${missing.length} column(s)/table(s) the code expects are MISSING from prod.\n` +
        '   A migration is likely unapplied, or a column was dropped under code that still reads it.\n' +
        '   Apply the relevant migration to prod, or fix the snapshot if the removal was intentional:',
    )
    for (const m of missing) console.error(`    - ${m}`)
    process.exit(1)
  }

  console.log(
    `\n✅ No schema drift. All ${Object.values(snapshot).reduce((n, c) => n + c.length, 0)} ` +
      `expected columns across ${Object.keys(snapshot).length} tables are present in prod.`,
  )
}

main().catch((e) => {
  console.error('verify-schema-drift failed:', e?.message || e)
  process.exit(2)
})
