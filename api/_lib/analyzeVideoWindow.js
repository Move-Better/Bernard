// api/_lib/analyzeVideoWindow.js
//
// Reusable video-understanding primitive. Samples a handful of evenly-spaced
// frames from a time window of a source video and hands them to a multimodal
// model (Gemini via the Vercel AI Gateway) with a caller-supplied schema.
// Returns the validated object plus token usage + a cost estimate so callers
// can log spend.
//
// Built as a shared helper on purpose (F13 + F17):
//   - F13 (Video-native moment understanding): score each proposed moment on
//     what the camera SEES (scoreMomentsVisual.js), blended into the feed rank.
//   - F17 (Promise-Ledger read-back verification): confirm a published post's
//     video matches its approved render — same "look at the real frames" call,
//     a different schema.
//
// Why FRAMES, not a transcoded clip (learned the hard way on real footage):
// clinical sources are multi-GB 4K files. Decoding 4K to encode even a 20s
// 720p proxy runs ~8x SLOWER than realtime on CPU (2m45s for one 20s window) —
// intractable both in a node harness and a Vercel function. Instead we grab N
// stills via fast INPUT seeks: each `-ss T -i URL -frames:v 1` issues an HTTP
// range request, decodes ~1 frame, and returns in ~3s regardless of source
// size. Six stills across a window capture eye-contact, framing, gesture, and
// scene — enough for a visual quality read. (Energy is the one dimension stills
// read weaker than motion would; acceptable for v1.) We NEVER download the
// whole source (CLAUDE.md "Large-file handling").
//
// Pure-ish: model call + local ffmpeg, no DB, no request context — a node
// harness can verify it against real footage with no Clerk.

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateObject } from 'ai'
import ffmpegStaticPath from 'ffmpeg-static'

// Gemini 2.5 Pro — sharper on subtle visual cues (eye contact, micro-gesture)
// than Flash, which matters for the framing/delivery judgments F13 makes.
// Reachable through the AI Gateway with a plain provider/model string, exactly
// like tagAsset.js's google/gemini-2.5-flash — no new SDK, no new provider key.
export const DEFAULT_VIDEO_MODEL = 'google/gemini-2.5-pro'

// Same binary-resolution priority as tagAsset.js.
const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegStaticPath || 'ffmpeg'

// How many stills to sample across a window by default. 6 gives good coverage
// of a 8–60s clip without over-paying on seeks or tokens.
const DEFAULT_FRAMES = 6
// Downscale long edge for the sampled stills — plenty for framing/eye-contact.
const FRAME_LONG_EDGE = 512

// Per-1M-token rates (USD) for cost logging. Approximate Gateway list price for
// Gemini 2.5 Pro at the <200k-context tier; used only for an order-of-magnitude
// spend log, never for billing. Update if the rate card moves.
const RATE_CARD = {
  'google/gemini-2.5-pro':   { in: 1.25, out: 10.0 },
  'google/gemini-2.5-flash': { in: 0.30, out: 2.50 },
}

/** Evenly-spaced timestamps across [start,end], inset slightly from the edges. */
function frameTimestamps(startSec, endSec, count) {
  const s = Math.max(0, Number(startSec) || 0)
  const e = Number(endSec)
  if (!Number.isFinite(e) || e <= s) return [s]
  const span = e - s
  const inset = Math.min(0.5, span * 0.05)
  const lo = s + inset
  const hi = e - inset
  if (count <= 1) return [(lo + hi) / 2]
  const step = (hi - lo) / (count - 1)
  return Array.from({ length: count }, (_, i) => Math.round((lo + i * step) * 100) / 100)
}

/**
 * Grab ONE 512px JPEG at timestamp `t` from a source (blob URL, range-read; or
 * a local path). Fast input seek — decodes ~1 frame, returns in ~3s regardless
 * of source size.
 * @returns {Promise<Buffer>} jpeg bytes
 */
