import { describe, it, expect } from 'vitest'
import {
  isShallowAnswer,
  extractContrastName, stripContrastToken, hasContrastSignal,
  extractAgreementName, stripAgreementToken, hasAgreementSignal,
  stripGapToken, hasGapSignal,
  STOP_PHRASES, detectAndStripStopPhrase,
  isTransientStreamError,
  deriveVoicePct,
} from '@/lib/interviewSignals.js'

// These rules decide whether an interview turn counts as shallow, whether a
// contrast/agreement/gap signal fired, and when the session ends. They lived
// inside InterviewSession.jsx — a 2,575-line file exporting only its default
// component — so none of them had ever been reachable from a test.

describe('isShallowAnswer', () => {
  // Both sides of the 15-word boundary, with the noun list held constant.
  it('is shallow at 14 words with no concrete noun', () => {
    const fourteen = 'a b c d e f g h i j k l m n'
    expect(fourteen.split(' ')).toHaveLength(14)
    expect(isShallowAnswer(fourteen)).toBe(true)
  })

  it('is NOT shallow at 15 words, even with no concrete noun', () => {
    const fifteen = 'a b c d e f g h i j k l m n o'
    expect(fifteen.split(' ')).toHaveLength(15)
    expect(isShallowAnswer(fifteen)).toBe(false)
  })

  it('is NOT shallow when a concrete noun appears, however short', () => {
    expect(isShallowAnswer('one patient')).toBe(false)
    expect(isShallowAnswer('a runner I saw')).toBe(false)
  })

  it('matches concrete nouns case-insensitively', () => {
    expect(isShallowAnswer('One PATIENT')).toBe(false)
  })

  it('ignores leading/trailing whitespace when counting words', () => {
    expect(isShallowAnswer('   a b c   ')).toBe(true)
  })
})

describe('contrast / agreement / gap tokens', () => {
  it('extracts the embedded name from the modern token form', () => {
    expect(extractContrastName('[CONTRAST][Sarah] she disagrees')).toBe('Sarah')
    expect(extractAgreementName('[AGREEMENT][Sarah] she agrees')).toBe('Sarah')
  })

  it('returns null for the legacy bare token (no name to extract)', () => {
    expect(extractContrastName('[CONTRAST] she disagrees')).toBeNull()
    expect(extractAgreementName('[AGREEMENT] she agrees')).toBeNull()
  })

  it('returns null when the token is absent entirely', () => {
    expect(extractContrastName('no token here')).toBeNull()
    expect(extractAgreementName('no token here')).toBeNull()
  })

  it('strips BOTH the bare and named token forms, and trims', () => {
    expect(stripContrastToken('[CONTRAST][Sarah] body')).toBe('body')
    expect(stripContrastToken('[CONTRAST] body')).toBe('body')
    expect(stripAgreementToken('[AGREEMENT][Sarah] body')).toBe('body')
    expect(stripAgreementToken('[AGREEMENT] body')).toBe('body')
    expect(stripGapToken('[GAP] body')).toBe('body')
  })

  it('strips every occurrence, not just the first', () => {
    expect(stripContrastToken('[CONTRAST] a [CONTRAST] b')).toBe('a  b')
    expect(stripGapToken('[GAP] a [GAP] b')).toBe('a  b')
  })

  it('detects presence independently of the name suffix', () => {
    expect(hasContrastSignal('[CONTRAST][Sarah] x')).toBe(true)
    expect(hasContrastSignal('[CONTRAST] x')).toBe(true)
    expect(hasContrastSignal('x')).toBe(false)
    expect(hasAgreementSignal('[AGREEMENT] x')).toBe(true)
    expect(hasAgreementSignal('x')).toBe(false)
    expect(hasGapSignal('[GAP] x')).toBe(true)
    expect(hasGapSignal('x')).toBe(false)
  })

  it('does not confuse one token type for another', () => {
    expect(hasContrastSignal('[AGREEMENT] x')).toBe(false)
    expect(hasAgreementSignal('[CONTRAST] x')).toBe(false)
    expect(hasGapSignal('[CONTRAST] x')).toBe(false)
  })
})

