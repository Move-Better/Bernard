// api/_lib/scoreMoments.js
//
// Moment Miner ranking. Scores proposed video_segments for post-worthiness
// (0..100) and classifies each by moment type, in ONE batched LLM call. Used by:
//   - segmentDetect.js  — enrich new proposals at detection time
//   - /api/editorial/moments — lazily backfill any proposed segment missing a
//     score on first feed load (so existing segments self-heal)
//
// Pure-ish: one generateObject call, no I/O. Never throws on a bad model
// response — returns a neutral fallback so the feed always renders.

import { generateObject } from 'ai'
import { z } from 'zod'

const MODEL = 'anthropic/claude-sonnet-4-6'

// The moment taxonomy. The feed chips + card labels map off these.
export const MOMENT_TYPES = [
  'coaching_cue',         // a teachable cue / instruction
  'patient_breakthrough', // a real patient reaction / "aha" / honest moment
  'hook',                 // a short, scroll-stopping standalone line
  'credibility',          // explains a technique/approach that builds trust
  'insight',              // a counterintuitive or reframing idea
  'technique',            // a concrete how-to / demonstration
  'story',                // a narrative / human moment
]

export const MOMENT_TYPE_LABELS = {
  coaching_cue: 'Coaching cue',
  patient_breakthrough: 'Patient breakthrough',
  hook: 'Hook',
  credibility: 'Credibility',
  insight: 'Insight',
  technique: 'Technique',
  story: 'Story',
}

const resultSchema = z.object({
  results: z.array(z.object({
    index: z.number().int().min(0),
    score: z.number().int().min(0).max(100),
    moment_type: z.enum(MOMENT_TYPES),
  })).default([]),
})

function buildSystem(ws) {
  const who = ws?.clinic_context ? ws.clinic_context.slice(0, 240) : 'a clinical practice'
  return [
    `You rank candidate short-video moments mined from real recorded sessions at ${ws?.display_name || 'a clinical practice'}.`,
    `Practice context: ${who}.`,
    '',
    'For EACH candidate, output a post-worthiness score (0..100) and a moment_type.',
    'Score high (80-100) for: a vivid, quotable line; a real patient breakthrough or honest reaction; a coaching cue that teaches the "why"; a counterintuitive insight; a strong standalone hook.',
    'Score low (0-40) for: filler, mid-thought fragments, logistics, rep-counting, anything that needs surrounding context to land, or a line that would read flat as a Reel.',
    'Be discriminating — a real ranking is only useful if the spread is honest. Do not cluster everything at 70-90.',
    '',
    'moment_type — pick the single best fit:',
    '- coaching_cue: a teachable cue or instruction',
    '- patient_breakthrough: a real patient reaction, "aha", or honest moment',
    '- hook: a short, scroll-stopping standalone line',
    '- credibility: explains a technique/approach in a way that builds trust',
    '- insight: a counterintuitive or reframing idea',
    '- technique: a concrete how-to or demonstration',
    '- story: a narrative or human moment',
    '',
    'Return one result per candidate, echoing its index. Output JSON only.',
  ].join('\n')
}

function buildUser(segments) {
  const lines = ['Candidates:', '']
  segments.forEach((s, i) => {
    lines.push(`#${i}`)
    if (s.hook) lines.push(`hook: ${s.hook}`)
    if (s.why_it_stands_alone) lines.push(`why: ${s.why_it_stands_alone}`)
    if (s.transcript_excerpt) lines.push(`said: ${String(s.transcript_excerpt).slice(0, 500)}`)
    lines.push('')
  })
  return lines.join('\n')
}

/**
 * Score + classify a batch of proposed segments.
 * @param {Array<{hook?:string, why_it_stands_alone?:string, transcript_excerpt?:string}>} segments
 * @param {object} workspace
 * @returns {Promise<Array<{score:number, moment_type:string}>>} aligned to input order
 */
export async function scoreSegments(segments, workspace) {
  if (!Array.isArray(segments) || segments.length === 0) return []
  // Neutral fallback so a model hiccup never blocks the feed.
  const fallback = segments.map(() => ({ score: 55, moment_type: 'insight' }))
  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: resultSchema,
      system: buildSystem(workspace),
      messages: [{ role: 'user', content: buildUser(segments) }],
      temperature: 0.2,
      maxOutputTokens: 1500,
    })
    const out = fallback.map((f) => ({ ...f }))
    for (const r of object.results || []) {
      if (r.index >= 0 && r.index < out.length) {
        out[r.index] = {
          score: Math.max(0, Math.min(100, Math.round(r.score))),
          moment_type: MOMENT_TYPES.includes(r.moment_type) ? r.moment_type : 'insight',
        }
      }
    }
    return out
  } catch (e) {
    console.error('[scoreMoments] scoring failed, using neutral fallback:', e?.message || e)
    return fallback
  }
}
