#!/usr/bin/env node
/**
 * Populate media_assets.transcript_words. Two modes:
 *
 *   repair (default)  — re-transcribe assets that ALREADY have words, to recover
 *                       the ones deleted by the `end > start` filter fixed in #2342.
 *   --fill-empty      — transcribe assets that have NO words at all, so clip
 *                       renders stop falling back to live Whisper on every render.
 *
 * WHY --fill-empty EXISTS
 * transcript_words is the persisted word-level Whisper output (migration 137).
 * When present, a clip render slices it (sliceWordsToWindow). When absent,
 * brandRenderVideo.js extracts audio and re-runs Whisper on EVERY render —
 * slow (a 25-28s clip blew a 10-minute shell timeout during a re-render
 * migration on 2026-07-25) and billed again each time.
 *
 * TWO GUARDS THAT ONLY MATTER IN --fill-empty, because inverting the WHERE
 * clause widens it in ways the repair mode never had to think about:
 *   kind = 'video'          — every photo in the library has NULL transcript_words
 *                             (517 of them as of 2026-07-25). Without this the
 *                             mode selects them all and hands stills to ffmpeg.
 *   parent_asset_id IS NULL — derived clips are rendered OUTPUTS whose parent
 *                             already carries the words; transcribing them again
 *                             pays twice for the same audio.
 *
 * A transcript that comes back EMPTY is not written. An empty array is
 * indistinguishable from NULL to brandRenderVideo.js (it tests
 * `captionWords.length`), so writing one buys no render speedup while making
 * the "how many are left?" verification query under-report. Those assets are
 * counted and reported as `silent` instead.
 *
 * WHY A RE-TRANSCRIPTION AND NOT A DATA MIGRATION
 * Whisper quantises word timestamps to a 20ms frame hop, so a fast function
 * word ("to", "the") or a clipped syllable legitimately returns end === start.
 * Five guards written as `end > start` deleted every one of them BEFORE
 * persistence — roughly 4% of every transcript, continuously since 2026-06-21.
 * The dropped words exist nowhere in stored data, so the only way back is to
 * ask Whisper again. Measured on asset a0643368: 6 of 150 words gone (4.0%).
 *
 * The damage reads as duplicated or reordered speech rather than as missing
 * words, which is why it looked like a transcription-ordering bug:
 *
 *   spoken   "…how to do, how fast to do high knees…"
 *   stored   "…how do how fast…"          ← zero-duration words deleted
 *
 * WHAT THIS TOUCHES
 * transcript_words. Nothing else. It deliberately does NOT call
 * detectSegmentsForAsset, which would delete status='proposed' segments
 * (segmentDetect.js) and re-run the LLM, scoring and voice classification.
 * The audio extract below is copied from that function's ffmpeg invocation so
 * the input to Whisper is byte-identical to the live path.
 *
 * SAFETY
 * Every run writes a timestamped backup of the CURRENT words for each asset it
 * is about to touch, before touching it (--backup-dir, default .backfill-backups/).
 * The old words are otherwise unrecoverable. Restore with --restore=<file>.
 *
 * A BACKUP FROM A --fill-empty RUN IS NOT AN UNDO. It records the words as they
 * were before the run, which in that mode is NULL for every row — so restoring
 * it would delete exactly what the run produced. runRestore therefore refuses
 * to shrink a populated row (same principle as the write-side guard below), and
 * a fill-empty backup will skip every row it contains. That is correct, not a
 * malfunction.
 * A row is only written when the new transcript has at least as many words as
 * the old one, unless --allow-shrink is passed — a shorter result means the
 * re-transcription went worse, and silently overwriting good data with it is
 * the one outcome worth guarding against.
 *
 * Usage:
 *   node scripts/backfill-transcript-words.mjs --dry-run
 *   node scripts/backfill-transcript-words.mjs --limit=1 --verbose
 *   node scripts/backfill-transcript-words.mjs --ids=<uuid>,<uuid>
 *   node scripts/backfill-transcript-words.mjs
 *   node scripts/backfill-transcript-words.mjs --restore=.backfill-backups/<file>.json
 *   node scripts/backfill-transcript-words.mjs --fill-empty --dry-run
 *   node scripts/backfill-transcript-words.mjs --fill-empty --purpose=interview
 *
 * Requires: MULTITENANT_DATABASE_URL + OPENAI_API_KEY.
 */