describe('detectAndStripStopPhrase', () => {
  it('returns null when the utterance does not end in a stop phrase', () => {
    expect(detectAndStripStopPhrase('so that is how I treat it')).toBeNull()
  })

  it('returns the remaining text with the phrase removed', () => {
    expect(detectAndStripStopPhrase('I warm them up first, that\'s all')).toBe("I warm them up first,")
  })

  it('returns empty string (not null) when the phrase IS the whole utterance', () => {
    // '' and null are different signals downstream: '' = stop with nothing to
    // send, null = no stop phrase at all.
    expect(detectAndStripStopPhrase("that's it")).toBe('')
  })

  it('matches case-insensitively and tolerates trailing whitespace', () => {
    expect(detectAndStripStopPhrase("Some content. SUBMIT   ")).toBe('Some content.')
  })

  it('only matches at the END of the utterance', () => {
    expect(detectAndStripStopPhrase('submit the form and keep going')).toBeNull()
  })

  it('prefers the longest applicable phrase over the "done" suffix', () => {
    // 'i am done' and 'done' both match this input, but they leave different
    // remainders — 'i am done' must win, or the user sees a stray "I am".
    // This pins the ORDER of STOP_PHRASES, which is otherwise invisible.
    expect(detectAndStripStopPhrase('I am done')).toBe('')
    expect(detectAndStripStopPhrase("I'm done")).toBe('')
  })

  it('still strips a bare "done" when nothing longer applies', () => {
    expect(detectAndStripStopPhrase('Yeah we are done')).toBe('Yeah we are')
  })

  it('STOP_PHRASES are all lowercase (the match normalizes input, not the list)', () => {
    expect(STOP_PHRASES.length).toBeGreaterThan(0)
    for (const p of STOP_PHRASES) expect(p).toBe(p.toLowerCase())
  })
})

describe('isTransientStreamError', () => {
  // NOTE (found by mutation testing): the explicit `401 || 403 || 429` branch is
  // fully SUBSUMED by the generic 4xx branch below it — every one of those codes
  // is also >= 400 && < 500, so deleting the explicit line changes no behaviour
  // and no test can kill that mutant. The line documents intent rather than
  // implementing it. Left as-is here (this PR is a verbatim extraction); flagged
  // so nobody later contorts a test to "cover" it.
  it('does NOT retry auth and rate-limit failures', () => {
    expect(isTransientStreamError({ status: 401 })).toBe(false)
    expect(isTransientStreamError({ status: 403 })).toBe(false)
    expect(isTransientStreamError({ status: 429 })).toBe(false)
  })

  it('does NOT retry any other 4xx', () => {
    expect(isTransientStreamError({ status: 400 })).toBe(false)
    expect(isTransientStreamError({ status: 404 })).toBe(false)
    expect(isTransientStreamError({ status: 499 })).toBe(false)
  })

  it('retries 5xx, including 529 gateway-overloaded', () => {
    expect(isTransientStreamError({ status: 500 })).toBe(true)
    expect(isTransientStreamError({ status: 529 })).toBe(true)
  })

  it('retries when there is no status at all (network abort)', () => {
    expect(isTransientStreamError({})).toBe(true)
    expect(isTransientStreamError(new Error('A network error occurred'))).toBe(true)
    expect(isTransientStreamError(null)).toBe(true)
    expect(isTransientStreamError(undefined)).toBe(true)
  })

  it('retries a 3xx (below the 4xx floor)', () => {
    expect(isTransientStreamError({ status: 302 })).toBe(true)
  })
})

describe('deriveVoicePct', () => {
  it('returns null when there is nothing to derive from', () => {
    expect(deriveVoicePct(null)).toBeNull()
    expect(deriveVoicePct('')).toBeNull()
    expect(deriveVoicePct('{"blocks":[]}')).toBeNull()
    expect(deriveVoicePct('{"no_blocks_key":1}')).toBeNull()
  })

  it('returns null rather than throwing on unparseable JSON', () => {
    expect(deriveVoicePct('{not json')).toBeNull()
  })

  it('counts verbatim AND close_paraphrase as the clinician\'s own voice', () => {
    // 2 of 3 -> 67. Counting verbatim alone would give 33, so this case
    // distinguishes the two rules rather than passing under either.
    const json = JSON.stringify({ blocks: [
      { source_type: 'verbatim' },
      { source_type: 'close_paraphrase' },
      { source_type: 'synthesized' },
    ] })
    expect(deriveVoicePct(json)).toBe(67)
  })

  it('returns 0 when no block came from the clinician', () => {
    expect(deriveVoicePct(JSON.stringify({ blocks: [{ source_type: 'synthesized' }] }))).toBe(0)
  })

  it('returns 100 when every block did', () => {
    expect(deriveVoicePct(JSON.stringify({ blocks: [{ source_type: 'verbatim' }] }))).toBe(100)
  })

  it('rounds to the nearest whole percent', () => {
    const blocks = [{ source_type: 'verbatim' }, ...Array(2).fill({ source_type: 'other' })]
    expect(deriveVoicePct(JSON.stringify({ blocks }))).toBe(33)
  })
})
