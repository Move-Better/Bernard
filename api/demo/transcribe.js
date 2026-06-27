// POST /api/demo/transcribe
//
// PUBLIC, UNAUTHENTICATED demo endpoint. Accepts a raw audio binary body
// (Content-Type: audio/*), transcribes it via OpenAI Whisper, and returns the
// text. That's it.
//
//   • NO workspaceContext / NO requireRole / NO Supabase / NO Vercel Blob.
//     This handler is structurally incapable of reading or writing tenant data
//     or persisting anything — the audio lives only in memory for the duration
//     of the request. (Scope: .claude/scope-no-login-demo.md — "shares nothing
//     writable with the tenant path".)
//   • Abuse protection by construction: because it's unauthenticated and calls a
//     paid model, it is IP-rate-limited (demo burst + demoDaily ceiling) and
//     hard-capped on body size. BotID is layered on top (see scope B1).
//
// This mirrors api/voice-memo.js's raw-binary + Whisper plumbing, minus every
// auth/persistence step.
//
// Runtime notes (same constraints as voice-memo.js):
//   • Node runtime — Whisper call is a server-side fetch; not Edge.
//   • bodyParser disabled — the request body IS the audio file (raw binary).
//     Vercel's default JSON parser would corrupt it. (This is also why the demo
//     endpoints stay standalone instead of folding into the api/index Express
//     app, whose express.json() middleware would mangle the binary body.)
//   • maxDuration 60s — a ≤90s clip transcribes in a few seconds; 60s is ample
//     and well under the 300s wall.

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
  api: { bodyParser: false },
}

import { enforceLimit } from '../_lib/ratelimit.js'

const OPENAI_KEY = process.env.OPENAI_API_KEY

// Hard ceiling on the request body. A 90-second demo clip is ~1–2 MB even at a
// generous bitrate; 8 MB leaves headroom for odd codecs while bounding both
// memory and Whisper cost (Whisper bills by audio length; the rate limit + this
// size cap together keep worst-case demo spend to pennies per IP per day).
const MAX_BYTES = 8 * 1024 * 1024

/** Buffer the full raw request body into a single Buffer. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      // Stop reading once we're past the cap — don't buffer an abusive upload.
      if (total > MAX_BYTES) {
        reject(Object.assign(new Error('too_large'), { code: 'too_large' }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// Map the inbound Content-Type to a file extension Whisper recognizes so it
// picks the right decoder. Safari records audio/mp4; Chrome/Firefox audio/webm.
function extForContentType(ct) {
  const c = (ct || '').toLowerCase()
  if (c.includes('mp4') || c.includes('m4a') || c.includes('aac')) return 'mp4'
  if (c.includes('mpeg') || c.includes('mp3')) return 'mp3'
  if (c.includes('wav')) return 'wav'
  if (c.includes('ogg')) return 'ogg'
  return 'webm'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  // ── Abuse protection (no auth on this endpoint, so this is mandatory) ───────
  // Burst first (cheap to reject); only consume a daily token if under burst.
  if (!(await enforceLimit(req, res, 'demo'))) return
  if (!(await enforceLimit(req, res, 'demoDaily'))) return

  // ── Validate content type ──────────────────────────────────────────────────
  const contentType = req.headers['content-type'] || 'audio/webm'
  if (!contentType.startsWith('audio/') && !contentType.startsWith('video/')) {
    return res.status(415).json({
      error: 'unsupported_media_type',
      message: 'Send an audio recording.',
    })
  }

  // ── Buffer the audio (in memory only — never written to disk/blob/DB) ───────
  let audioBuffer
  try {
    audioBuffer = await readBody(req)
  } catch (e) {
    if (e?.code === 'too_large') {
      return res.status(413).json({
        error: 'too_large',
        message: "That recording is longer than the demo allows — keep it under about 90 seconds.",
      })
    }
    console.error(`[demo/transcribe] body read failed: ${e?.stack || e?.message}`)
    return res.status(400).json({ error: 'bad_body', message: 'Could not read the audio.' })
  }

  if (!audioBuffer.byteLength) {
    return res.status(400).json({ error: 'empty_audio', message: 'No audio came through — try again.' })
  }

  // ── Transcribe via OpenAI Whisper ──────────────────────────────────────────
  if (!OPENAI_KEY) {
    console.error('[demo/transcribe] OPENAI_API_KEY is not set — transcription unavailable')
    return res.status(500).json({
      error: 'not_configured',
      message: 'The demo is temporarily unavailable. Please try again later.',
    })
  }

  let transcript
  try {
    const ext = extForContentType(contentType)
    const form = new FormData()
    form.append('file', new Blob([audioBuffer], { type: contentType }), `demo.${ext}`)
    form.append('model', 'whisper-1')
    form.append('response_format', 'text')

    const wRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
      signal: AbortSignal.timeout(90_000),
    })
    if (!wRes.ok) {
      const errTxt = await wRes.text().catch(() => '')
      throw new Error(`Whisper ${wRes.status}: ${errTxt.slice(0, 200)}`)
    }
    transcript = (await wRes.text()).trim()
  } catch (e) {
    console.error(`[demo/transcribe] transcription error: ${e?.stack || e?.message}`)
    return res.status(502).json({
      error: 'transcribe_failed',
      message: "We couldn't transcribe that — give it another try.",
    })
  }

  if (!transcript) {
    return res.status(422).json({
      error: 'empty_transcript',
      message: "We didn't catch any speech — try recording again somewhere quieter.",
    })
  }

  // Persist NOTHING. Return the text only.
  return res.status(200).json({ transcript })
}
