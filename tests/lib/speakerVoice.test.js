import { describe, it, expect } from 'vitest'
import {
  classifySpeakerVoice,
  isClinicianVoice,
  SPEAKER_VOICES,
  SPEAKER_VOICE_INSTRUCTIONS,
} from '../../api/_lib/speakerVoice.js'

describe('classifySpeakerVoice — no-model paths', () => {
  it('returns unknown at zero confidence for too-little transcript, without a model call', async () => {
    // No gateway key in the test env: if this tried the model it would throw or
    // hang. Short-circuiting before the call is the point.
    const out = await classifySpeakerVoice({ transcript: 'Yeah.' })
    expect(out.voice).toBe(SPEAKER_VOICES.UNKNOWN)
    expect(out.confidence).toBe(0)
  })

  it('treats empty / missing transcript as unknown rather than guessing', async () => {
    for (const t of ['', '   ', null, undefined]) {
      const out = await classifySpeakerVoice({ transcript: t })
      expect(out.voice).toBe(SPEAKER_VOICES.UNKNOWN)
    }
  })
})

describe('isClinicianVoice', () => {
  const seg = (voice, confidence) => ({ speaker_voice: voice, speaker_voice_confidence: confidence })

  it('accepts a confident clinician segment', () => {
    expect(isClinicianVoice(seg('clinician', 0.9))).toBe(true)
  })

  it('rejects patient, mixed and unknown outright', () => {
    expect(isClinicianVoice(seg('patient', 0.99))).toBe(false)
    expect(isClinicianVoice(seg('mixed', 0.99))).toBe(false)
    expect(isClinicianVoice(seg('unknown', 0.99))).toBe(false)
  })

  it('rejects a low-confidence clinician call — "probably" is not an answer for a gate', () => {
    expect(isClinicianVoice(seg('clinician', 0.4))).toBe(false)
  })

  it('rejects an unclassified (NULL) segment rather than defaulting it in', () => {
    // NULL means never looked at. The dangerous bug would be treating the
    // absence of a label as clinician — that is exactly how the old
    // speaker_role column let patient testimonials through.
    expect(isClinicianVoice(seg(null, null))).toBe(false)
    expect(isClinicianVoice({})).toBe(false)
    expect(isClinicianVoice(null)).toBe(false)
  })

  it('honours a caller-supplied confidence floor', () => {
    expect(isClinicianVoice(seg('clinician', 0.7), 0.8)).toBe(false)
    expect(isClinicianVoice(seg('clinician', 0.9), 0.8)).toBe(true)
  })
})

describe('SPEAKER_VOICE_INSTRUCTIONS', () => {
  it('teaches the failure mode that motivated the classifier', () => {
    // The whole reason this exists: a patient narrating their own recovery in a
    // clinic was being labelled clinician. If someone rewrites the prompt and
    // drops this, the classifier regresses to the bug we started with.
    expect(SPEAKER_VOICE_INSTRUCTIONS).toMatch(/THEIR OWN body, symptoms, or treatment/)
    expect(SPEAKER_VOICE_INSTRUCTIONS).toMatch(/Talking ABOUT patients is still clinician voice/)
  })
})
