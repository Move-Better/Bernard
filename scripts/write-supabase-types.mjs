#!/usr/bin/env node
// Writes api/_lib/supabase.types.d.ts — generated TypeScript types for the live
// Supabase schema, so opted-in JS files (// @ts-check + a tsconfig.json `include`
// entry) can get compile-time checking that a row-shape assumption (a column
// name, a write-allowlist key) actually matches a real column. See
// ARCHITECTURE.md "Generated DB types (api/_lib/supabase.types.d.ts)" for the
// full contract, what this does and doesn't catch, and the seed-file pattern.
//
// Sibling to supabase/expected-schema.json + scripts/verify-schema-drift.mjs
// (npm run schema:snapshot / schema:verify) — same underlying live schema, same
// "regenerate after every migration" discipline, same reason for a --from-file
// path: there is no @supabase/supabase-js, no SUPABASE_ACCESS_TOKEN for the
// `supabase gen types typescript --project-id ...` CLI, and
// MULTITENANT_DATABASE_URL is a Sensitive Vercel env var `vercel env pull`
// redacts — so there is no unattended/CI-scriptable fetch path today. Unlike
// schema:snapshot, this cannot self-serve from a secret in CI.
//
// Regeneration workflow (manual, by design — don't invent a fake automated one):
//   1. In an agent session with Supabase MCP access, call
//      generate_typescript_types with this project's id.
//      Fetch the project id from `supabase/expected-schema.json`'s sibling
//      tooling, or ask — do not hardcode a guessed id here.
//   2. Save that tool's raw JSON result (the `{"types": "..."}` shape the MCP
//      tool returns) to a scratch file.
//   3. Run: node scripts/write-supabase-types.mjs --from-file <scratch-file>
//
// Do this in the SAME commit as `npm run schema:snapshot` after applying a
// migration to prod — both derive from the same live information_schema and go
// stale identically. A stale supabase.types.d.ts is worse than none for an
// opted-in file: if a migration drops a column and nobody regenerates, tsc
// stays green while prod 400s (same staleness risk verify-schema-drift.mjs
// already documents for expected-schema.json).

import { readFile, writeFile } from 'node:fs/promises'

const OUT_PATH = 'api/_lib/supabase.types.d.ts'

function usage() {
  console.error('Usage: node scripts/write-supabase-types.mjs --from-file <path>')
  console.error('  <path> is the raw MCP generate_typescript_types tool result,')
  console.error('  either the {"types": "..."} JSON shape or a plain .ts/.d.ts file.')
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  const fromFileIdx = args.indexOf('--from-file')
  if (fromFileIdx === -1 || !args[fromFileIdx + 1]) usage()
  const inputPath = args[fromFileIdx + 1]

  const raw = await readFile(inputPath, 'utf8')

  // The MCP tool's saved result is `{"types": "export type Json = ...\n..."}` —
  // a JSON object with the TS source as an escaped string value. Detect and
  // unwrap that; fall back to treating the input as already-plain TS source
  // (e.g. if someone pastes just the `types` field, or uses the raw CLI output).
  let source
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch (e) {
      console.error(`--from-file looks like JSON but failed to parse: ${e?.message}`)
      process.exit(1)
    }
    if (typeof parsed.types !== 'string') {
      console.error('--from-file parsed as JSON but has no string "types" field.')
      process.exit(1)
    }
    source = parsed.types
  } else {
    source = raw
  }

  if (!source.includes('export type Database')) {
    console.error('Input does not contain "export type Database" — does not look like')
    console.error('a Supabase-generated types file. Refusing to write a bad artifact.')
    process.exit(1)
  }

  const tableCount = (source.match(/^\s{6}\w+: \{\n\s+Row: \{/gm) || []).length

  const header = `// GENERATED FILE — do not hand-edit. Regenerate via scripts/write-supabase-types.mjs.
// Source: Supabase MCP generate_typescript_types, public schema.
// Generated: ${new Date().toISOString()}
//
// See ARCHITECTURE.md "Generated DB types (api/_lib/supabase.types.d.ts)" for:
//   - the opt-in consumption pattern (// @ts-check + a tsconfig.json include entry)
//   - what this catches (a column that was renamed/dropped/never applied) vs.
//     what it does NOT catch (a SELECT/PATCH column-list mismatch on an
//     explicit-column select=; free-form JSONB shapes like media_urls)
//   - the regeneration workflow — this file has no unattended/CI fetch path
//
// Sibling artifact: supabase/expected-schema.json (npm run schema:snapshot /
// schema:verify) — regenerate both together, same live-schema source.
// Table count at generation time: ${tableCount}

`

  await writeFile(OUT_PATH, header + source, 'utf8')
  console.log(`Wrote ${OUT_PATH} (${tableCount} tables, ${source.length} chars of source)`)
}

main().catch((e) => {
  console.error(e?.stack || e)
  process.exit(1)
})
