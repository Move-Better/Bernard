/**
 * @movebetter/transcribe — NarrateRx copy
 *
 * Shared transcription layer used by both NarrateRx and Bernard.
 * Provider swaps (e.g. Whisper → AssemblyAI diarization) happen here
 * and in Bernard's packages/transcribe/index.js in tandem.
 *
 * TODO: once Move-Better repos are consolidated into a monorepo, replace
 * this file with: import { transcribeToSrt, transcribeToSegments } from '@movebetter/transcribe'
 *
 * Callers: brandRenderVideo.js (transcribeToSrt), multi-clip detector (transcribeToSegments)
 */

import { readFile, stat } from 'node:fs/promises'

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions'
const MAX_BYTES   = 24 * 1024 * 1024  // 24 MB — 1 MB under Whisper's hard limit

function apiKey() {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')
  return key
}

async function whisper(form) {
  const res = await fetch(WHISPER_URL, {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body:    form,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Whisper API ${res.status}: ${body.slice(0, 300)}`)
  }
  return res
}

async function readLocalFile(filePath) {
  const { size } = await stat(filePath)
  if (size > MAX_BYTES) {
    throw new Error(`File too large for Whisper: ${Math.round(size / 1e6)}MB (max 24MB). Extract audio first.`)
  }
  const buffer   = await readFile(filePath)
  const fileName = filePath.split('/').pop() || 'audio.mp4'
  const mimeType = fileName.endsWith('.mp3') ? 'audio/mpeg'
    : fileName.endsWith('.m4a') ? 'audio/mp4'
    : fileName.endsWith('.wav') ? 'audio/wav'
    : 'video/mp4'
  return { buffer, fileName, mimeType }
}

/**
 * Transcribe a local audio/video file to SRT-format captions.
 *
 * @param {string} filePath — absolute path in /tmp
 * @returns {Promise<string>} SRT text
 */
export async function transcribeToSrt(filePath) {
  const { buffer, fileName, mimeType } = await readLocalFile(filePath)
  const form = new FormData()
  form.append('file',            new Blob([buffer], { type: mimeType }), fileName)
  form.append('model',           'whisper-1')
  form.append('response_format', 'srt')
  const res = await whisper(form)
  return res.text()
}

/**
 * Transcribe a local file to timestamped segments.
 * Each segment is a coherent cue (~5–15s) with start/end in seconds.
 *
 * @param {string} filePath — absolute path in /tmp (mp3 strongly preferred)
 * @returns {Promise<Array<{start: number, end: number, text: string}>>}
 */
export async function transcribeToSegments(filePath) {
  const { buffer, fileName, mimeType } = await readLocalFile(filePath)
  const form = new FormData()
  form.append('file',                      new Blob([buffer], { type: mimeType }), fileName)
  form.append('model',                     'whisper-1')
  form.append('response_format',           'verbose_json')
  form.append('timestamp_granularities[]', 'segment')
  const res  = await whisper(form)
  const json = await res.json().catch(() => null)
  return (json?.segments ?? [])
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim() }))
    .filter((s) => s.text && s.end > s.start)
}

/**
 * FUTURE — speaker-diarized transcription.
 * Stub until AssemblyAI / Deepgram provider is wired in.
 *
 * @param {string} filePath
 * @returns {Promise<{text: string, speakers: Array<{speaker: string, text: string, start: number, end: number}>}>}
 */
export async function transcribeWithSpeakers(filePath) {
  const { buffer, fileName, mimeType } = await readLocalFile(filePath)
  const form = new FormData()
  form.append('file',            new Blob([buffer], { type: mimeType }), fileName)
  form.append('model',           'whisper-1')
  form.append('response_format', 'text')
  // TODO: replace with AssemblyAI or Deepgram diarization call
  const res  = await whisper(form)
  const text = await res.text()
  return { text, speakers: [] }
}
