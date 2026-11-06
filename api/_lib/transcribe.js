/**
 * Shared transcription layer — ElevenLabs Scribe v2.
 *
 * This is the ONE provider seam for every batch (non-realtime) transcription in
 * Bernard: reel captions (brandRenderVideo), segment detection (segmentDetect),
 * call transcripts (callTranscript), seminar chunks (seminarTranscribe), voice
 * memos, handouts and the public demo. Swap vendors here and nowhere else.
 *
 * Why Scribe (2026-11-05): OpenAI retires whisper-1 on 2027-02-26 and its named
 * replacement has no word timestamps, which karaoke captions are built from. A
 * bake-off on 20 real media_assets (.claude/nemotron-transcription-findings.md)
 * measured Scribe v2 against Whisper, Gemini and Nemotron: fewer zero-duration
 * words (2.5% vs 6.6%), fewer stacked timestamps (0.9% vs 4.9%), no invented
 * speech on silent b-roll (Whisper and Nemotron both fabricate there), kept
 * speech Whisper dropped on a noisy clip, and 2x faster. Same vendor as the
 * voice clone, so the key already exists in prod.
 *
 * Scribe returns WORDS only (no segments, no SRT). Segments and SRT are derived
 * here from the words with pure functions so every caller keeps the shape it had
 * under Whisper. Accepts audio and video containers directly (MP3, M4A, WAV,
 * WebM, MP4, MOV, ...), up to 3 GB / 10 hours; the local cap below is about
 * function memory, not the vendor.
 *
 * The hallucination filter stays. It was written for Whisper's silent-audio
 * filler and Scribe returned empty on every silent clip in the bake-off, but it
 * costs nothing and still fired once in 20 clips on Whisper.
 */

import { readFile, stat } from 'node:fs/promises'

const SCRIBE_URL = 'https://api.elevenlabs.io/v1/speech-to-text'
const MODEL_ID   = 'scribe_v2'
// Whole file is buffered into memory for the multipart body. 200 MB keeps a
// 1 GB function comfortable; callers that may exceed it extract audio first
// (brandRenderVideo, segmentDetect) or chunk (seminarTranscribe).
const MAX_BYTES  = 200 * 1024 * 1024
// A hung upstream must surface as an error, not hold the worker to the 300 s
// wall (a SIGKILL skips every catch/finally and strands status rows).
const DEFAULT_TIMEOUT_MS = 120_000

function apiKey() {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new Error('ELEVENLABS_API_KEY not set')
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
// hallucination through. tests/lib/transcribeHallucination.test.js pins both
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
 * True when a transcript is nothing but silent-audio filler.
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

// ---------------------------------------------------------------------------
// Pure shape helpers (tested in tests/lib/transcribeShapes.test.js)

/**
 * Scribe's `words` array interleaves `word`, `spacing` and `audio_event`
 * entries. Keep the spoken words only, in Bernard's {word,start,end} shape, and
 * carry the speaker label when Scribe gave one.
 *
 * KEEP zero-duration words (end === start). A fast function word ("to", "the")
 * or a clipped syllable can legitimately land on a point — it is a real spoken
 * word, not a malformed row. Reject only invalid geometry (non-finite, or end
 * before start). Dropping point words under Whisper read downstream as
 * duplicated or reordered speech ("how to do, how fast to do" → "how do how fast").
 *
 * @param {Array<object>|undefined} raw
 * @returns {Array<{word:string,start:number,end:number,speaker?:string}>}
 */
export function scribeWordsToWords(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((w) => w && (w.type === 'word' || w.type == null))
    .map((w) => {
      const out = { word: String(w.text ?? w.word ?? '').trim(), start: Number(w.start), end: Number(w.end) }
      if (w.speaker_id != null) out.speaker = String(w.speaker_id)
      return out
    })
    .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start)
}

// Segment cues are what the segment-detection LLM and the call-transcript
// speaker merge consume: coherent 5–15 s chunks. Scribe gives no segments, so
// derive them from the words — break on sentence-ending punctuation, on a real
// pause, or when a cue gets long, whichever comes first.
const SEG_MAX_SEC   = 15
const SEG_MAX_WORDS = 40
const SEG_GAP_SEC   = 1.0

/**
 * @param {Array<{word:string,start:number,end:number}>} words
 * @returns {Array<{start:number,end:number,text:string}>}
 */
export function wordsToSegments(words) {
  const segs = []
  let cur = []
  const flush = () => {
    if (!cur.length) return
    segs.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.word).join(' ') })
    cur = []
  }
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1]
      const tooLong = w.end - cur[0].start > SEG_MAX_SEC || cur.length >= SEG_MAX_WORDS
      const gap = w.start - prev.end > SEG_GAP_SEC
      if (tooLong || gap) flush()
    }
    cur.push(w)
    if (/[.!?]["')\]]*$/.test(w.word)) flush()
  }
  flush()
  // A cue whose end equals its start (one point word) carries no span for the
  // consumers; give it a minimal one rather than dropping speech.
  return segs.map((s) => (s.end > s.start ? s : { ...s, end: s.start + 0.01 }))
}

function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const r = ms % 1000
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`
}

/**
 * @param {Array<{start:number,end:number,text:string}>} segments
 * @returns {string} SRT text ('' for no segments)
 */
export function segmentsToSrt(segments) {
  return segments
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`)
    .join('\n')
}

/**
 * Normalise one Scribe response into every shape a caller wants, applying the
 * hallucination filter ONCE on the word stream (the richer signal) and dropping
 * everything together, so no caller can persist filler segments beside empty
 * words.
 *
 * @param {object|null} json — parsed Scribe response
 * @returns {{text:string, words:Array, segments:Array, srt:string, language:string|null}}
 */
