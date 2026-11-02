import { describe, it, expect } from 'vitest'
import { classifyTopic, parseClassification, MIN_CONFIDENCE } from '../../api/_lib/topicClassifier.js'

const ALLOWED = ['neck-pain', 'knee-pain', 'recovery', 'general']
const reply = (text) => async () => ({ text })
const run = (generate, rawTopic = 'Text neck & posture') =>
  classifyTopic({ rawTopic, allowed: ALLOWED }, { generate })

describe('classifyTopic', () => {
  it('takes a confident in-list answer', async () => {
    const r = await run(reply('{"topic":"neck-pain","confidence":0.9}'))
    expect(r).toEqual({ topic: 'neck-pain', via: 'classifier', confidence: 0.9 })
  })

  it('tolerates prose around the JSON', async () => {
    const r = await run(reply('Sure! {"topic": "Neck-Pain", "confidence": 0.8} done'))
    expect(r.topic).toBe('neck-pain')
  })

  it('confidence just under the bar falls back to general and says so', async () => {
    const r = await run(reply(`{"topic":"neck-pain","confidence":${MIN_CONFIDENCE - 0.01}}`))
    expect(r).toMatchObject({ topic: 'general', via: 'fallback' })
  })

  it('confidence exactly at the bar is accepted', async () => {
    const r = await run(reply(`{"topic":"neck-pain","confidence":${MIN_CONFIDENCE}}`))
    expect(r.via).toBe('classifier')
  })

  it('an off-list answer is never returned, even when confident', async () => {
    const r = await run(reply('{"topic":"plantar-fasciitis","confidence":0.99}'))
    expect(r).toMatchObject({ topic: 'general', via: 'fallback' })
  })

  it('unparseable output falls back', async () => {
    expect((await run(reply('no idea'))).via).toBe('fallback')
  })

  it('a thrown model error never propagates', async () => {
    const r = await run(async () => { throw new Error('gateway down') })
    expect(r).toMatchObject({ topic: 'general', via: 'fallback' })
  })

  it('without a general topic, falls back to a topic from the list', async () => {
    const r = await classifyTopic({ rawTopic: 'x', allowed: ['a', 'b'] }, { generate: reply('{}') })
    expect(['a', 'b']).toContain(r.topic)
  })

  it('parseClassification rejects non-JSON', () => {
    expect(parseClassification('nope')).toBeNull()
    expect(parseClassification('{bad')).toBeNull()
  })
})
