// api/_lib/scoreMomentsVisual.js
//
// F13 — Video-native moment understanding. The transcript scorer (scoreMoments.js)
// rates a moment on what was SAID; this rates it on what the camera SEES —
// energy, eye contact, gesture, framing, and b-roll-worthiness — then blends
// the two into the rank the Moment feed sorts on.
//
// Why this matters: the best on-camera moments aren't always the best sentences.
// A plain line delivered with great energy + a perfect gesture films beautifully;
// a beautiful line delivered looking down at notes is unusable. Transcript-only
// ranking can't tell those apart. This closes the demotion case fully (kill the
// unwatchable-delivery clips) and lifts well-filmed moments.
//
// v1 re-RANKS the windows the transcript detector already proposed — it does not
// re-FIND them (letting the video nominate its own windows is a noted fast-follow).
//
// Never throws per segment: a model hiccup on one clip leaves that segment
// visual-unscored (visual_score=null) and it simply ranks on its transcript
// score, so the feed always renders.

import { z } from 'zod'
import { analyzeVideoWindow, DEFAULT_VIDEO_MODEL } from './analyzeVideoWindow.js'

export { DEFAULT_VIDEO_MODEL }

// Blend weights + soft-veto floor (Q sign-off 2026-07-10). Kept here as named
// constants so they're tunable in one place without a schema/backfill change —
// the raw transcript + visual scores are stored separately, the blend is computed.
export const BLEND = {
  transcriptWeight: 0.6,
  visualWeight: 0.4,
  // Below this visual score, the clip is genuinely unusable on camera (looking
  // away, no eye contact, unusable framing) — cap the FINAL score hard so a
  // strong line delivered badly still sinks, instead of averaging to mid-feed.
  vetoFloor: 25,
  vetoCap: 35,
}

const visualSchema = z.object({
  // Each dimension 0..100. Prompt defines them; the model returns all five.
  energy:            z.number().int().min(0).max(100),
  eye_contact:       z.number().int().min(0).max(100),
  gesture:           z.number().int().min(0).max(100),
  framing:           z.number().int().min(0).max(100),
  broll_worthiness:  z.number().int().min(0).max(100),
  // The model's own overall read of "how good is this as a vertical reel clip",
  // holistic rather than a mechanical average of the five.
  visual_score:      z.number().int().min(0).max(100),
  note:              z.string().max(200).default(''),
})

function buildInstructions(ws) {
  const who = ws?.clinic_context ? String(ws.clinic_context).slice(0, 240) : 'a clinical practice'
  return [
    `You are a short-form video editor judging on-camera moments from real recorded sessions at ${ws?.display_name || 'a clinical practice'}.`,
    `Practice context: ${who}.`,
    '',
    'You are shown several stills sampled in order across one short clip. Judge it ONLY on what the camera shows — not on how good the words are (a separate pass scores the transcript). You are answering: "would this land as a vertical social Reel?"',
    '',
    'Score each dimension 0..100:',
    '- energy: presence and expressiveness across the frames — animated face/posture/gesture vs flat, slack, or disengaged.',
    '- eye_contact: looking INTO the camera/at the listener vs reading notes or looking away/down. Reading = low.',
    '- gesture: purposeful hands/demonstration that reinforces the point vs stiff or fidgety.',
    '- framing: subject well-composed for a 9:16 vertical crop — centered, head not cut off, stable, in focus. A wide/off-center/tilted/shaky frame is low.',
    '- broll_worthiness: is something visually happening worth watching (a demo, movement, a treatment) vs a static talking head.',
    '',
    'Then give an overall visual_score 0..100 for how well this works as a Reel clip, holistically — NOT a plain average. A clip where the speaker is looking down at notes the whole time is unusable no matter how energetic the voice; score it low.',
    'Be discriminating — an honest spread is the whole point. Do not cluster at 60-90.',
    'note: ≤ 1 short sentence on the single biggest visual factor. Output JSON only.',
  ].join('\n')
}

