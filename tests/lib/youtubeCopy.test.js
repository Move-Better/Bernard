import { describe, it, expect } from 'vitest'
import {
  isYouTubeEligible,
  checkYouTubeUploadSize,
  transcriptText,
  formatStamp,
  planChapters,
  appendChapters,
  YOUTUBE_MAX_UPLOAD_BYTES,
  MIN_CHAPTERS,
  MIN_CHAPTER_SECONDS,
} from '../../api/_lib/youtubeCopy.js'
import { buildDataBlock } from '../../api/_lib/social/bundlePublisher.js'
import {
  isYouTubeEligible as clientEligible,
  isWithinUploadLimit as clientWithinLimit,
  YOUTUBE_MAX_UPLOAD_BYTES as CLIENT_MAX,
} from '../../src/lib/youtubeLib.js'

const GB = 1024 * 1024 * 1024

// A landscape video asset, shaped like the real media_assets rows this lane
// reads (movebetter's patient interviews).
const landscape = (over = {}) => ({
  kind: 'video', width: 1920, height: 1080, blob_url: 'https://blob/x.mp4',
  archived_at: null, size_bytes: 466 * 1024 * 1024, ...over,
})

// Build a transcript_words array: `count` words at `perSec` intervals.
const words = (count, perSec = 1) =>
  Array.from({ length: count }, (_, i) => ({
    word: `w${i}`, start: i * perSec, end: i * perSec + 0.3,
  }))

describe('isYouTubeEligible', () => {
  it('accepts a landscape video', () => {
    expect(isYouTubeEligible(landscape())).toBe(true)
  })

  it('rejects a vertical video — that belongs in the Shorts/clip lane', () => {
    expect(isYouTubeEligible(landscape({ width: 1080, height: 1920 }))).toBe(false)
  })

  it('rejects a square video (not landscape)', () => {
    expect(isYouTubeEligible(landscape({ width: 1080, height: 1080 }))).toBe(false)
  })

  it('rejects photos, archived rows, and rows with no file', () => {
    expect(isYouTubeEligible(landscape({ kind: 'photo' }))).toBe(false)
    expect(isYouTubeEligible(landscape({ archived_at: '2026-01-01' }))).toBe(false)
    expect(isYouTubeEligible(landscape({ blob_url: null }))).toBe(false)
  })

  it('rejects a row with unknown dimensions rather than guessing', () => {
    expect(isYouTubeEligible(landscape({ width: null, height: null }))).toBe(false)
  })

  it('is not gated on duration — a short landscape clip is a real YouTube video', () => {
    expect(isYouTubeEligible(landscape({ duration_s: 8 }))).toBe(true)
  })
})

describe('checkYouTubeUploadSize', () => {
  // These two numbers are the actual measurements against bundle's live
  // from-url endpoint (2026-08-03) that set the constant. If the threshold is
  // ever moved, these are what have to be re-measured.
  it('passes the 2.26 GB upload that was measured succeeding', () => {
    expect(checkYouTubeUploadSize({ size_bytes: 2260 * 1024 * 1024 }).ok).toBe(true)
  })

  it('blocks the 5.9 GB upload that was measured failing', () => {
    const r = checkYouTubeUploadSize({ size_bytes: 5897 * 1024 * 1024 })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('too_large')
  })

  it('blocks anything past the ceiling and passes anything under', () => {
    expect(checkYouTubeUploadSize({ size_bytes: YOUTUBE_MAX_UPLOAD_BYTES + 1 }).ok).toBe(false)
    expect(checkYouTubeUploadSize({ size_bytes: YOUTUBE_MAX_UPLOAD_BYTES }).ok).toBe(true)
  })

  it('lets an unknown size through — some older rows have a null size_bytes', () => {
    expect(checkYouTubeUploadSize({ size_bytes: null }).ok).toBe(true)
  })
})