async function grabFrame(source, t, dir, idx) {
  const outPath = join(dir, `f${idx}.jpg`)
  await new Promise((resolve, reject) => {
    const args = [
      '-y',
      // Reconnect if the blob host drops the range connection mid-seek.
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
      '-ss', String(t), '-i', source,
      '-frames:v', '1',
      '-vf', `scale='min(${FRAME_LONG_EDGE},iw)':-2`,
      '-q:v', '5',
      outPath,
    ]
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 8192) stderr = stderr.slice(-4096) })
    proc.on('error', (e) => reject(new Error(`ffmpeg spawn failed (${e.code || e.message}); set FFMPEG_PATH or install ffmpeg`)))
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300).trim()}`)))
  })
  const { size } = await stat(outPath).catch(() => ({ size: 0 }))
  if (!size) throw new Error(`empty frame at ${t}s`)
  return readFile(outPath)
}

/** Sample N stills across a window. Skips frames that fail (e.g. seek past EOF). */
async function sampleFrames(source, startSec, endSec, count) {
  const dir = await mkdtemp(join(tmpdir(), 'vidframes-'))
  try {
    const stamps = frameTimestamps(startSec, endSec, count)
    const frames = []
    for (let i = 0; i < stamps.length; i++) {
      try {
        frames.push(await grabFrame(source, stamps[i], dir, i))
      } catch (e) {
        console.error(`[analyzeVideoWindow] frame ${i} @ ${stamps[i]}s failed:`, e?.message || e)
      }
    }
    return frames
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Sample `count` stills spread evenly across [startSec, endSec] of a source,
 * grabbing them CONCURRENTLY (each grab is an independent fast seek). Returns
 * `[{ t, jpeg }]` in timestamp order, so a caller can label each frame with its
 * time. Used by the F13 visual NOMINATOR to scan a whole source cheaply — a
 * concurrency pool keeps a 24-frame scan of a 3GB 4K source to ~20s wall.
 * Skips frames that fail (seek past EOF, transient blob hiccup).
 *
 * @param {string} source            blob URL (range-read) or local path
 * @param {number} startSec
 * @param {number} endSec
 * @param {number} count
 * @param {object} [opts]
 * @param {number} [opts.concurrency=4]
 * @returns {Promise<Array<{ t:number, jpeg:Buffer }>>}
 */
export async function sampleFramesAcross(source, startSec, endSec, count, opts = {}) {
  const concurrency = Math.max(1, opts.concurrency || 4)
  const stamps = frameTimestamps(startSec, endSec, count)
  const dir = await mkdtemp(join(tmpdir(), 'vidscan-'))
  const out = new Array(stamps.length).fill(null)
  let cursor = 0
  async function worker() {
    while (cursor < stamps.length) {
      const i = cursor++
      try {
        out[i] = { t: stamps[i], jpeg: await grabFrame(source, stamps[i], dir, i) }
      } catch (e) {
        console.error(`[sampleFramesAcross] frame @ ${stamps[i]}s failed:`, e?.message || e)
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, stamps.length) }, worker))
    return out.filter(Boolean)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function estimateCostUsd(model, usage) {
  const rate = RATE_CARD[model]
  if (!rate || !usage) return null
  // AI SDK v7 exposes inputTokens/outputTokens; tolerate older promptTokens naming.
  const inTok = Number(usage.inputTokens ?? usage.promptTokens ?? 0)
  const outTok = Number(usage.outputTokens ?? usage.completionTokens ?? 0)
  if (!inTok && !outTok) return null
  return (inTok / 1e6) * rate.in + (outTok / 1e6) * rate.out
}

/**
 * Look at a video window (via sampled stills) and return a structured judgment
 * against a schema.
 *
 * @param {Object} p
 * @param {string} p.source          source video: a blob URL (range-read) or local path
 * @param {number|null} [p.startSec] window start (seconds); defaults to 0
 * @param {number} p.endSec          window end (seconds) — required to space frames
 * @param {string} p.instructions    system prompt for the model
 * @param {import('zod').ZodType} p.schema  output schema (generateObject validates + retries)
 * @param {string} [p.prompt]         user-turn text paired with the frames
 * @param {number} [p.frames]         how many stills to sample (default 6)
 * @param {string} [p.model]          gateway model id (default Gemini 2.5 Pro)
 * @param {number} [p.timeoutMs]      abort budget for the model call
 * @returns {Promise<{ object:object, usage:object|undefined, costUsd:number|null, model:string, frameCount:number }>}
 */
export async function analyzeVideoWindow({
  source,
  startSec = 0,
  endSec,
  instructions,
  schema,
  prompt = 'These are stills sampled in order from one short video clip. Analyze the clip as specified.',
  frames = DEFAULT_FRAMES,
  model = DEFAULT_VIDEO_MODEL,
  timeoutMs = 120_000,
}) {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY is not set on this deployment')
  if (!source) throw new Error('analyzeVideoWindow: source (blob URL or local path) is required')
  if (!schema) throw new Error('analyzeVideoWindow: schema is required')
  if (!Number.isFinite(endSec)) throw new Error('analyzeVideoWindow: endSec is required')

  const stills = await sampleFrames(source, startSec, endSec, frames)
  if (!stills.length) throw new Error('no frames could be sampled from the window')

  const { object, usage } = await generateObject({
    model,
    schema,
    instructions,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...stills.map((data) => ({ type: 'file', data, mediaType: 'image/jpeg' })),
      ],
    }],
    temperature: 0.2,
    abortSignal: AbortSignal.timeout(timeoutMs),
  })

  return { object, usage, costUsd: estimateCostUsd(model, usage), model, frameCount: stills.length }
}
