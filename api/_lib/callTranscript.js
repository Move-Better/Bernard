// F1 — outbound call: recording → transcript turns.
//
// Twilio records the outbound call dual-channel (record-from-answer-dual) and
// posts the recording URL to our webhook on hangup. This turns that recording
// into the role-attributed `messages` the completion path expects.
//
// Dual-channel mapping (v1.1, CONFIRMED empirically on the first live call's
// recording): for an outbound `<Dial><Sip>` call, the stereo recording carries
//   channel 0 (left)  = the parent leg = the person we called   → role 'user'
//   channel 1 (right) = the dialed leg = the OpenAI/SIP agent    → role 'assistant'
// We split the channels with ffmpeg, transcribe each with per-segment
// timestamps, tag roles, and interleave by start time — reconstructing the
// real back-and-forth (which the pilot's mixed single-turn transcript flattened).
//
// Fallback: if the split or a per-channel transcription fails, we fall back to
// the mixed single-turn transcript (what the pilot used) so a call still
// produces content rather than nothing.

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import ffmpegPath from 'ffmpeg-static'
import { transcribeToSegments } from './whisper.js'

const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegPath || 'ffmpeg'

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let tail = ''
    proc.stderr.on('data', (d) => { tail = (tail + d).slice(-800) })
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${tail}`))))
    proc.on('error', (e) => reject(new Error(`ffmpeg spawn failed: ${e.message}`)))
  })
}

// Merge two channels of timestamped segments into role-attributed turns,
// interleaved by start time, collapsing consecutive same-speaker segments.
function interleaveChannels(userSegs, assistantSegs) {
  const tagged = [
    ...userSegs.map((s) => ({ ...s, role: 'user' })),
    ...assistantSegs.map((s) => ({ ...s, role: 'assistant' })),
  ].sort((a, b) => a.start - b.start)

  const messages = []
  for (const seg of tagged) {
    const last = messages[messages.length - 1]
    if (last && last.role === seg.role) last.content += ' ' + seg.text
    else messages.push({ role: seg.role, content: seg.text })
  }
  return messages
}

/**
 * Download a Twilio dual-channel call recording and transcribe it into
 * role-attributed turns.
 *
 * @param {object} p
 * @param {string} p.recordingUrl  - Twilio RecordingUrl (we append .mp3)
 * @param {string} [p.basicAuth]   - base64 "sid:token" for the authed download
 * @returns {Promise<{ messages: Array<{role,content}>, fullText: string, dualChannel: boolean }>}
 */
export async function transcribeCallRecording({ recordingUrl, basicAuth }) {
  if (!recordingUrl) throw new Error('no_recording_url')
  const url = recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`

  const stamp = `${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`
  const mixedPath = join(tmpdir(), `f1-call-${stamp}.mp3`)
  const ch0Path = join(tmpdir(), `f1-call-${stamp}-ch0.mp3`) // user (left)
  const ch1Path = join(tmpdir(), `f1-call-${stamp}-ch1.mp3`) // assistant (right)
  const cleanup = () => Promise.all([mixedPath, ch0Path, ch1Path].map((p) => unlink(p).catch(() => {})))

  const r = await fetch(url, {
    headers: basicAuth ? { Authorization: `Basic ${basicAuth}` } : {},
    signal: AbortSignal.timeout(30_000),
  })
  if (!r.ok || !r.body) throw new Error(`recording_download_failed_${r.status}`)
  // Stream to disk — never buffer a full call recording in RAM (large-file rule).
  await pipeline(Readable.fromWeb(r.body), createWriteStream(mixedPath))

  try {
    // Preferred path: split the stereo into two mono tracks, transcribe each,
    // and interleave into real speaker turns.
    try {
      await runFfmpeg([
        '-y', '-i', mixedPath,
        '-filter_complex', 'channelsplit=channel_layout=stereo[l][r]',
        '-map', '[l]', ch0Path,
        '-map', '[r]', ch1Path,
      ])
      const [userSegs, assistantSegs] = await Promise.all([
        transcribeToSegments(ch0Path),
        transcribeToSegments(ch1Path),
      ])
      const messages = interleaveChannels(userSegs, assistantSegs)
      const fullText = messages.map((m) => m.content).join(' ').trim()
      if (fullText) return { messages, fullText, dualChannel: true }
      // else fall through to mixed fallback
    } catch (e) {
      console.error(`[callTranscript] dual-channel split failed, falling back to mixed: ${e?.message}`)
    }

    // Fallback: transcribe the mixed recording as one combined turn. This turn
    // contains BOTH speakers' words with no way to attribute who said what —
    // callers must NOT treat its role as a genuine speaker label (it's tagged
    // 'user' only so a transcript still renders/summarizes; dualChannel:false
    // is the signal to skip any enrichment that assumes real speaker turns,
    // e.g. clinician-voice-phrase extraction or assistant-turn style scoring).
    const segments = await transcribeToSegments(mixedPath)
    const fullText = segments.map((s) => s.text).join(' ').trim()
    if (!fullText) throw new Error('empty_transcript')
    return { messages: [{ role: 'user', content: fullText }], fullText, dualChannel: false }
  } finally {
    await cleanup()
  }
}