describe('client/server mirror', () => {
  // src/ cannot import from api/, so the rules exist twice on purpose. These
  // pin the copies together — the failure mode this guards is one being
  // changed without the other, which would let a stale client offer a publish
  // the server refuses (or hide one it would accept).
  it('agrees on the upload ceiling', () => {
    expect(CLIENT_MAX).toBe(YOUTUBE_MAX_UPLOAD_BYTES)
  })

  it('agrees on eligibility across the shapes that matter', () => {
    const cases = [
      landscape(),
      landscape({ width: 1080, height: 1920 }),
      landscape({ width: 1080, height: 1080 }),
      landscape({ kind: 'photo' }),
      landscape({ archived_at: '2026-01-01' }),
      landscape({ blob_url: null }),
      landscape({ width: null, height: null }),
    ]
    for (const asset of cases) {
      expect(clientEligible(asset)).toBe(isYouTubeEligible(asset))
    }
  })

  it('agrees on the size check across the ceiling', () => {
    for (const size of [0, 466 * 1024 * 1024, 2.26 * GB, 3 * GB, 5.9 * GB]) {
      expect(clientWithinLimit({ size_bytes: size })).toBe(checkYouTubeUploadSize({ size_bytes: size }).ok)
    }
  })
})

describe('transcriptText', () => {
  it('joins word tokens into readable text', () => {
    expect(transcriptText([
      { word: 'Yeah', start: 0 }, { word: 'lean', start: 1 }, { word: 'forward', start: 2 },
    ])).toBe('Yeah lean forward')
  })

  it('tucks punctuation against the preceding word', () => {
    expect(transcriptText([
      { word: 'Right', start: 0 }, { word: ',', start: 1 }, { word: 'so', start: 2 },
    ])).toBe('Right, so')
  })

  it('survives a null or non-array transcript_words', () => {
    expect(transcriptText(null)).toBe('')
    expect(transcriptText(undefined)).toBe('')
    expect(transcriptText('nope')).toBe('')
  })
})

describe('formatStamp', () => {
  it('uses m:ss under an hour and h:mm:ss past it', () => {
    expect(formatStamp(0)).toBe('0:00')
    expect(formatStamp(9)).toBe('0:09')
    expect(formatStamp(75)).toBe('1:15')
    expect(formatStamp(3600)).toBe('1:00:00')
    expect(formatStamp(3725)).toBe('1:02:05')
  })

  it('never emits a negative or fractional stamp', () => {
    expect(formatStamp(-5)).toBe('0:00')
    expect(formatStamp(12.9)).toBe('0:12')
  })
})

describe('planChapters', () => {
  it('starts the first chapter at 0:00 — YouTube ignores the list otherwise', () => {
    const plan = planChapters(words(300))
    expect(plan.length).toBeGreaterThanOrEqual(MIN_CHAPTERS)
    expect(plan[0].startSec).toBe(0)
  })

  it('still starts at 0:00 when the clip opens with silence', () => {
    // The case the assertion above CANNOT catch on its own: with a fixture whose
    // first word is already at t=0, anchoring the first chapter to the first
    // spoken word looks identical to anchoring it to zero. Here the speaker does
    // not start until 0:30, so the two differ — and getting it wrong means
    // YouTube silently ignores every chapter on the video.
    const late = words(300).map((w) => ({ ...w, start: w.start + 30, end: w.end + 30 }))
    const plan = planChapters(late)
    expect(plan.length).toBeGreaterThanOrEqual(MIN_CHAPTERS)
    expect(plan[0].startSec).toBe(0)
  })

  it('produces no chapter shorter than the minimum YouTube honours', () => {
    const plan = planChapters(words(300))
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].startSec - plan[i - 1].startSec).toBeGreaterThanOrEqual(MIN_CHAPTER_SECONDS)
    }
  })

  it('returns nothing for a source too short to earn three chapters', () => {
    // 20 seconds cannot hold 3 x 10s chapters.
    expect(planChapters(words(20))).toEqual([])
  })

  it('returns nothing when there are no word timings at all', () => {
    expect(planChapters([])).toEqual([])
    expect(planChapters(null)).toEqual([])
  })

  it('carries the spoken text of each segment', () => {
    const plan = planChapters(words(300))
    expect(plan.every((c) => c.text.length > 0)).toBe(true)
  })

  it('folds a trailing stub back rather than emitting a too-short last chapter', () => {
    // 185 words at 1s: a 60s target leaves a 5s tail, under the 10s minimum.
    const plan = planChapters(words(185))
    const last = plan[plan.length - 1]
    const prev = plan[plan.length - 2]
    expect(last.startSec - prev.startSec).toBeGreaterThanOrEqual(MIN_CHAPTER_SECONDS)
  })
})

