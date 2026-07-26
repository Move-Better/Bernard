import { describe, it, expect } from 'vitest'
import { isHallucinatedTranscript } from '../../api/_lib/whisper.js'

// Whisper returns its YouTube-outro filler on silent audio instead of nothing.
// These are the FOUR texts actually observed in prod on 2026-07-25, across 17
// of 448 transcripts — every one of them the entire transcript, never a phrase
// appended to real speech. See api/_lib/whisper.js.
const OBSERVED_IN_PROD = [
  ['Thank you for watching', 13],
  ['Thanks for watching', 2],
  ['Thank you for watching and see you in the next video', 1],
  ['Thank you for watching my video', 1],
]

// Verbatim from prod transcripts that must NEVER be suppressed. Deleting one of
// these is far worse than letting a hallucination through, so the negative
// cases carry the weight here.
const REAL_SPEECH = [
  'So we can get going and I\'d say the first thing is tell me your name and your role here at Move Better',
  'Hinging is the last part of our movement paradigm There\'s two things we\'re really thinking about here',
  'your shoulder blades here okay So now initiate by dropping into your armpits Good And now pull',
  'high knees and then run And then just run with a little bit more head Season them hips Okay okay Perfect',
  'The fact that this is this soft this is great That means you\'re definitely using your feet and neck flexors',
]

describe('isHallucinatedTranscript', () => {
  describe('suppresses the filler actually seen in prod', () => {
    for (const [text, occurrences] of OBSERVED_IN_PROD) {
      it(`"${text}" (${occurrences} row${occurrences > 1 ? 's' : ''})`, () => {
        expect(isHallucinatedTranscript(text)).toBe(true)
      })
    }
  })

  it('is case- and punctuation-insensitive', () => {
    expect(isHallucinatedTranscript('THANK YOU FOR WATCHING!')).toBe(true)
    expect(isHallucinatedTranscript('  thank you, for watching.  ')).toBe(true)
    expect(isHallucinatedTranscript('Thanks for watching!!!')).toBe(true)
  })

  describe('leaves real speech alone', () => {
    for (const text of REAL_SPEECH) {
      it(`"${text.slice(0, 45)}..."`, () => {
        expect(isHallucinatedTranscript(text)).toBe(false)
      })
    }
  })

  // The whole point of the whole-string rule. A real transcript that merely
  // CONTAINS the phrase is real, and a `contains` match would delete it.
  it('does not suppress real speech that merely ends with the phrase', () => {
    const real = REAL_SPEECH[0] + ' and thank you for watching'
    expect(isHallucinatedTranscript(real)).toBe(false)
  })

  // Short REAL speech that contains the phrase verbatim — the case the length
  // gate cannot save us from, so only the whole-string anchoring can. Swap the
  // anchors for a `contains` match and this is the test that goes red.
  it('does not suppress SHORT real speech containing the phrase', () => {
    expect(isHallucinatedTranscript('Nice thank you for watching your knee there')).toBe(false)
    expect(isHallucinatedTranscript('Okay subscribe to that feeling in your hips')).toBe(false)
  })

  it('does not suppress a long transcript, even if it is otherwise filler-like', () => {
    const long = Array.from({ length: 20 }, () => 'thanks').join(' ')
    expect(isHallucinatedTranscript(long)).toBe(false)
  })

  it('treats empty/blank/nullish as not-hallucinated (nothing to suppress)', () => {
    expect(isHallucinatedTranscript('')).toBe(false)
    expect(isHallucinatedTranscript('   ')).toBe(false)
    expect(isHallucinatedTranscript(null)).toBe(false)
    expect(isHallucinatedTranscript(undefined)).toBe(false)
  })

  it('catches the other stock Whisper artefacts', () => {
    expect(isHallucinatedTranscript('Subtitles by the Amara.org community')).toBe(true)
    expect(isHallucinatedTranscript('Please subscribe')).toBe(true)
    expect(isHallucinatedTranscript('Like and subscribe')).toBe(true)
    expect(isHallucinatedTranscript('You')).toBe(true)
  })

  // Non-vacuity: if a future edit breaks the normaliser so nothing ever matches,
  // the positive cases above would still pass one-by-one but this pins that the
  // set as a whole is non-empty and the negatives are genuinely negative.
  it('separates the two sets cleanly (guard is not vacuous)', () => {
    const positives = OBSERVED_IN_PROD.map(([t]) => t).filter(isHallucinatedTranscript)
    const negatives = REAL_SPEECH.filter((t) => !isHallucinatedTranscript(t))
    expect(positives).toHaveLength(OBSERVED_IN_PROD.length)
    expect(negatives).toHaveLength(REAL_SPEECH.length)
  })
})