/**
 * Combine a transcript score and a visual score into the final feed rank.
 * Soft veto: a visual score below the floor caps the blended result so an
 * unwatchable-delivery clip can't ride a strong line into the top of the feed.
 * Falls back to the transcript score alone when there's no visual score.
 *
 * @param {number|null|undefined} transcriptScore 0..100 (video_segments.score)
 * @param {number|null|undefined} visualScore     0..100 (video_segments.visual_score)
 * @returns {number} 0..100 blended rank
 */
export function blendMomentScore(transcriptScore, visualScore) {
  const t = Number.isFinite(transcriptScore) ? transcriptScore : null
  const v = Number.isFinite(visualScore) ? visualScore : null
  if (v == null) return t == null ? 0 : t          // no visual signal → transcript only
  if (t == null) return v                          // (shouldn't happen; be safe)
  let blended = BLEND.transcriptWeight * t + BLEND.visualWeight * v
  if (v < BLEND.vetoFloor) blended = Math.min(blended, BLEND.vetoCap)
  return Math.round(blended)
}

/**
 * Visually score a batch of proposed segments off ONE source video. Cuts each
 * segment's window to a small proxy and asks the model to judge it. Runs the
 * clips concurrently but bounded, so a source with 8 segments doesn't fan out
 * 8 heavy model calls at once.
 *
 * Returns an array aligned to `segments`: each entry is
 *   { visualScore:number, breakdown:object, costUsd:number|null } | null
 * (null = this clip failed to score; caller leaves visual_score null for it).
 *
 * @param {Array<{start_sec:number, end_sec:number}>} segments
 * @param {object} workspace
 * @param {string} sourceBlobUrl  the source video's blob_url
 * @param {object} [opts]
 * @param {number} [opts.concurrency=3]
 * @param {string} [opts.model]
 * @param {number} [opts.deadlineMs]  wall-clock epoch ms; stop starting new
 *   windows past it (leaves the rest visual-unscored). Bounds the shared 300s
 *   detection budget so visual scoring can't get killed mid-write.
 */
export async function visualScoreSegments(segments, workspace, sourceBlobUrl, opts = {}) {
  if (!Array.isArray(segments) || !segments.length) return []
  if (!sourceBlobUrl) return segments.map(() => null)
  const concurrency = Math.max(1, opts.concurrency || 3)
  const model = opts.model || DEFAULT_VIDEO_MODEL
  const deadlineMs = Number.isFinite(opts.deadlineMs) ? opts.deadlineMs : Infinity
  const instructions = buildInstructions(workspace)

  const out = new Array(segments.length).fill(null)
  let cursor = 0

  // Each window's frames are sampled straight from the source URL via ffmpeg
  // HTTP range reads (analyzeVideoWindow) — the 3GB 4K source is never
  // downloaded whole.
  async function worker() {
    while (cursor < segments.length) {
      if (Date.now() > deadlineMs) break   // out of budget — leave the rest null
      const i = cursor++
      const s = segments[i]
      const start = Number(s.start_sec)
      const end = Number(s.end_sec)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
      try {
        const { object, costUsd } = await analyzeVideoWindow({
          source: sourceBlobUrl,
          startSec: start,
          endSec: end,
          instructions,
          schema: visualSchema,
          prompt: 'These stills are sampled in order across one short clip. Score its on-camera quality as specified.',
          model,
        })
        out[i] = {
          visualScore: Math.max(0, Math.min(100, Math.round(object.visual_score))),
          breakdown: {
            energy: object.energy,
            eye_contact: object.eye_contact,
            gesture: object.gesture,
            framing: object.framing,
            broll_worthiness: object.broll_worthiness,
            note: (object.note || '').slice(0, 200),
          },
          costUsd: costUsd ?? null,
        }
      } catch (e) {
        console.error(`[scoreMomentsVisual] window ${i} (${start}-${end}s) failed:`, e?.message || e)
        out[i] = null
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, segments.length) }, worker))
  return out
}
