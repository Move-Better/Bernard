#!/usr/bin/env node
/**
 * Transcription vendor bake-off on REAL media_assets.
 *
 * Why: OpenAI retires whisper-1 / gpt-4o-transcribe on 2027-02-26, and Bernard's
 * karaoke captions (api/_lib/karaokeCaptions.js) are built from WORD timestamps.
 * No leaderboard measures timestamp behaviour, so this runs the same clips through
 * every candidate and measures what actually breaks reels. Findings doc:
 * .claude/nemotron-transcription-findings.md.
 *
 * Usage (from the repo root, keys in env — see the findings doc for the 1Password recipe):
 *   node scripts/transcription-bakeoff.mjs --ids ids.txt --out ./bakeoff-out [--vendors whisper,scribe,gemini,nemotron] [--limit N]
 *
 * Env:  SUPABASE_SERVICE_KEY (read asset rows), OPENAI_API_KEY (whisper baseline),
 *       ELEVENLABS_API_KEY (scribe direct), AI_GATEWAY_API_KEY (scribe-gw, gemini),
 *       DEEPINFRA_API_KEY (nemotron — skipped when absent).
 *
 * Nothing here writes to the database or to blob storage. Audio is extracted locally
 * with ffmpeg (16 kHz mono MP3, the format every vendor accepts) so all vendors hear
 * the identical bytes.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { isHallucinatedTranscript } from '../api/_lib/whisper.js'

const args = parseArgs(process.argv.slice(2))
const OUT = path.resolve(args.out || './bakeoff-out')
const AUDIO_DIR = path.join(OUT, 'audio')
const RAW_DIR = path.join(OUT, 'raw')
for (const d of [OUT, AUDIO_DIR, RAW_DIR]) mkdirSync(d, { recursive: true })

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wrqfrjhevkbbheymzezy.supabase.co'
const VENDORS = (args.vendors || 'whisper,scribe,scribe-gw,gemini,nemotron').split(',').map((s) => s.trim()).filter(Boolean)
const LIMIT = Number(args.limit) || Infinity
const ASSET_CONCURRENCY = Number(args.concurrency) || 2

// ───────────────────────── asset rows ─────────────────────────
async function fetchAssets(ids) {
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_KEY not set')
  const inList = ids.map((id) => `"${id}"`).join(',')
  const url = `${SUPABASE_URL}/rest/v1/media_assets?id=in.(${inList})&select=id,asset_purpose,mime_type,duration_s,size_bytes,blob_url,transcription,transcript_words`
  const r = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`)
  const rows = await r.json()
  const byId = new Map(rows.map((row) => [row.id, row]))
  return ids.map((id) => byId.get(id)).filter(Boolean)
}

// ───────────────────────── audio extraction ─────────────────────────
function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} exit ${code}: ${err.slice(-800)}`))))
  })
}

async function extractAudio(asset) {
  const mp3 = path.join(AUDIO_DIR, `${asset.id}.mp3`)
  if (!existsSync(mp3)) {
    const t0 = Date.now()
    await run('ffmpeg', ['-y', '-nostdin', '-loglevel', 'error', '-i', asset.blob_url, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', mp3])
    log(`  audio extracted in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  }
  // Loudness, so a "silent" clip is a measurement rather than a label.
  const { err } = await run('ffmpeg', ['-nostdin', '-i', mp3, '-af', 'volumedetect', '-f', 'null', '-'])
  const mean = Number((err.match(/mean_volume:\s*(-?[\d.]+)/) || [])[1])
  const max = Number((err.match(/max_volume:\s*(-?[\d.]+)/) || [])[1])
  return { mp3, meanDb: mean, maxDb: max }
}

// ───────────────────────── vendors ─────────────────────────
// Each returns { words:[{word,start,end,speaker?}], segments:[{start,end,text}], text, raw, status }
const vendors = {
  async whisper(mp3) {
    const form = new FormData()
    form.append('file', new Blob([await readFile(mp3)], { type: 'audio/mpeg' }), 'a.mp3')
    form.append('model', 'whisper-1')
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'word')
    form.append('timestamp_granularities[]', 'segment')
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${need('OPENAI_API_KEY')}` }, body: form })
    const raw = await r.json().catch(() => null)
    if (!r.ok) return { status: r.status, raw }
    return { status: r.status, raw, text: raw.text, words: (raw.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end })), segments: (raw.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text })) }
  },

  async scribe(mp3) {
    const form = new FormData()
    form.append('file', new Blob([await readFile(mp3)], { type: 'audio/mpeg' }), 'a.mp3')
    form.append('model_id', 'scribe_v2')
    form.append('timestamps_granularity', 'word')
    form.append('diarize', 'true')
    form.append('tag_audio_events', 'false')
    const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': need('ELEVENLABS_API_KEY') }, body: form })
    const raw = await r.json().catch(() => null)
    if (!r.ok) return { status: r.status, raw }
    return { status: r.status, raw, text: raw.text, words: scribeWords(raw.words), segments: [] }
  },

  async 'scribe-gw'(mp3) {
    return gateway(mp3, 'elevenlabs/scribe-v2', { elevenlabs: { timestampsGranularity: 'word', diarize: true, tagAudioEvents: false } })
  },

  async gemini(mp3) {
    return gateway(mp3, 'google/gemini-3.5-transcribe', {})
  },

  async nemotron(mp3) {
    const key = process.env.DEEPINFRA_API_KEY
    if (!key) return { status: 0, skipped: 'DEEPINFRA_API_KEY not set' }
    const form = new FormData()
    form.append('file', new Blob([await readFile(mp3)], { type: 'audio/mpeg' }), 'a.mp3')
    form.append('model', 'nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B')
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'word')
    form.append('timestamp_granularities[]', 'segment')
    const r = await fetch('https://api.deepinfra.com/v1/openai/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form })
    const raw = await r.json().catch(() => null)
    if (!r.ok) return { status: r.status, raw }
    return { status: r.status, raw, text: raw.text, words: (raw.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end, speaker: w.speaker })), segments: (raw.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text })) }
  },
}

async function gateway(mp3, modelId, providerOptions) {
  const audio = (await readFile(mp3)).toString('base64')
  const r = await fetch('https://ai-gateway.vercel.sh/v4/ai/transcription-model', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${need('AI_GATEWAY_API_KEY')}`,
      'ai-gateway-protocol-version': '0.0.1',
      'ai-transcription-model-specification-version': '4',
      'ai-model-id': modelId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audio, mediaType: 'audio/mpeg', providerOptions }),
  })
  const raw = await r.json().catch(() => null)
  if (!r.ok) return { status: r.status, raw }
  // Word timing, when a provider returns it, rides in providerMetadata.
  const pm = raw.providerMetadata || {}
  let words = []
  if (pm.elevenlabs?.words) words = scribeWords(pm.elevenlabs.words)
  else if (Array.isArray(raw.words)) words = raw.words.map((w) => ({ word: w.word || w.text, start: w.start, end: w.end }))
  const segments = (raw.segments || []).map((s) => ({ start: s.startSecond ?? s.start, end: s.endSecond ?? s.end, text: s.text }))
  return { status: r.status, raw, text: raw.text, words, segments, metadataKeys: Object.keys(pm) }
}

function scribeWords(arr) {
  return (arr || []).filter((w) => w.type === 'word').map((w) => ({ word: w.text, start: w.start, end: w.end, speaker: w.speaker_id }))
}

function need(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} not set`)
  return v
}

// ───────────────────────── metrics ─────────────────────────
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').trim().split(/\s+/).filter(Boolean)

function geometry(words, durationS) {
  let zeroDur = 0, badGeom = 0, nonMono = 0, beyond = 0, prev = -Infinity
  for (const w of words) {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end < w.start) { badGeom++; continue }
    if (w.end === w.start) zeroDur++
    if (w.start < prev - 0.05) nonMono++
    prev = Math.max(prev, w.start)
    if (durationS && w.end > durationS + 0.5) beyond++
  }
  return { zeroDur, badGeom, nonMono, beyond }
}

// Levenshtein alignment on normalised tokens → WER-style edit rate + matched pairs for timing.
function align(ref, hyp) {
  const n = ref.length, m = hyp.length
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 0; i <= n; i++) dp[i][0] = i
  for (let j = 0; j <= m; j++) dp[0][j] = j
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (ref[i - 1].t === hyp[j - 1].t ? 0 : 1))
  }
  const pairs = []
  let i = n, j = m
  while (i > 0 && j > 0) {
    if (ref[i - 1].t === hyp[j - 1].t && dp[i][j] === dp[i - 1][j - 1]) { pairs.push([ref[i - 1], hyp[j - 1]]); i--; j-- }
    else if (dp[i][j] === dp[i - 1][j - 1] + 1) { i--; j-- }
    else if (dp[i][j] === dp[i - 1][j] + 1) i--
    else j--
  }
  return { edits: dp[n][m], rate: n ? dp[n][m] / n : (m ? 1 : 0), pairs }
}

const tokens = (words) => words.flatMap((w) => norm(w.word).map((t) => ({ t, start: w.start, end: w.end })))

function timing(refWords, hypWords) {
  const { rate, pairs } = align(tokens(refWords), tokens(hypWords))
  const diffs = pairs.map(([a, b]) => b.start - a.start).filter(Number.isFinite)
  diffs.sort((x, y) => x - y)
  const abs = diffs.map(Math.abs).sort((x, y) => x - y)
  const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null)
  return { wordEditRate: round(rate, 3), matched: pairs.length, medianOffsetS: round(q(diffs, 0.5), 3), p90AbsOffsetS: round(q(abs, 0.9), 3), maxAbsOffsetS: round(abs.at(-1), 3) }
}

const round = (x, d) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)))

// ───────────────────────── main ─────────────────────────
function log(...a) { console.error(...a) }

async function runAsset(asset) {
  log(`\n▶ ${asset.id} (${asset.asset_purpose}, ${Number(asset.duration_s).toFixed(1)}s)`)
  const { mp3, meanDb, maxDb } = await extractAudio(asset)
  const stored = Array.isArray(asset.transcript_words) ? asset.transcript_words : []
  const result = { id: asset.id, purpose: asset.asset_purpose, durationS: Number(asset.duration_s), meanDb, maxDb, storedWords: stored.length, vendors: {} }

  await Promise.all(VENDORS.map(async (v) => {
    const t0 = Date.now()
    let r
    try { r = await vendors[v](mp3) } catch (e) { r = { status: -1, error: e.message } }
    const wallMs = Date.now() - t0
    writeFileSync(path.join(RAW_DIR, `${asset.id}.${v}.json`), JSON.stringify(r.raw ?? r, null, 1))
    if (r.skipped) { result.vendors[v] = { skipped: r.skipped }; return }
    if (r.status !== 200) { result.vendors[v] = { status: r.status, error: r.error || JSON.stringify(r.raw).slice(0, 300), wallMs }; log(`  ${v}: HTTP ${r.status} ${result.vendors[v].error}`); return }
    const words = (r.words || []).filter((w) => w && w.word)
    const text = r.text || ''
    const m = {
      status: 200, wallMs, nWords: words.length, nSegments: (r.segments || []).length, textChars: text.length,
      hallucinationFilterHit: isHallucinatedTranscript(words.length ? words.map((w) => w.word).join(' ') : text),
      speakers: new Set(words.map((w) => w.speaker).filter((s) => s != null)).size,
      ...geometry(words, result.durationS),
      vsStoredWhisper: stored.length ? timing(stored, words) : null,
      metadataKeys: r.metadataKeys,
      textHead: text.slice(0, 120),
    }
    result.vendors[v] = m
    log(`  ${v}: ${wallMs}ms words=${m.nWords} zero=${m.zeroDur} nonMono=${m.nonMono} ` + (m.vsStoredWhisper ? `editRate=${m.vsStoredWhisper.wordEditRate} med=${m.vsStoredWhisper.medianOffsetS}s p90=${m.vsStoredWhisper.p90AbsOffsetS}s` : ''))
  }))

  // Cross-vendor timing against the FRESH whisper run (same bytes), not just the stored one.
  const fresh = result.vendors.whisper
  const freshRaw = fresh?.status === 200 ? JSON.parse(readFileSync(path.join(RAW_DIR, `${asset.id}.whisper.json`), 'utf8')) : null
  if (freshRaw?.words) {
    const fw = freshRaw.words.map((w) => ({ word: w.word, start: w.start, end: w.end }))
    for (const v of VENDORS) {
      if (v === 'whisper' || result.vendors[v]?.status !== 200) continue
      const raw = JSON.parse(readFileSync(path.join(RAW_DIR, `${asset.id}.${v}.json`), 'utf8'))
      const hw = v === 'scribe' ? scribeWords(raw.words) : v === 'scribe-gw' ? scribeWords(raw.providerMetadata?.elevenlabs?.words) : (raw.words || []).map((w) => ({ word: w.word || w.text, start: w.start, end: w.end }))
      result.vendors[v].vsFreshWhisper = timing(fw, hw)
    }
  }
  writeFileSync(path.join(OUT, `${asset.id}.json`), JSON.stringify(result, null, 2))
  return result
}

async function main() {
  const ids = readFileSync(path.resolve(args.ids), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, LIMIT)
  const assets = await fetchAssets(ids)
  log(`${assets.length} assets, vendors: ${VENDORS.join(', ')}`)
  const results = []
  const queue = [...assets]
  await Promise.all(Array.from({ length: ASSET_CONCURRENCY }, async () => {
    while (queue.length) {
      const a = queue.shift()
      try { results.push(await runAsset(a)) } catch (e) { log(`  FAILED ${a.id}: ${e.message}`); results.push({ id: a.id, error: e.message }) }
    }
  }))
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
  console.log(summarize(results))
  writeFileSync(path.join(OUT, 'summary.md'), summarize(results))
}

function summarize(results) {
  const lines = ['| vendor | ok/total | median wall ms | words/stored-words | zero-dur % | non-mono | filter hits | speakers≥2 | med offset vs fresh whisper | p90 |abs offset| | word edit rate vs fresh whisper |', '|---|---|---|---|---|---|---|---|---|---|---|']
  for (const v of VENDORS) {
    const rows = results.map((r) => r.vendors?.[v]).filter(Boolean)
    const ok = rows.filter((r) => r.status === 200)
    if (!rows.length || rows.every((r) => r.skipped)) { lines.push(`| ${v} | skipped (${rows[0]?.skipped || 'no rows'}) | | | | | | | | | |`); continue }
    const med = (arr) => { const s = arr.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
    const totalWords = ok.reduce((a, r) => a + r.nWords, 0)
    const storedWords = results.filter((r) => r.vendors?.[v]?.status === 200).reduce((a, r) => a + (r.storedWords || 0), 0)
    const zero = ok.reduce((a, r) => a + r.zeroDur, 0)
    lines.push(`| ${v} | ${ok.length}/${rows.length} | ${med(ok.map((r) => r.wallMs))} | ${totalWords}/${storedWords} | ${totalWords ? ((100 * zero) / totalWords).toFixed(1) : '-'} | ${ok.reduce((a, r) => a + r.nonMono, 0)} | ${ok.filter((r) => r.hallucinationFilterHit).length} | ${ok.filter((r) => r.speakers >= 2).length} | ${med(ok.map((r) => r.vsFreshWhisper?.medianOffsetS))} | ${med(ok.map((r) => r.vsFreshWhisper?.p90AbsOffsetS))} | ${med(ok.map((r) => r.vsFreshWhisper?.wordEditRate))} |`)
  }
  lines.push('', '### Silent / quiet clips (mean dB < -40): words returned per vendor', '| asset | meanDb | ' + VENDORS.join(' | ') + ' |', '|---|---|' + VENDORS.map(() => '---').join('|') + '|')
  for (const r of results.filter((r) => r.meanDb != null && r.meanDb < -40)) {
    lines.push(`| ${r.id.slice(0, 8)} | ${r.meanDb} | ` + VENDORS.map((v) => { const x = r.vendors?.[v]; return x?.skipped ? 'skip' : x?.status !== 200 ? `HTTP ${x?.status}` : `${x.nWords}w${x.hallucinationFilterHit ? ' (filtered)' : ''}` }).join(' | ') + ' |')
  }
  lines.push('', '### Per-asset', '| asset | purpose | dur | stored | ' + VENDORS.map((v) => `${v} words / med / p90`).join(' | ') + ' |', '|---|---|---|---|' + VENDORS.map(() => '---').join('|') + '|')
  for (const r of results) {
    if (r.error) { lines.push(`| ${r.id.slice(0, 8)} | FAILED ${r.error.slice(0, 60)} |`); continue }
    lines.push(`| ${r.id.slice(0, 8)} | ${r.purpose} | ${r.durationS.toFixed(0)}s | ${r.storedWords} | ` + VENDORS.map((v) => { const x = r.vendors?.[v]; if (!x) return '-'; if (x.skipped) return 'skip'; if (x.status !== 200) return `HTTP ${x.status}`; const t = x.vsFreshWhisper; return `${x.nWords}${t ? ` / ${t.medianOffsetS} / ${t.p90AbsOffsetS}` : ''}` }).join(' | ') + ' |')
  }
  return lines.join('\n')
}

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); const nxt = argv[i + 1]; if (nxt && !nxt.startsWith('--')) { o[k] = nxt; i++ } else o[k] = true }
  }
  return o
}

main().catch((e) => { console.error(e); process.exit(1) })
