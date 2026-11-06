#!/usr/bin/env node
/**
 * Companion to transcription-bakeoff.mjs: burn each vendor's word timestamps into
 * ONE real clip with the production karaoke builder (api/_lib/karaokeCaptions.js
 * buildKaraokeAss → ffmpeg `ass=`), then tile frames into a contact sheet per vendor
 * so timing/stacking artefacts can be seen rather than inferred from numbers.
 *
 *   node scripts/transcription-bakeoff-render.mjs --out ./bakeoff-out --asset <uuid> [--vendors whisper,scribe,...] [--frames 8]
 *
 * Reads <out>/raw/<asset>.<vendor>.json written by the bake-off, and the asset's
 * blob_url from <out>/<asset>.json is NOT stored, so pass --url, or set
 * SUPABASE_SERVICE_KEY and it is looked up. Local only — writes nothing remote.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildKaraokeAss } from '../api/_lib/karaokeCaptions.js'
// The production bake uses ffmpeg-static (has libass); Homebrew ffmpeg often lacks the `ass` filter.
import ffmpegPath from 'ffmpeg-static'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : null).filter(Boolean))
const OUT = path.resolve(args.out || './bakeoff-out')
const ASSET = args.asset
if (!ASSET) throw new Error('--asset required')
const VENDORS = (args.vendors || 'whisper,scribe,scribe-gw,nemotron').split(',')
const FRAMES = Number(args.frames) || 8
const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../api/_lib/fonts')
const RENDER = path.join(OUT, 'render'); mkdirSync(path.join(RENDER, 'fonts'), { recursive: true })
// ffmpeg filter args cannot carry spaces/colons safely, so every path below is relative to RENDER.
import { copyFileSync } from 'node:fs'
copyFileSync(path.join(FONTS, 'Inter-Bold.ttf'), path.join(RENDER, 'fonts', 'Inter-Bold.ttf'))

function run(cmd, argv, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], cwd }); let err = ''
    p.stderr.on('data', (d) => (err += d)); p.on('close', (c) => (c === 0 ? resolve(err) : reject(new Error(`${cmd} ${c}: ${err.slice(-600)}`))))
  })
}

async function blobUrl() {
  if (args.url) return args.url
  const key = process.env.SUPABASE_SERVICE_KEY; if (!key) throw new Error('--url or SUPABASE_SERVICE_KEY')
  const u = `${process.env.SUPABASE_URL || 'https://wrqfrjhevkbbheymzezy.supabase.co'}/rest/v1/media_assets?id=eq.${ASSET}&select=blob_url,width,height`
  const r = await fetch(u, { headers: { apikey: key, Authorization: `Bearer ${key}` } }); const [row] = await r.json(); return row.blob_url
}

// Same normalisation the bake-off used, so the picture matches the numbers.
function wordsFor(vendor, raw) {
  const sc = (arr) => (arr || []).filter((w) => w.type === 'word').map((w) => ({ word: w.text, start: w.start, end: w.end }))
  if (vendor === 'scribe') return sc(raw.words)
  if (vendor === 'scribe-gw') return sc(raw.providerMetadata?.elevenlabs?.words)
  return (raw.words || []).map((w) => ({ word: w.word || w.text, start: w.start, end: w.end }))
}

const url = await blobUrl()
const src = path.join(RENDER, `${ASSET}.src.mp4`)
if (!existsSync(src)) await run(ffmpegPath, ['-y', '-nostdin', '-loglevel', 'error', '-i', url, '-vf', 'scale=720:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-an', src])
const [w, h, dur] = (await new Promise((res) => { const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'csv=p=0', src]); let o = ''; p.stdout.on('data', (d) => (o += d)); p.on('close', () => res(o)) })).trim().split(/[,\n]/).map(Number)

for (const v of VENDORS) {
  const rawPath = path.join(OUT, 'raw', `${ASSET}.${v}.json`)
  if (!existsSync(rawPath)) { console.log(`${v}: no raw output, skipped`); continue }
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'))
  const words = wordsFor(v, raw)
  const ass = buildKaraokeAss({ words, width: w, height: h, captionPos: 'center', accentColor: '#E36525', fontName: 'Inter', style: 'bold' })
  if (!ass) { console.log(`${v}: no usable words`); continue }
  const assName = `${ASSET}.${v}.ass`; writeFileSync(path.join(RENDER, assName), ass)
  const sheetName = `${ASSET}.${v}.sheet.png`; const sheet = path.join(RENDER, sheetName)
  // Sample frames evenly through the speech, tile them 4 wide.
  const fps = FRAMES / dur
  const cols = 4, rows = Math.ceil(FRAMES / cols)
  await run(ffmpegPath, ['-y', '-nostdin', '-loglevel', 'error', '-i', path.basename(src), '-vf', `ass=filename=${assName}:fontsdir=fonts,fps=${fps},tile=${cols}x${rows}`, '-frames:v', '1', sheetName], RENDER)
  console.log(`${v}: ${words.length} words → ${sheet}`)
}