import pg from 'pg'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { unlink as unlinkP, stat as statP } from 'node:fs/promises'
import { transcribeToSegmentsAndWords } from '../api/_lib/whisper.js'
import { runFfmpegWithRetry } from './lib/ffmpegRun.mjs'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const VERBOSE = args.includes('--verbose')
const ALLOW_SHRINK = args.includes('--allow-shrink')
const FILL_EMPTY = args.includes('--fill-empty')
const purposeArg = args.find((a) => a.startsWith('--purpose='))
const PURPOSE = purposeArg ? purposeArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : null
const limitArg = args.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : null
const idsArg = args.find((a) => a.startsWith('--ids='))
const ONLY_IDS = idsArg ? idsArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : null
const restoreArg = args.find((a) => a.startsWith('--restore='))
const RESTORE_FILE = restoreArg ? restoreArg.split('=')[1] : null
const backupArg = args.find((a) => a.startsWith('--backup-dir='))
const BACKUP_DIR = backupArg ? backupArg.split('=')[1] : '.backfill-backups'
const concArg = args.find((a) => a.startsWith('--concurrency='))
const CONCURRENCY = concArg ? Math.max(1, parseInt(concArg.split('=')[1], 10)) : 3

// Mirrors segmentDetect.js.
const MAX_DETECT_SECONDS = 90 * 60

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
const envPath = '/Users/qbook/Claude Projects/Bernard/.env.local'
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
} catch { /* may already be exported */ }

