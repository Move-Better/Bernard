/**
 * @movebetter/transcribe — api/_lib copy
 *
 * Shared transcription layer, mirrored in packages/transcribe/index.js.
 * Provider swaps (e.g. Whisper → AssemblyAI diarization) happen here
 * and in packages/transcribe/index.js in tandem.
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

// ---------------------------------------------------------------------------
// Hallucination filter
//
// Whisper is trained on a lot of YouTube, and on silent or near-silent audio it
// does not return nothing — it returns the stock outro it heard ten thousand
// times: "Thank you for watching". That is indistinguishable from a real
// transcript to every caller, so it gets persisted and burned into a reel as a
// karaoke caption over footage of someone doing a pull-up.
//
// Measured on the 2026-07-25 backfill: 17 of 448 transcripts (3.8%) were this,
// across exactly four texts, and in EVERY case it was the entire transcript —
// never a phrase appended to real speech.
//
// So the rule is deliberately narrow: the WHOLE transcript must be filler. A
// 500-word interview that happens to end with "thanks for watching" is real
// speech and is left alone. That asymmetry matters — a false positive here
// silently deletes a genuine transcript, which is far worse than letting one
// hallucination through. tests/lib/whisperHallucination.test.js pins both
// directions, including short real speech that CONTAINS the phrase.
const HALLUCINATION_PATTERNS = [
  /^thank(s| you)?(?: you)? for watching(?: my video| this video| everyone| and see you (?:in )?(?:the )?next (?:video|time)| and see you next time)?$/,
  /^(?:please )?(?:don'?t forget to )?(?:like(?: and|,)? )?(?:subscribe(?: to (?:my|our) channel)?)$/,
  /^subtitles?(?: and translation)? by .*$/,
  /^amara org.*$/,
  /^(?:you|thank you|thanks|bye|okay)$/,
]

// Above this, a transcript carries enough real content that a stock phrase
// cannot plausibly be the whole of it. Belt-and-braces: every pattern is
// already whole-string anchored, so this only guards future looser edits.
const HALLUCINATION_MAX_WORDS = 15

/**
 * True when a transcript is nothing but Whisper's silent-audio filler.
 *
 * @param {string} text — the full transcript, in reading order
 * @returns {boolean}
 */
export function isHallucinatedTranscript(text) {
  const norm = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')   // keep apostrophes so "don't" stays one word
    .replace(/\s+/g, ' ')
    .trim()
  if (!norm) return false
  if (norm.split(' ').length > HALLUCINATION_MAX_WORDS) return false
  return HALLUCINATION_PATTERNS.some((re) => re.test(norm))
}

// SRT is index / timestamp / text triplets; pull out just the spoken lines.
function srtToText(srt) {
  return String(srt ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\d+$/.test(l) && !l.includes('-->'))
    .join(' ')
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
  const srt = await res.text()
  // brandRenderVideo falls back to this path whenever the word pass yields
  // nothing — including when the word pass was suppressed as a hallucination.
  // Without the same check here the filler comes straight back as a burned-in
  // subtitle and the filter buys nothing.
  if (isHallucinatedTranscript(srtToText(srt))) return ''
  return srt
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
  const segments = (json?.segments ?? [])
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim() }))
    .filter((s) => s.text && s.end > s.start)
  if (isHallucinatedTranscript(segments.map((s) => s.text).join(' '))) return []
  return segments
}

/**
 * Transcribe a local file to word-level timestamps (for karaoke captions).
 * Each entry is a single spoken word with start/end in seconds.
 *
 * @param {string} filePath — absolute path in /tmp (mp3 strongly preferred)
 * @returns {Promise<Array<{word: string, start: number, end: number}>>}
 */
export async function transcribeToWords(filePath) {
  const { buffer, fileName, mimeType } = await readLocalFile(filePath)
  const form = new FormData()
  form.append('file',                      new Blob([buffer], { type: mimeType }), fileName)
  form.append('model',                     'whisper-1')
  form.append('response_format',           'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  const res  = await whisper(form)
  const json = await res.json().catch(() => null)
  const words = (json?.words ?? [])
    .map((w) => ({ word: String(w.word || '').trim(), start: Number(w.start) || 0, end: Number(w.end) || 0 }))
    // KEEP zero-duration words (end === start). Whisper quantises word
    // timestamps to its 20ms frame hop, so a fast function word ("to", "the")
    // or a clipped syllable legitimately lands in the 0.00s bucket — it is a
    // real spoken word, not a malformed row. The old `end > start` here silently
    // deleted ~4% of every transcript, which read downstream as duplicated or
    // reordered speech: "how to do, how fast to do" lost its zero-duration "to"
    // and burned into captions as "how do how fast". Reject only genuinely
    // invalid geometry (non-finite, or end before start).
    .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start)
  if (isHallucinatedTranscript(words.map((w) => w.word).join(' '))) return []
  return words
}

/**
 * Transcribe a local file to BOTH segment cues and word-level timestamps in a
 * SINGLE Whisper call (verbose_json with both granularities). Used by segment
 * detection: the LLM gets the segment cues, and the word timestamps are persisted
 * once onto the source asset so clip renders never have to re-transcribe (the
 * "stop discarding the words" change — migration 137 `media_assets.transcript_words`).
 *
 * @param {string} filePath — absolute path in /tmp (mp3 strongly preferred)
 * @returns {Promise<{segments: Array<{start:number,end:number,text:string}>, words: Array<{word:string,start:number,end:number}>}>}
 */
export async function transcribeToSegmentsAndWords(filePath) {
  const { buffer, fileName, mimeType } = await readLocalFile(filePath)
  const form = new FormData()
  form.append('file',                      new Blob([buffer], { type: mimeType }), fileName)
  form.append('model',                     'whisper-1')
  form.append('response_format',           'verbose_json')
  form.append('timestamp_granularities[]', 'segment')
  form.append('timestamp_granularities[]', 'word')
  const res  = await whisper(form)
  const json = await res.json().catch(() => null)
  const segments = (json?.segments ?? [])
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim() }))
    .filter((s) => s.text && s.end > s.start)
  const words = (json?.words ?? [])
    .map((w) => ({ word: String(w.word || '').trim(), start: Number(w.start) || 0, end: Number(w.end) || 0 }))
    // KEEP zero-duration words (end === start). Whisper quantises word
    // timestamps to its 20ms frame hop, so a fast function word ("to", "the")
    // or a clipped syllable legitimately lands in the 0.00s bucket — it is a
    // real spoken word, not a malformed row. The old `end > start` here silently
    // deleted ~4% of every transcript, which read downstream as duplicated or
    // reordered speech: "how to do, how fast to do" lost its zero-duration "to"
    // and burned into captions as "how do how fast". Reject only genuinely
    // invalid geometry (non-finite, or end before start).
    .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start)
  // Judge on the word stream (the richer of the two) and drop BOTH together, so
  // a caller can never persist filler segments alongside empty words.
  if (isHallucinatedTranscript(words.map((w) => w.word).join(' '))) return { segments: [], words: [] }
  return { segments, words }
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
