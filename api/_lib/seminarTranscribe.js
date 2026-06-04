// api/_lib/seminarTranscribe.js
//
// Core of the Seminar / Talk capture lane (Slice ①): take a long talk
// (45–90+ min, 50–85 MB) that's already in Vercel Blob and turn it into a
// stitched transcript on the interview row.
//
// Why this is a background job, not a synchronous request:
//   • Whisper caps each file at 25 MB → we must CHUNK the audio.
//   • A 71-min talk takes ~239s to transcribe; a 2-hour talk would blow past
//     the 300s function timeout if done in one sequential pass → we transcode
//     to small mono MP3 segments and transcribe them CONCURRENTLY (bounded),
//     which keeps even a 2-hour talk comfortably under one 300s budget.
//   • A 50–85 MB file can't be POSTed as a request body (Vercel ~4.5 MB limit)
//     → the browser uploads direct-to-Blob and hands us the URL; here we STREAM
//     blob→disk (never arrayBuffer()) to stay within function memory.
//
// Flow: stream blob → /tmp → ffmpeg segment to mono 16kHz MP3 chunks →
// Whisper each chunk (concurrent, in order) → stitch → PATCH the interview
// (messages[0] + transcribe_status='ready'). On any failure → 'failed'.

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const OPENAI_KEY = process.env.OPENAI_API_KEY
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions'

// Segment length. At mono 16kbps MP3 a 10-min segment is ~1.2 MB — far under
// Whisper's 25 MB cap — and ~12 segments cover a 2-hour talk. Each Whisper call
// transcribes ≤10 min of audio (~30–60s wall), so a bounded-concurrency batch
// finishes well inside one 300s function budget.
const SEGMENT_SECONDS = 600
// Bounded concurrency for the Whisper fan-out. Enough to parallelize a 2-hour
// talk into ~2 waves without tripping rate limits.
const MAX_CONCURRENT = 6

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

async function setStatus(interviewId, transcribe_status, extra = {}) {
  try {
    await sb(`interviews?id=eq.${interviewId}`, {
      method: 'PATCH',
      body: JSON.stringify({ transcribe_status, ...extra }),
    })
  } catch (e) {
    console.error(`[seminarTranscribe] status write failed (${transcribe_status}): ${e?.message}`)
  }
}

// Stream the remote audio to a local file. Streaming (not arrayBuffer) keeps
// peak memory bounded by the stream buffer regardless of source size.
async function downloadToFile(url, destPath) {
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(`audio download failed: ${r.status}`)
  await pipeline(Readable.fromWeb(r.body), createWriteStream(destPath))
}

// Transcode the source to mono 16kHz MP3 and split into fixed-length segments
// in one ffmpeg pass. Returns the sorted list of absolute segment paths.
function segmentAudio(srcPath, outDir) {
  return new Promise((resolve, reject) => {
    const pattern = join(outDir, 'seg-%04d.mp3')
    const args = [
      '-hide_banner', '-nostdin', '-y',
      '-i', srcPath,
      '-vn',                       // drop any video track
      '-ac', '1',                  // mono
      '-ar', '16000',              // 16kHz — plenty for speech
      '-b:a', '16k',               // tiny files, Whisper-friendly
      '-f', 'segment',
      '-segment_time', String(SEGMENT_SECONDS),
      '-reset_timestamps', '1',
      pattern,
    ]
    let proc
    try {
      proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (e) {
      return reject(e)
    }
    let stderr = ''
    proc.stderr.on('data', (c) => {
      stderr += c.toString('utf8')
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024)
    })
    // Generous ceiling — transcode of a 2-hour file is I/O light at 16kbps but
    // we never want a hung ffmpeg to keep the function alive to the wall.
    const timer = setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* noop */ } }, 240_000)
    proc.on('error', (e) => { clearTimeout(timer); reject(e) })
    proc.on('close', async (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        return reject(new Error(`ffmpeg segment failed (code ${code}): ${stderr.slice(-300)}`))
      }
      try {
        const files = (await readdir(outDir))
          .filter((f) => f.startsWith('seg-') && f.endsWith('.mp3'))
          .sort()
          .map((f) => join(outDir, f))
        if (!files.length) return reject(new Error('ffmpeg produced no segments'))
        resolve(files)
      } catch (e) {
        reject(e)
      }
    })
  })
}

async function transcribeChunk(filePath) {
  const { size } = await stat(filePath)
  if (size === 0) return ''
  const buf = await readFile(filePath)
  const form = new FormData()
  form.append('file', new Blob([buf], { type: 'audio/mpeg' }), filePath.split('/').pop())
  form.append('model', 'whisper-1')
  form.append('response_format', 'text')
  const res = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Whisper ${res.status}: ${body.slice(0, 200)}`)
  }
  return (await res.text()).trim()
}

// Transcribe all segments with bounded concurrency, preserving order.
async function transcribeAll(segmentPaths) {
  const out = new Array(segmentPaths.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= segmentPaths.length) return
      out[i] = await transcribeChunk(segmentPaths[i])
    }
  }
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT, segmentPaths.length) },
    () => worker()
  )
  await Promise.all(workers)
  return out
}

/**
 * Transcribe a seminar interview end-to-end. Designed to be called from a
 * background worker (waitUntil). Reads source_audio_url off the interview row,
 * stitches the transcript into messages[0], and flips transcribe_status.
 *
 * @param {{ interviewId: string }} args
 * @returns {Promise<{ ok: boolean, chars?: number, segments?: number, error?: string }>}
 */
export async function transcribeSeminar({ interviewId }) {
  if (!OPENAI_KEY) {
    await setStatus(interviewId, 'failed')
    return { ok: false, error: 'OPENAI_API_KEY not set' }
  }

  // Resolve the audio URL.
  let audioUrl
  try {
    const r = await sb(`interviews?id=eq.${interviewId}&select=id,source_audio_url`)
    const rows = r.ok ? await r.json() : []
    audioUrl = rows[0]?.source_audio_url
  } catch (e) {
    await setStatus(interviewId, 'failed')
    return { ok: false, error: `interview read failed: ${e?.message}` }
  }
  if (!audioUrl) {
    await setStatus(interviewId, 'failed')
    return { ok: false, error: 'interview has no source_audio_url' }
  }

  const workDir = join(tmpdir(), `seminar-${interviewId}`)
  const srcPath = join(workDir, 'source')
  const segDir = join(workDir, 'segments')

  try {
    await mkdir(segDir, { recursive: true })
    await downloadToFile(audioUrl, srcPath)
    const segments = await segmentAudio(srcPath, segDir)
    const parts = await transcribeAll(segments)
    const transcript = parts.map((p) => (p || '').trim()).filter(Boolean).join('\n\n').trim()
    if (!transcript) throw new Error('all segments produced empty transcripts')

    const patch = await sb(`interviews?id=eq.${interviewId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        messages: [{ role: 'user', content: transcript }],
        transcribe_status: 'ready',
        status: 'in_progress',
      }),
    })
    if (!patch.ok) {
      const body = await patch.text().catch(() => '')
      throw new Error(`interview PATCH failed ${patch.status}: ${body.slice(0, 200)}`)
    }
    return { ok: true, chars: transcript.length, segments: segments.length }
  } catch (e) {
    console.error(`[seminarTranscribe] failed for interview=${interviewId}: ${e?.stack || e?.message}`)
    await setStatus(interviewId, 'failed')
    return { ok: false, error: e?.message || 'transcription failed' }
  } finally {
    try { await rm(workDir, { recursive: true, force: true }) } catch { /* noop */ }
  }
}
