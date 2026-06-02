#!/usr/bin/env node
// One-off: ingests Move Better People + Animals blog posts into the NarrateRx
// Source Library (staff_corpus_documents + practice_memory_chunks).
//
// What it does:
//   People workspace  — 43 posts attributed to Q / Dr. Zach / Dr. Whitney.
//                       Ingested as voice corpus + Book KB. NOT activated as
//                       stories — activate selectively from AuthorMode later.
//   Animals workspace — 4 posts (Dr. Whitney ×3, Dr. Q ×1).
//                       Ingested as voice corpus + Book KB. The 4 URLs are
//                       printed at the end — use the URL Import lane in the app
//                       to activate them as Instagram / Facebook / GBP stories.
//
// Idempotent: the (workspace_id, staff_id, doc_type, title) unique constraint
// means re-running upserts in place; indexing is also idempotent via
// (source_type, source_id, chunk_index) conflict resolution.
//
// Usage (from NarrateRx project root):
//   node scripts/ingest-movebetter-blogs.mjs
//   node scripts/ingest-movebetter-blogs.mjs --dry-run
//   node scripts/ingest-movebetter-blogs.mjs --workspace=people
//   node scripts/ingest-movebetter-blogs.mjs --workspace=animals
//
// Requires in .env.local:
//   SUPABASE_URL          (Sensitive)
//   SUPABASE_SERVICE_KEY  (Sensitive)
//   OPENAI_API_KEY        (Sensitive)   — used by embedTexts()
//
// Cost estimate: ~$0.0001 per post (1536-dim embedding × ~10 chunks each).
// Full run of 47 posts ≈ $0.005. Negligible.

import { readFile }  from 'node:fs/promises'
import { execSync }  from 'node:child_process'

// ─── Args ────────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2)
const DRY_RUN     = args.includes('--dry-run')
const ONLY_WS     = (args.find((a) => a.startsWith('--workspace=')) ?? '').split('=')[1] || null

// ─── Load .env.local into process.env ────────────────────────────────────────

const envFile = await readFile('.env.local', 'utf8').catch(() => '')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (!m) continue
  const [, k, raw] = m
  if (!process.env[k]) process.env[k] = raw.trim().replace(/^"(.*)"$/, '$1')
}

for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY']) {
  if (!process.env[k]) {
    console.error(`Missing required env: ${k}\nRun from project root with .env.local present.`)
    process.exit(1)
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// ─── Constants — verified 2026-06-01 against narraterx prod ──────────────────

const WORKSPACES = {
  people: {
    id:    '76faa447-b1f4-4038-babc-4d86536b049d',
    slug:  'movebetter-people',
    repo:  'Move-Better/Movebetterco',
    blogPath: 'src/content/blog',
  },
  animals: {
    id:    'd7527281-d0e6-49e3-8bfd-2cca1a5fb25d',
    slug:  'movebetter-animals',
    repo:  'Move-Better/movebetteranimal',
    blogPath: 'src/content/blog',
  },
}

const STAFF_IDS = {
  people: {
    'michael-quasney': 'ecc80e20-40af-49dd-9879-e79f65656e6b',
    'whitney-phillips': '596542ff-36c8-4f59-b828-5ac1d69c3a26',
    'zachary-cullen':  '4dc8770f-fde4-43b5-8095-70412ecd8506',
  },
  animals: {
    'michael-quasney': '7d80b811-e95f-40e1-b0d8-acfaf2ffdcb9',
    'whitney-phillips': 'd56e362f-eb9d-460d-b4c1-bcb5d971614d',
  },
}

// ─── Module import (after env is loaded) ─────────────────────────────────────

const { indexOriginalBlog } = await import('../api/_lib/practiceMemoryRag.js')

// ─── GitHub helpers ───────────────────────────────────────────────────────────

function ghApi(path) {
  return JSON.parse(execSync(`gh api "${path}"`, { maxBuffer: 10 * 1024 * 1024 }).toString())
}

function listBlogFiles(repo, blogPath) {
  const files = ghApi(`repos/${repo}/contents/${blogPath}`)
  return files
    .filter((f) => f.type === 'file' && f.name.endsWith('.md') && f.name !== '.gitkeep')
    .map((f) => f.name)
}

function readBlogFile(repo, blogPath, filename) {
  const meta = ghApi(`repos/${repo}/contents/${blogPath}/${filename}`)
  return Buffer.from(meta.content, 'base64').toString('utf8')
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/m)
  if (!match) return { fields: {}, body: raw }
  const fm    = {}
  const lines = match[1].split('\n')
  for (const line of lines) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/)
    if (!kv) continue
    const [, k, v] = kv
    fm[k] = v.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  }
  return { fields: fm, body: match[2].trim() }
}

// ─── Supabase upsert ──────────────────────────────────────────────────────────

