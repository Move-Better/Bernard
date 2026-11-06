import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  scribeWordsToWords, wordsToSegments, segmentsToSrt, normalizeScribeResponse,
} from '../../api/_lib/transcribe.js'

// Scribe v2 returns an interleaved word stream and NO segments/SRT; every
// caller still expects Whisper's shapes. These pin the derivation. The fixture
// below is the SHAPE of a real response (keys, types, spacing/audio_event
// entries) with short synthetic content — see the bake-off raw files for the
// real ones (.claude/nemotron-transcription-findings.md).
const raw = [
  { text: 'Stay', type: 'word', start: 0.06, end: 0.22, speaker_id: 'speaker_0' },
  { text: ' ', type: 'spacing', start: 0.22, end: 0.32, speaker_id: 'speaker_0' },
  { text: 'tight.', type: 'word', start: 0.32, end: 0.46, speaker_id: 'speaker_0' },
  { text: '(laughs)', type: 'audio_event', start: 0.5, end: 0.9 },
  { text: 'Good', type: 'word', start: 2.0, end: 2.0, speaker_id: 'speaker_1' },     // point word: KEEP
  { text: 'bad', type: 'word', start: 3.0, end: 2.5 },                                // end < start: DROP
  { text: 'nan', type: 'word', start: 'x', end: 4 },                                  // non-finite: DROP
]

describe('scribeWordsToWords', () => {
  it('keeps only spoken words, in Bernard shape, carrying the speaker', () => {
    const out = scribeWordsToWords(raw)
    expect(out.map((w) => w.word)).toEqual(['Stay', 'tight.', 'Good'])
    expect(out[0]).toEqual({ word: 'Stay', start: 0.06, end: 0.22, speaker: 'speaker_0' })
  })
  it('keeps zero-duration words and drops invalid geometry', () => {
    const out = scribeWordsToWords(raw)
    expect(out.find((w) => w.word === 'Good')).toMatchObject({ start: 2.0, end: 2.0 })
    expect(out.some((w) => w.word === 'bad' || w.word === 'nan')).toBe(false)
  })
  it('tolerates a missing or non-array words field', () => {
    expect(scribeWordsToWords(undefined)).toEqual([])
    expect(scribeWordsToWords({})).toEqual([])
  })
})

const w = (word, start, end) => ({ word, start, end })

describe('wordsToSegments', () => {
  it('breaks on sentence-ending punctuation', () => {
    const segs = wordsToSegments([w('Stay', 0, 0.2), w('tight.', 0.3, 0.5), w('Good', 0.6, 0.8), w('job.', 0.9, 1.1)])
    expect(segs.map((s) => s.text)).toEqual(['Stay tight.', 'Good job.'])
    expect(segs[0]).toMatchObject({ start: 0, end: 0.5 })
  })
  it('breaks on a real pause even without punctuation', () => {
    const segs = wordsToSegments([w('one', 0, 0.2), w('two', 0.3, 0.5), w('three', 2.0, 2.2)])
    expect(segs.map((s) => s.text)).toEqual(['one two', 'three'])
  })
  it('does not break on a short gap', () => {
    const segs = wordsToSegments([w('one', 0, 0.2), w('two', 0.9, 1.1)])
    expect(segs).toHaveLength(1)
  })
  it('caps a cue at 15 seconds of span', () => {
    const words = Array.from({ length: 30 }, (_, i) => w(`w${i}`, i * 0.8, i * 0.8 + 0.3))  // 24 s, no punctuation, no pauses
    const segs = wordsToSegments(words)
    expect(segs.length).toBeGreaterThan(1)
    for (const s of segs) expect(s.end - s.start).toBeLessThanOrEqual(15)
  })
  it('gives a lone point word a minimal span instead of dropping it', () => {
    expect(wordsToSegments([w('Hm.', 1, 1)])).toEqual([{ start: 1, end: 1.01, text: 'Hm.' }])
  })
})

describe('segmentsToSrt', () => {
  it('formats indices, HH:MM:SS,mmm timestamps and blank-line separators', () => {
    const srt = segmentsToSrt([{ start: 0.06, end: 1.5, text: 'Stay tight.' }, { start: 61.25, end: 3600.2, text: 'Go.' }])
    expect(srt).toBe('1\n00:00:00,060 --> 00:00:01,500\nStay tight.\n\n2\n00:01:01,250 --> 01:00:00,200\nGo.\n')
  })
  it('is empty for no segments', () => { expect(segmentsToSrt([])).toBe('') })
})

describe('normalizeScribeResponse', () => {
  it('returns every shape from one response', () => {
    const out = normalizeScribeResponse({ text: 'Stay tight.', language_code: 'en', words: raw.slice(0, 3) })
    expect(out.text).toBe('Stay tight.')
    expect(out.language).toBe('en')
    expect(out.words).toHaveLength(2)
    expect(out.segments).toEqual([{ start: 0.06, end: 0.46, text: 'Stay tight.' }])
    expect(out.srt).toContain('00:00:00,060 --> 00:00:00,460')
  })
  it('drops text, words, segments and srt TOGETHER when the transcript is silent-audio filler', () => {
    const filler = [{ text: 'Thank', type: 'word', start: 0, end: 0.2 }, { text: 'you', type: 'word', start: 0.2, end: 0.4 }, { text: 'for', type: 'word', start: 0.4, end: 0.5 }, { text: 'watching.', type: 'word', start: 0.5, end: 0.9 }]
    expect(normalizeScribeResponse({ text: 'Thank you for watching.', words: filler })).toEqual({ text: '', words: [], segments: [], srt: '', language: null })
  })
  it('judges on the text when the vendor sent no words (text-only fallback)', () => {
    expect(normalizeScribeResponse({ text: 'Thanks for watching' }).text).toBe('')
    expect(normalizeScribeResponse({ text: 'Keep your hips tight.' }).text).toBe('Keep your hips tight.')
  })
  it('returns empty shapes for an empty or null response', () => {
    expect(normalizeScribeResponse(null)).toEqual({ text: '', words: [], segments: [], srt: '', language: null })
    expect(normalizeScribeResponse({ text: '', words: [] }).segments).toEqual([])
  })
})

// The seam must stay single: no batch transcription may call OpenAI directly
// again. The two realtime paths (realtime-session.js, twilioSip.js) use a
// different, streaming model and are deliberately outside this guard.
describe('no batch caller bypasses the transcription seam', () => {
  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out) }
      else if (/\.(js|mjs)$/.test(name)) out.push(p)
    }
    return out
  }
  const files = walk('api')
  it('scans a real set of files', () => { expect(files.length).toBeGreaterThan(50) })
  it('no api/ file posts to the OpenAI transcriptions endpoint or names whisper-1 as a model', () => {
    const offenders = files.filter((p) => {
      const src = readFileSync(p, 'utf8')
      return /api\.openai\.com\/v1\/audio\/transcriptions/.test(src) || /['"]whisper-1['"]/.test(src)
    })
    expect(offenders).toEqual([])
  })
  it('every batch caller imports the seam', () => {
    for (const p of ['api/voice-memo.js', 'api/handout/create.js', 'api/demo/transcribe.js', 'api/_lib/seminarTranscribe.js', 'api/_lib/brandRenderVideo.js', 'api/_lib/segmentDetect.js', 'api/_lib/callTranscript.js']) {
      expect(readFileSync(p, 'utf8')).toMatch(/from '(\.\.?\/)+(_lib\/)?transcribe\.js'/)
    }
  })
})