const dbUrl = process.env.MULTITENANT_DATABASE_URL
if (!dbUrl) { console.error('ERROR: MULTITENANT_DATABASE_URL not set'); process.exit(1) }
if (!RESTORE_FILE && !process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY not set'); process.exit(1)
}
if (/REDACTED/.test(dbUrl)) {
  console.error('ERROR: MULTITENANT_DATABASE_URL is redacted (vercel env pull strips Sensitive vars).')
  console.error('       Restore it from 1Password before running.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// pg pool — same connection-string parser as the other backfill scripts, so a
// password containing @ doesn't choke pg's default parser.
// ---------------------------------------------------------------------------
const s = dbUrl.replace(/^postgres(ql)?:\/\//, '')
const la = s.lastIndexOf('@')
const auth = s.slice(0, la); const hp = s.slice(la + 1)
const cIdx = auth.indexOf(':')
const u = auth.slice(0, cIdx); const p = auth.slice(cIdx + 1)
const [hostport, dbq = 'postgres'] = hp.split('/')
const [h, port = '5432'] = hostport.split(':')
const { Pool } = pg
const pool = new Pool({
  host: h, port: +port, user: u, password: p,
  database: (dbq || 'postgres').split('?')[0],
  ssl: { rejectUnauthorized: false },
  max: 4,
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
// runFfmpeg / runFfmpegWithRetry / ffmpegErrorTail live in scripts/lib/ffmpegRun.mjs
// so they can be unit-tested — this file connects to Postgres and exits on
// missing env at module load, so nothing in it is importable from a test.

const text = (words) => words.map((w) => w.word).join(' ')
const zeroDur = (words) => words.filter((w) => w.end === w.start).length

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }))
  return out
}

// ---------------------------------------------------------------------------
// restore mode
// ---------------------------------------------------------------------------
async function runRestore() {
  const rows = JSON.parse(readFileSync(RESTORE_FILE, 'utf8'))
  console.log(`Restoring ${rows.length} assets from ${RESTORE_FILE}\n`)

  // A backup holds the words as they were BEFORE its run. After a --fill-empty
  // run that is NULL for every row, so restoring the file deletes exactly the
  // work the run produced — an undo that destroys rather than protects. Guard
  // on the same principle as the backfill's shrink check: never let a restore
  // reduce a row's word count unless it is asked for explicitly.
  const ids = rows.map((r) => r.id)
  const { rows: live } = await pool.query(
    `SELECT id, coalesce(jsonb_array_length(transcript_words), 0) AS n
       FROM media_assets WHERE id = ANY($1::uuid[])`, [ids],
  )
  const liveLen = new Map(live.map((r) => [r.id, Number(r.n) || 0]))

  const stats = { restored: 0, skipped: 0 }
  for (const r of rows) {
    const backupLen = r.transcript_words?.length ?? 0
    const currentLen = liveLen.get(r.id) ?? 0
    if (backupLen < currentLen && !ALLOW_SHRINK) {
      stats.skipped++
      console.log(`  SKIP  ${r.id} — backup has ${backupLen} words but the row now has ${currentLen}; pass --allow-shrink to force`)
      continue
    }
    if (DRY_RUN) { console.log(`  [dry] ${r.id} ← ${backupLen} words`); continue }
    await pool.query('UPDATE media_assets SET transcript_words = $1::jsonb WHERE id = $2::uuid',
      [JSON.stringify(r.transcript_words), r.id])
    stats.restored++
    console.log(`  restored ${r.id} ← ${backupLen} words`)
  }
  if (stats.skipped) {
    console.log(`\n${stats.skipped} row(s) skipped to avoid overwriting a populated transcript with a shorter or empty one.`)
    console.log(`If this is a --fill-empty backup, that is expected: every row in it is empty, and restoring would undo the backfill.`)
  }
  await pool.end()
}

// ---------------------------------------------------------------------------
// backfill
// ---------------------------------------------------------------------------
async function runBackfill() {
  const where = [`blob_url IS NOT NULL`, `archived_at IS NULL`]
  if (FILL_EMPTY) {
    where.push(`(transcript_words IS NULL OR jsonb_array_length(transcript_words) = 0)`)
    // See header. Photos all have NULL words; derived clips inherit their
    // parent's. Neither belongs in a "transcribe the gaps" sweep.
    where.push(`kind = 'video'`)
    where.push(`parent_asset_id IS NULL`)
  } else {
    where.push(`transcript_words IS NOT NULL`)
    where.push(`jsonb_array_length(transcript_words) > 0`)
  }
  const params = []
  if (ONLY_IDS && ONLY_IDS.length) {
    params.push(ONLY_IDS)
    where.push(`id = ANY($${params.length}::uuid[])`)
  }
  if (PURPOSE && PURPOSE.length) {
    params.push(PURPOSE)
    where.push(`asset_purpose = ANY($${params.length}::text[])`)
  }
  const { rows } = await pool.query(
    `SELECT id, filename, blob_url, duration_s, transcript_words
       FROM media_assets
      WHERE ${where.join(' AND ')}
      ORDER BY created_at ASC
      ${LIMIT ? `LIMIT ${LIMIT}` : ''}`,
    params,
  )

  const mode = FILL_EMPTY ? 'fill-empty' : 'repair'
  const mins = (rows.reduce((a, r) => a + (Number(r.duration_s) || 0), 0) / 60).toFixed(1)
  console.log(`mode: ${mode}${PURPOSE ? `  purpose: ${PURPOSE.join(',')}` : ''}`)
  console.log(`${rows.length} assets to transcribe (~${mins} min audio)${DRY_RUN ? '  (DRY RUN — no writes)' : ''}\n`)
  if (!rows.length) { await pool.end(); return }

  // Back up BEFORE touching anything. The current words are unrecoverable.
  let backupPath = null
  if (!DRY_RUN) {
    if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    backupPath = `${BACKUP_DIR}/transcript-words-${stamp}.json`
    writeFileSync(backupPath, JSON.stringify(
      rows.map((r) => ({ id: r.id, filename: r.filename, transcript_words: r.transcript_words })), null, 2))
    console.log(`Backup written: ${backupPath}`)
    console.log(`Restore with:   node scripts/backfill-transcript-words.mjs --restore=${backupPath}\n`)
  }

  const stats = { ok: 0, grew: 0, same: 0, shrank: 0, skipped: 0, failed: 0, silent: 0, nozero: 0, before: 0, after: 0, recovered: 0 }

  await mapLimit(rows, CONCURRENCY, async (row) => {
    const audioPath = `/tmp/bf-words-${row.id}.mp3`
    const oldWords = Array.isArray(row.transcript_words) ? row.transcript_words : []
    try {
      await runFfmpegWithRetry([
        '-t', String(MAX_DETECT_SECONDS),
        '-i', row.blob_url,
        '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1', '-b:a', '32k',
        '-y', audioPath,
      ], row.filename)
      const { size } = await statP(audioPath)
      if (size > 20 * 1024 * 1024) {
        // The chunked path in segmentDetect.js has known latent offset bugs and
        // has never fired in production (threshold ≈ 87 min of audio). Refuse
        // rather than write a transcript through untested code.
        stats.skipped++
        console.log(`  SKIP  ${row.filename} — audio ${(size / 1048576).toFixed(1)}MB exceeds single-call limit`)
        return
      }

      const { words: newWords } = await transcribeToSegmentsAndWords(audioPath)
      const delta = newWords.length - oldWords.length
      const zeros = zeroDur(newWords)

      stats.before += oldWords.length
      stats.after += newWords.length
      stats.recovered += Math.max(0, delta)

      if (delta > 0) stats.grew++; else if (delta === 0) stats.same++; else stats.shrank++

      // An empty result is never worth writing: brandRenderVideo.js tests
      // `captionWords.length`, so [] falls back to live Whisper exactly like
      // NULL does, and it would hide the row from the remaining-work query.
      if (!newWords.length) {
        stats.silent++
        console.log(`  SILENT ${row.filename} — Whisper returned no words; left as-is`)
        return
      }

      // WEAK HEURISTIC — do not read a warning here as "this transcript is bad".
      // The original claim ("real speech ALWAYS contains zero-duration words")
      // was wrong. Measured over 448 real transcripts on 2026-07-25, the share
      // with NO zero-duration word is entirely length-driven:
      //   <20 words 67%   20-49 14%   50-149 5%   150+ 0%
      // Zero-duration words run ~8% of tokens, so a short transcript simply may
      // not contain one. In the b-roll run 36 rows warned and at most 5 were
      // genuinely bad (~86% false positive), and every flagged 50-112 word
      // transcript was verified as real coherent speech.
      // Useful only as: a LONG transcript with none is worth a look. It is NOT
      // a hallucination detector — Whisper's silent-audio filler ("Thank you
      // for watching") is short, which is exactly where this signal is noise.
      if (!zeros) {
        stats.nozero++
        console.log(`  WARN  ${row.filename} — ${newWords.length} words but ZERO zero-duration${newWords.length >= 50 ? '; worth a look' : ' (short transcript — usually chance, not a defect)'}`)
      }

      if (delta < 0 && !ALLOW_SHRINK) {
        stats.skipped++
        console.log(`  SKIP  ${row.filename} — new transcript is SHORTER (${oldWords.length} → ${newWords.length}); pass --allow-shrink to force`)
        return
      }

      const sign = delta > 0 ? `+${delta}` : String(delta)
      console.log(`  ${DRY_RUN ? '[dry]' : 'ok   '} ${row.filename}  ${oldWords.length} → ${newWords.length} (${sign}, ${zeros} zero-dur)`)
      if (VERBOSE) {
        console.log(`         old: ${text(oldWords).slice(0, 160)}`)
        console.log(`         new: ${text(newWords).slice(0, 160)}`)
      }

      if (!DRY_RUN) {
        // transcript_words ONLY. Never segment_status / segments_detected_at.
        await pool.query('UPDATE media_assets SET transcript_words = $1::jsonb WHERE id = $2::uuid',
          [JSON.stringify(newWords), row.id])
      }
      stats.ok++
    } catch (e) {
      stats.failed++
      console.log(`  FAIL  ${row.filename} — ${e?.message?.slice(0, 160)}`)
    } finally {
      await unlinkP(audioPath).catch(() => {})
    }
  })

  const pct = stats.before ? ((stats.recovered / stats.before) * 100).toFixed(1) : '0.0'
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`written ${stats.ok}   grew ${stats.grew}   unchanged ${stats.same}   shorter ${stats.shrank}   skipped ${stats.skipped}   silent ${stats.silent}   failed ${stats.failed}`)
  if (FILL_EMPTY) console.log(`words 0 → ${stats.after}`)
  else console.log(`words ${stats.before} → ${stats.after}   recovered ${stats.recovered} (+${pct}%)`)
  if (stats.nozero) console.log(`WARN ${stats.nozero} transcript(s) had no zero-duration words — a weak, length-driven signal (mostly false positives on short clips); only the long ones are worth checking`)
  if (backupPath) console.log(`backup ${backupPath}`)
  await pool.end()
}

await (RESTORE_FILE ? runRestore() : runBackfill())