async function upsertCorpusDoc({ workspaceId, staffId, title, body, sourceUrl, docDate }) {
  const payload = {
    workspace_id: workspaceId,
    staff_id:     staffId,
    doc_type:     'original_blog',
    title:        title.slice(0, 300),
    body,
    updated_at:   new Date().toISOString(),
    ...(sourceUrl ? { source_url: sourceUrl } : {}),
    ...(docDate   ? { doc_date:   docDate   } : {}),
  }

  const r = await fetch(`${SUPABASE_URL}/rest/v1/staff_corpus_documents`, {
    method:  'POST',
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify(payload),
  })

  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`Supabase upsert failed ${r.status}: ${text.slice(0, 200)}`)
  }
  const [doc] = await r.json()
  return doc
}

// ─── Process one workspace ────────────────────────────────────────────────────

async function processWorkspace(wsKey) {
  const ws      = WORKSPACES[wsKey]
  const staffMap = STAFF_IDS[wsKey]

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`Workspace: ${wsKey} (${ws.id})`)
  console.log(`Repo:      ${ws.repo}`)
  console.log(`${'═'.repeat(60)}`)

  const filenames = listBlogFiles(ws.repo, ws.blogPath)
  console.log(`Found ${filenames.length} blog files`)

  let ingested = 0, skipped = 0, failed = 0
  const results = []

  for (const filename of filenames) {
    const slug = filename.replace(/\.md$/, '')

    try {
      const raw = readBlogFile(ws.repo, ws.blogPath, filename)
      const { fields, body } = parseFrontmatter(raw)

      // Skip draft posts (announcement-type content)
      if (fields.draft === 'true' || fields.draft === true) {
        console.log(`  SKIP (draft)  ${slug}`)
        skipped++
        continue
      }

      // Resolve title — prefer frontmatter; fall back to slug
      const title = fields.title || slug

      // Resolve author → staffId
      const authorSlug = fields.authorSlug || null
      const staffId    = authorSlug ? staffMap[authorSlug] : null

      if (!staffId) {
        console.log(`  SKIP (no staff match for authorSlug="${authorSlug}")  ${slug}`)
        skipped++
        continue
      }

      // Resolve date — both formats used across the two repos
      const docDate = fields.publishedAt || fields.pubDate || null

      // Resolve source URL
      const sourceUrl = fields.sourceUrl || null

      console.log(`  ${DRY_RUN ? 'DRY ' : ''}INGEST  ${slug}  (${authorSlug})`)

      if (DRY_RUN) {
        ingested++
        results.push({ slug, staffId, title, sourceUrl })
        continue
      }

      // 1. Upsert corpus document row
      const doc = await upsertCorpusDoc({
        workspaceId: ws.id,
        staffId,
        title,
        body,
        sourceUrl,
        docDate,
      })

      // 2. Index into practice_memory_chunks (embeddings + RAG).
      //    Awaited inside here — if this were fire-and-forget the caller
      //    would return and the embedding would never run (Vercel lesson).
      await indexOriginalBlog({
        workspaceId: ws.id,
        staffId,
        blogId:      doc.id,
        title:       doc.title,
        body:        doc.body,
        publishedAt: doc.doc_date,
      })

      ingested++
      results.push({ slug, staffId, title, sourceUrl, docId: doc.id })
    } catch (e) {
      console.error(`  FAIL  ${slug}: ${e?.message}`)
      failed++
    }
  }

  console.log(`\nDone: ${ingested} ingested · ${skipped} skipped · ${failed} failed`)
  return results
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (DRY_RUN) console.log('\n🔍 DRY RUN — no DB writes\n')

const allResults = {}

for (const wsKey of ['people', 'animals']) {
  if (ONLY_WS && ONLY_WS !== wsKey) continue
  allResults[wsKey] = await processWorkspace(wsKey)
}

// ─── Animals activation reminder ─────────────────────────────────────────────
// Corpus ingest is done. Stories are activated separately via the URL import
// lane in the NarrateRx app so the full social-generation pipeline runs.

if (!ONLY_WS || ONLY_WS === 'animals') {
  const animalResults = allResults.animals ?? []
  if (animalResults.length > 0) {
    console.log(`
${'═'.repeat(60)}
NEXT STEP — Activate Animals posts as IG / FB / GBP stories
${'═'.repeat(60)}
The 4 Animals posts are now in the corpus.
To generate social story drafts, use the URL Import lane in the
NarrateRx app (movebetter-animals workspace):

  Settings → URL Import → paste each URL below:
`)
    for (const r of animalResults) {
      if (r.sourceUrl) {
        console.log(`  ${r.sourceUrl}`)
      } else {
        console.log(`  [no sourceUrl recorded for "${r.title}" — find it on the live site]`)
      }
    }
    console.log(`
Choose: Instagram, Facebook, and Google Business Profile
when prompted for channels.
`)
  }
}

console.log('All done.')
