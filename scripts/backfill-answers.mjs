#!/usr/bin/env node
/**
 * backfill-answers.mjs — one-time import of the launch answer set into the new
 * `answers` table (migration 159) as `needs_review`, so the 13 real, grounded
 * answers route through the in-app review queue instead of the manual packet.
 *
 * Reads the reviewed .md files from the Movebetterco repo (the current source of
 * truth for launch content), maps each authorSlug -> the owning clinician's
 * staff_id in the movebetter workspace, and inserts. Idempotent: ON CONFLICT
 * (workspace_id, slug) DO NOTHING, so re-running is safe.
 *
 * Run:
 *   MULTITENANT_DATABASE_URL=... node scripts/backfill-answers.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const ANSWERS_DIR = '/Users/qbook/Claude Projects/Movebetterco/src/content/answers';
const WORKSPACE = '76faa447-b1f4-4038-babc-4d86536b049d'; // movebetter (main)
const STAFF = {
  q: 'ecc80e20-40af-49dd-9879-e79f65656e6b',        // Dr. Q
  zach: '4dc8770f-fde4-43b5-8095-70412ecd8506',     // Zach Cullen
  sophie: '943b7dc3-1aed-4d06-94b3-6129155f3be2',   // Dr. Sophie
  tyler: '9ad92a24-34ab-42cc-8cf4-74f582a2e504',    // Dr. Tyler
  whitney: '596542ff-36c8-4f59-b828-5ac1d69c3a26',  // Whitney Phillips
};

function fmField(fm, key) {
  const m = fm.match(new RegExp(`^${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'm'));
  if (m) return m[1].replace(/\\"/g, '"');
  const u = fm.match(new RegExp(`^${key}:\\s*([^\\n"']+?)\\s*$`, 'm'));
  return u ? u[1].trim() : null;
}

function parse(file) {
  const raw = readFileSync(join(ANSWERS_DIR, file), 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const [, fm, body] = m;
  const authorSlug = (fmField(fm, 'authorSlug') || '').toLowerCase();
  return {
    slug: file.replace(/\.md$/, ''),
    question: fmField(fm, 'question'),
    answer_lead: fmField(fm, 'answer'),
    body: body.trim(),
    condition: fmField(fm, 'condition'),
    seo_title: fmField(fm, 'seoTitle'),
    summary: fmField(fm, 'summary'),
    staff_id: STAFF[authorSlug] || null,
    authorSlug,
  };
}

const connectionString = (process.env.MULTITENANT_DATABASE_URL || '').replace(/^"(.*)"$/, '$1');
if (!connectionString) {
  console.error('MULTITENANT_DATABASE_URL not set');
  process.exit(1);
}

const files = readdirSync(ANSWERS_DIR).filter((f) => f.endsWith('.md'));
const rows = files.map(parse).filter((r) => r && r.question && r.body);

const client = new Client({ connectionString });
await client.connect();

let inserted = 0;
let skipped = 0;
const unmapped = [];
for (const r of rows) {
  if (!r.staff_id) {
    unmapped.push(`${r.slug} (authorSlug=${r.authorSlug})`);
    continue;
  }
  const res = await client.query(
    `INSERT INTO public.answers
       (workspace_id, staff_id, question, slug, answer_lead, body, condition, seo_title, summary,
        status, source, grounding_source, movebetterco_slug)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'needs_review','backfill',
        'Drafted from your own interviews in Bernard.', $4)
     ON CONFLICT (workspace_id, slug) DO NOTHING
     RETURNING id`,
    [WORKSPACE, r.staff_id, r.question, r.slug, r.answer_lead, r.body, r.condition, r.seo_title, r.summary],
  );
  if (res.rowCount > 0) inserted++;
  else skipped++;
}

await client.end();
console.log(`[backfill-answers] inserted ${inserted}, skipped(existing) ${skipped}, of ${rows.length} files`);
if (unmapped.length) console.log(`[backfill-answers] UNMAPPED (no staff_id): ${unmapped.join(', ')}`);
