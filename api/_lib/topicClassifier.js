// Picks one of a workspace's fixed publish topics for a post whose freeform
// topic the rule matcher (receiverTopic.js) could not map.
//
// Contract: NEVER throws and NEVER blocks a publish. Whatever goes wrong, the
// caller gets a topic that is in the allowed list plus an honest `via`, so a
// weak guess is visible to the topic-review audit instead of hidden.
//
//   via 'classifier'  model picked a topic with confidence >= MIN_CONFIDENCE
//   via 'fallback'    model unsure, errored, or answered off-list: 'general'
//                     (or the first allowed topic when there is no 'general')

import { generateText } from 'ai'

export const MIN_CONFIDENCE = 0.6
const FALLBACK = 'general'

function pickFallback(allowed) {
  return allowed.includes(FALLBACK) ? FALLBACK : allowed[0]
}

// The model is told to answer JSON; tolerate prose around it.
export function parseClassification(text) {
  const m = String(text || '').match(/\{[\s\S]*?\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0])
    const confidence = Number(o.confidence)
    return {
      topic: typeof o.topic === 'string' ? o.topic.trim().toLowerCase() : '',
      confidence: Number.isFinite(confidence) ? confidence : 0,
    }
  } catch {
    return null
  }
}

/**
 * @param {{rawTopic:string,title?:string,description?:string,allowed:string[]}} p
 * @param {{generate?:Function}} [deps]  injectable for tests
 * @returns {Promise<{topic:string,via:'classifier'|'fallback',confidence:number}>}
 */
export async function classifyTopic({ rawTopic, title = '', description = '', allowed }, deps = {}) {
  const generate = deps.generate || generateText
  const fallback = { topic: pickFallback(allowed), via: 'fallback', confidence: 0 }
  try {
    const { text } = await generate({
      model: 'anthropic/claude-haiku-4-5',
      instructions: [
        'You file a clinic blog post under exactly ONE topic from a fixed list.',
        `Allowed topics: ${allowed.join(', ')}`,
        'Pick the single best fit for what the post is mainly about. Use "general" only when nothing fits.',
        'Reply with JSON only: {"topic": "<one allowed topic>", "confidence": <0 to 1>}.',
        'Confidence is how sure you are that a clinician would file it there.',
      ].join('\n'),
      messages: [{
        role: 'user',
        content: [
          `Story topic: ${String(rawTopic).slice(0, 200)}`,
          title ? `Title: ${String(title).slice(0, 200)}` : '',
          description ? `Description: ${String(description).slice(0, 400)}` : '',
        ].filter(Boolean).join('\n'),
      }],
      maxOutputTokens: 60,
    })
    const c = parseClassification(text)
    if (!c || !allowed.includes(c.topic)) return fallback
    if (c.confidence < MIN_CONFIDENCE) return { topic: pickFallback(allowed), via: 'fallback', confidence: c.confidence }
    return { topic: c.topic, via: 'classifier', confidence: c.confidence }
  } catch (e) {
    console.warn('[topicClassifier] failed, using fallback:', e?.message)
    return fallback
  }
}
