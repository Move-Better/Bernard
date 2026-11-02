import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveReceiverTopic } from '../../api/_lib/receiverTopic.js'

// The movebetter workspace's publish_topics as read from prod 2026-11-02, which
// mirrors movebetter.co's z.enum (migration 070).
const MOVEBETTER = [
  'breathing', 'bracing', 'hinging', 'assessment', 'pain-science', 'chronic-pain',
  'low-back-pain', 'neck-pain', 'knee-pain', 'postpartum', 'injury-recovery',
  'surgery-alternatives', 'recovery', 'movement-mechanics', 'strength-training',
  'running', 'nutrition', 'mindset', 'healthcare-system', 'general',
]

const topicOf = (raw) => {
  const r = resolveReceiverTopic(raw, MOVEBETTER)
  return r.status === 'mapped' ? r.topic : r.status
}

describe('resolveReceiverTopic: the two posts that shipped unmapped', () => {
  it('knee pain differential diagnostics -> knee-pain', () => {
    // Arrived as "knee-pain-differential-diagnostics" (2026-09-06 / 08-07 topic).
    expect(topicOf('knee-pain-differential-diagnostics')).toBe('knee-pain')
    expect(topicOf('Knee Pain Differential Diagnostics')).toBe('knee-pain')
  })

  it('when should I stop training if I am injured -> injury-recovery', () => {
    expect(topicOf('when-should-i-stop-training-if-i-am-injured')).toBe('injury-recovery')
    expect(topicOf('When should I stop training if I am injured')).toBe('injury-recovery')
  })
})

describe('resolveReceiverTopic: matching rules', () => {
  it('exact enum values pass through', () => {
    expect(topicOf('running')).toBe('running')
    expect(topicOf('Low back pain')).toBe('low-back-pain')
  })

  it('whole-slug aliases still map', () => {
    expect(topicOf('Knee Pain with Running')).toBe('knee-pain')
    expect(topicOf('rehab')).toBe('injury-recovery')
  })

  it('an alias whose target is not in the workspace list does not apply', () => {
    const r = resolveReceiverTopic('rehab', ['breathing', 'general'])
    expect(r.status).toBe('unmapped')
  })

  it('"training" inside a sentence is not strength-training', () => {
    expect(topicOf('when-to-push-during-training')).toBe('unmapped')
  })

  it('keywords pointing at two different slugs are ambiguous, not guessed', () => {
    // matches the keyword 'injured' (injury-recovery) but the phrase 'neck-pain' wins first
    expect(topicOf('neck-pain-when-injured')).toBe('neck-pain')
    // two phrases of equal length
    expect(topicOf('knee-pain-and-neck-pain')).toBe('unmapped')
  })

  it('a longer enum slug beats a shorter one it contains', () => {
    const r = resolveReceiverTopic('chronic-low-back-pain-guide', ['chronic-pain', 'low-back-pain', 'general'])
    expect(r).toMatchObject({ status: 'mapped', topic: 'low-back-pain' })
  })

  it('general is never claimed by a phrase', () => {
    expect(topicOf('general-health-tips')).toBe('unmapped')
  })

  it('unknown freeform topics are UNMAPPED and carry the allowed list (loud, not silent)', () => {
    const r = resolveReceiverTopic('Plantar fasciitis', MOVEBETTER)
    expect(r.status).toBe('unmapped')
    expect(r.slug).toBe('plantar-fasciitis')
    expect(r.allowed).toEqual(MOVEBETTER)
  })

  it('a workspace with no publish_topics, or a topic-less piece, is passthrough', () => {
    expect(resolveReceiverTopic('Sciatica', []).status).toBe('passthrough')
    expect(resolveReceiverTopic('Sciatica', undefined).status).toBe('passthrough')
    expect(resolveReceiverTopic('', MOVEBETTER).status).toBe('passthrough')
    expect(resolveReceiverTopic(null, MOVEBETTER).status).toBe('passthrough')
  })
})

describe('publish/website.js wiring', () => {
  const src = readFileSync(new URL('../../api/publish/website.js', import.meta.url), 'utf8')

  it('resolves against the workspace publish_topics, never a slug-keyed table', () => {
    // Root cause of the 6-month recurrence: rules keyed on 'movebetter-people',
    // a slug that no longer exists, so no normalization ever ran.
    expect(src).toContain('resolveReceiverTopic(payload.topic, publishTopics)')
    expect(src).toContain('scope.workspace.publish_topics')
    expect(src).not.toMatch(/RECEIVER_TOPIC_RULES|movebetter-people/)
  })

  it('classifies unmapped topics instead of rejecting or forwarding them raw', () => {
    expect(src).toContain("topicMap.status === 'unmapped'")
    expect(src).toContain('await classifyTopic(')
    expect(src).toContain('normalizedTopic = c.topic')
    expect(src).not.toContain('topic_unmapped')
  })

  it('classifies before dispatching and stamps the choice only after a successful publish', () => {
    const classify = src.indexOf('await classifyTopic(')
    const dispatch = src.indexOf('upstream = await fetch(url')
    const stamp = src.indexOf('await recordTopicChoice(payload, topicChoice, workspaceId)')
    const success = src.indexOf('if (upstream.status === 200 && data.success)')
    expect(classify).toBeGreaterThan(-1)
    expect(classify).toBeLessThan(dispatch)
    expect(stamp).toBeGreaterThan(success)
  })

  it('stamp is scoped to the workspace and writes publish_topic', () => {
    expect(src).toMatch(/content_items\?id=eq\.[^`]*&workspace_id=eq\./)
    expect(src).toContain('publish_topic:')
  })
})