describe('appendChapters', () => {
  const three = [
    { startSec: 0, title: 'The injury' },
    { startSec: 62, title: 'The assessment' },
    { startSec: 140, title: 'What changed' },
  ]

  it('appends a stamped chapter list', () => {
    const out = appendChapters('A description.', three)
    expect(out).toContain('0:00 The injury')
    expect(out).toContain('1:02 The assessment')
    expect(out).toContain('2:20 What changed')
  })

  it('leaves the body untouched below the three-chapter minimum', () => {
    expect(appendChapters('Body.', three.slice(0, 2))).toBe('Body.')
    expect(appendChapters('Body.', [])).toBe('Body.')
    expect(appendChapters('Body.', null)).toBe('Body.')
  })

  it('drops untitled chapters, and the section with them', () => {
    const out = appendChapters('Body.', [three[0], { startSec: 62, title: '  ' }, three[2]])
    expect(out).toBe('Body.')
  })
})

// The defect this whole file exists to prevent: buildDataBlock used to send only
// `text` for YOUTUBE, so a long-form description published as the video TITLE
// and the description was never sent at all.
describe('buildDataBlock — YouTube title vs description', () => {
  const uploads = [{ id: 'u1', type: 'video' }]

  it('sends the title as text and the description as description', () => {
    const block = buildDataBlock({
      platform: 'youtube', type: 'YOUTUBE', text: 'ignored', uploads,
      title: 'Darian on getting back to work', description: 'A longer body.',
    })
    expect(block.text).toBe('Darian on getting back to work')
    expect(block.description).toBe('A longer body.')
  })

  it('clamps a title past YouTube 100-char limit instead of failing the publish', () => {
    const block = buildDataBlock({
      platform: 'youtube', type: 'YOUTUBE', text: '', uploads,
      title: 'x'.repeat(250), description: 'body',
    })
    expect(block.text).toHaveLength(100)
  })

  it('defaults privacy to PUBLIC and rejects a bogus value', () => {
    const ok = buildDataBlock({
      platform: 'youtube', type: 'YOUTUBE', text: '', uploads,
      title: 't', description: 'd', privacy: 'UNLISTED',
    })
    expect(ok.privacy).toBe('UNLISTED')
    const bogus = buildDataBlock({
      platform: 'youtube', type: 'YOUTUBE', text: '', uploads,
      title: 't', description: 'd', privacy: 'nonsense',
    })
    expect(bogus.privacy).toBe('PUBLIC')
  })

  it('marks long-form as VIDEO and a Short as SHORT', () => {
    expect(buildDataBlock({ platform: 'youtube', type: 'YOUTUBE', text: 't', uploads, title: 't', description: 'd' }).type).toBe('VIDEO')
    expect(buildDataBlock({ platform: 'youtube_short', type: 'YOUTUBE', text: 't', uploads, title: 't', description: 'd' }).type).toBe('SHORT')
  })

  it('keeps the legacy single-caption shape when no title is supplied', () => {
    // Nothing that publishes a Short today should change shape.
    const block = buildDataBlock({ platform: 'youtube_short', type: 'YOUTUBE', text: 'just a caption', uploads })
    expect(block.text).toBe('just a caption')
    expect(block).not.toHaveProperty('description')
    expect(block).not.toHaveProperty('privacy')
  })

  it('carries the video upload ids', () => {
    const block = buildDataBlock({
      platform: 'youtube', type: 'YOUTUBE', text: '', uploads,
      title: 't', description: 'd',
    })
    expect(block.uploadIds).toEqual(['u1'])
  })
})