export function normalizeScribeResponse(json) {
  const words = scribeWordsToWords(json?.words)
  const text = String(json?.text ?? '').trim()
  const language = json?.language_code ?? null
  const judged = words.length ? words.map((w) => w.word).join(' ') : text
  if (isHallucinatedTranscript(judged)) return { text: '', words: [], segments: [], srt: '', language }
  const segments = wordsToSegments(words)
  return { text, words, segments, srt: segmentsToSrt(segments), language }
}

// ---------------------------------------------------------------------------
// Transport

function guessMime(fileName) {
  const ext = String(fileName).split('.').pop()?.toLowerCase()
  return ext === 'mp3' ? 'audio/mpeg'
    : ext === 'm4a' ? 'audio/mp4'
      : ext === 'wav' ? 'audio/wav'
        : ext === 'webm' ? 'audio/webm'
          : ext === 'mov' ? 'video/quicktime'
            : 'video/mp4'
}

async function readLocalFile(filePath) {
  const { size } = await stat(filePath)
  if (size > MAX_BYTES) {
    throw new Error(`File too large to buffer for transcription: ${Math.round(size / 1e6)}MB (max ${MAX_BYTES / 1e6}MB). Extract audio or chunk first.`)
  }
  const buffer   = await readFile(filePath)
  const fileName = filePath.split('/').pop() || 'audio.mp4'
  return { buffer, fileName, mimeType: guessMime(fileName) }
}

/**
 * One Scribe call. Returns the raw parsed JSON.
 *
 * @param {Buffer|Uint8Array} buffer
 * @param {{fileName?:string, mimeType?:string, diarize?:boolean, signal?:AbortSignal}} [opts]
 */
async function scribe(buffer, { fileName = 'audio.mp4', mimeType, diarize = false, signal } = {}) {
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: mimeType || guessMime(fileName) }), fileName)
  form.append('model_id', MODEL_ID)
  form.append('timestamps_granularity', 'word')
  form.append('diarize', diarize ? 'true' : 'false')
  // "(laughs)" / "(music)" tokens would otherwise land in captions and scripts.
  form.append('tag_audio_events', 'false')
  const res = await fetch(SCRIBE_URL, {
    method:  'POST',
    headers: { 'xi-api-key': apiKey() },
    body:    form,
    signal:  signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Scribe API ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

/**
 * Transcribe in-memory audio to plain text. For handlers that already hold the
 * upload bytes (voice memo, handout, demo, seminar chunks).
 *
 * @param {Buffer|Uint8Array} buffer
 * @param {{fileName?:string, mimeType?:string, signal?:AbortSignal}} [opts]
 * @returns {Promise<string>} '' when the audio is silent/filler
 */
export async function transcribeBufferToText(buffer, opts = {}) {
  return normalizeScribeResponse(await scribe(buffer, opts)).text
}

/**
 * Transcribe a local audio/video file to SRT-format captions.
 * @param {string} filePath — absolute path in /tmp
 * @returns {Promise<string>} SRT text ('' when silent/filler)
 */
export async function transcribeToSrt(filePath) {
  const { buffer, fileName, mimeType } = await readLocalFile(filePath)
  return normalizeScribeResponse(await scribe(buffer, { fileName, mimeType })).srt
}

/**
 * Transcribe a local file to timestamped segment cues (~5–15 s each).
 * @param {string} filePath
 * @returns {Promise<Array<{start: number, end: number, text: string}>>}
 */
export async function transcribeToSegments(filePath) {
  const { buffer, fileName, mimeType } = await readLocalFile(filePath)
  return normalizeScribeResponse(await scribe(buffer, { fileName, mimeType })).segments
}

/**
 * Transcribe a local file to word-level timestamps (for karaoke captions).
 * @param {string} filePath
 * @returns {Promise<Array<{word: string, start: number, end: number}>>}
 */
export async function transcribeToWords(filePath) {
  const { buffer, fileName, mimeType } = await readLocalFile(filePath)
  return normalizeScribeResponse(await scribe(buffer, { fileName, mimeType })).words
}

/**
 * Segment cues AND word timestamps from ONE call. Used by segment detection:
 * the LLM gets the cues, the words are persisted once onto the source asset
 * (migration 137 `media_assets.transcript_words`) so renders never re-transcribe.
 *
 * @param {string} filePath
 * @returns {Promise<{segments: Array<{start:number,end:number,text:string}>, words: Array<{word:string,start:number,end:number}>}>}
 */
export async function transcribeToSegmentsAndWords(filePath) {
  const { buffer, fileName, mimeType } = await readLocalFile(filePath)
  const { segments, words } = normalizeScribeResponse(await scribe(buffer, { fileName, mimeType }))
  return { segments, words }
}

/**
 * Speaker-diarized transcription. Scribe labels speakers natively (up to 32);
 * each returned turn is a run of consecutive words from one speaker.
 *
 * @param {string} filePath
 * @returns {Promise<{text: string, speakers: Array<{speaker: string, text: string, start: number, end: number}>}>}
 */
export async function transcribeWithSpeakers(filePath) {
  const { buffer, fileName, mimeType } = await readLocalFile(filePath)
  const { text, words } = normalizeScribeResponse(await scribe(buffer, { fileName, mimeType, diarize: true }))
  const speakers = []
  for (const w of words) {
    const last = speakers[speakers.length - 1]
    if (last && last.speaker === (w.speaker ?? 'unknown')) {
      last.text += ' ' + w.word
      last.end = w.end
    } else {
      speakers.push({ speaker: w.speaker ?? 'unknown', text: w.word, start: w.start, end: w.end })
    }
  }
  return { text, speakers }
}
