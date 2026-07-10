// F1 — outbound call: recording → transcript turns.
//
// Twilio records the outbound call dual-channel and posts the recording URL to
// our webhook on hangup. This turns that recording into the `messages` array
// the completion path expects.
//
// ⚠️ SMOKE-PENDING (dual-channel attribution): Twilio's `record-from-answer-dual`
// produces a stereo file — one leg per channel — so per-speaker turns are
// recoverable by splitting channels (ffmpeg) and transcribing each. That split
// depends on the exact channel ordering Twilio emits, which is only knowable
// from a real provisioned recording. For v1 we transcribe the mixed audio into
// a single combined transcript turn — enough for the blog generator to work
// from — and leave true speaker-attributed turns as the first post-smoke
// refinement. The blog generator (getBlogPostSystemPrompt) reads the transcript
// content; it does not require the turns to be split.

import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { transcribeToSegments } from './whisper.js'

/**
 * Download a Twilio call recording and transcribe it.
 *
 * @param {object} p
 * @param {string} p.recordingUrl  - Twilio RecordingUrl (we append .mp3)
 * @param {string} [p.basicAuth]   - base64 "sid:token" for the authed download
 * @returns {Promise<{ messages: Array<{role,content}>, fullText: string }>}
 */
export async function transcribeCallRecording({ recordingUrl, basicAuth }) {
  if (!recordingUrl) throw new Error('no_recording_url')
  const url = recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`

  const localPath = join(tmpdir(), `f1-call-${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}.mp3`)
  const r = await fetch(url, {
    headers: basicAuth ? { Authorization: `Basic ${basicAuth}` } : {},
    signal: AbortSignal.timeout(30_000),
  })
  if (!r.ok || !r.body) throw new Error(`recording_download_failed_${r.status}`)
  // Stream to disk — never buffer a full call recording in RAM (large-file rule).
  await pipeline(Readable.fromWeb(r.body), createWriteStream(localPath))

  try {
    const segments = await transcribeToSegments(localPath)
    const fullText = segments.map((s) => s.text).join(' ').trim()
    if (!fullText) throw new Error('empty_transcript')
    // v1: one combined turn. Role 'user' so the blog generator treats it as the
    // interview content it should write from.
    return { messages: [{ role: 'user', content: fullText }], fullText }
  } finally {
    await unlink(localPath).catch(() => {})
  }
}
