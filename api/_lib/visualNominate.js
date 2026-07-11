// api/_lib/visualNominate.js
//
// F13 fast-follow — let the VIDEO nominate its own moments. Today's detector
// reads the transcript and re-ranks its picks visually (scoreMomentsVisual.js);
// this scans the FRAMES of the whole source and proposes windows the transcript
// walked past — a strong demonstration or gesture on a plain or near-silent
// line, which a words-only reader never surfaces.
//
// Bounded + additive by design: samples a fixed frame budget across the source
// (so a 3hr seminar costs the same scan as a 10-min clip), proposes at most a
// few NEW windows not already covered by the transcript picks, drafts an
// on-voice hook from whatever speech is there + the visual reason, and tags each
// nomination_source='visual' — a confidence marker so downstream auto-publish
// can route these (thinner-line) picks to review instead of auto-shipping.
//
// Flag-gated (segmentDetect decides who runs it). Never throws: on any failure
// it returns [] so detection still completes with the transcript picks.

import { generateObject } from 'ai'
import { z } from 'zod'
import { sampleFramesAcross, DEFAULT_VIDEO_MODEL } from './analyzeVideoWindow.js'

const HOOK_MODEL = 'anthropic/claude-sonnet-4-6'

const MIN_CLIP_SECONDS = 8
const MAX_CLIP_SECONDS = 60
// Fixed frame budget for the whole-source scan — bounds cost + wall time
// regardless of source length (concurrent seeks keep 24 frames to ~20s).
const MAX_SCAN_FRAMES = 24
// Never propose more than this many new visual windows — clinical footage is
// mostly talking-head, so pure-visual gold is rare; a small cap avoids flooding
// the feed with silent b-roll.
const DEFAULT_MAX_NEW = 3
// Drop a visual pick that overlaps an existing transcript window by more than
// this fraction of the shorter window — that moment is already represented.
const OVERLAP_DROP = 0.4

const nominateSchema = z.object({
  windows: z.array(z.object({
    start_sec: z.number().min(0),
    end_sec: z.number().min(1),
    visual_reason: z.string().min(3).max(200),
  })).max(6).default([]),
})

const hookSchema = z.object({
  hooks: z.array(z.object({
    index: z.number().int().min(0),
    hook: z.string().min(3).max(120),
    why_it_stands_alone: z.string().min(3).max(300),
  })).default([]),
})

function mmss(sec) {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Fraction of the shorter window that two [s,e] ranges overlap (0..1). */
function overlapFraction(a, b) {
  const lo = Math.max(a.start, b.start)
  const hi = Math.min(a.end, b.end)
  const ov = Math.max(0, hi - lo)
  const shorter = Math.min(a.end - a.start, b.end - b.start)
  return shorter > 0 ? ov / shorter : 0
}

/** Verbatim speech inside a window, from the whole-source cue list. */
function excerptFor(cues, s, e) {
  return cues
    .filter((c) => c.start < e && c.end > s)
    .map((c) => c.text)
    .join(' ')
    .trim()
    .slice(0, 800)
}

function buildNominateInstructions(ws, covered) {
  return [
    `You are a short-form video editor reviewing raw footage from real recorded sessions at ${ws?.display_name || 'a clinical practice'}.`,
    ws?.clinic_context ? `Practice context: ${String(ws.clinic_context).slice(0, 240)}.` : '',
    '',
    'You are shown stills sampled in order across ONE source video, each labelled with its timestamp. A separate pass already picked the strongest moments FROM THE TRANSCRIPT. Your job is different: find up to a few STANDALONE moments the transcript reader would MISS — where the CAMERA carries it. A clear demonstration, a striking movement, an expressive gesture, genuine energy, or genuinely b-roll-worthy visual action.',
    '',
    covered.length
      ? `Already covered by the transcript (do NOT re-propose these — find DIFFERENT moments): ${covered.map((w) => `${mmss(w.start)}–${mmss(w.end)}`).join(', ')}.`
      : 'The transcript picked nothing usable, so everything is fair game.',
    '',
    'Rules:',
    `- Propose at most ${DEFAULT_MAX_NEW} windows. Fewer is better; propose NONE if nothing visually stands out. This is talking-head clinical footage — pure-visual gold is rare, so be very selective.`,
    `- Each window ${MIN_CLIP_SECONDS}–${MAX_CLIP_SECONDS}s, aligned to the timestamps you see.`,
    '- Judge on what the CAMERA shows, not on any words — a well-framed, well-lit demonstration with clear movement is the target.',
    '- Return start_sec / end_sec (seconds) and a one-line visual_reason describing what the camera shows that makes it worth a clip.',
    'Output JSON only.',
  ].filter(Boolean).join('\n')
}

/** Interleave labelled timestamps with the sampled frames for the model. */
function buildNominateContent(frames, durationSec) {
  const content = [{ type: 'text', text: `Source duration: ${mmss(durationSec)}. Frames sampled in order:` }]
  for (const f of frames) {
    content.push({ type: 'text', text: `Frame @ ${mmss(f.t)} (${Math.round(f.t)}s):` })
    content.push({ type: 'file', data: f.jpeg, mediaType: 'image/jpeg' })
  }
  return content
}

function buildHookInstructions(ws) {
  return [
    `You are a senior social media editor for ${ws?.app_name || ws?.display_name || 'a clinical practice'}.`,
    ws?.brand_voice ? `Brand voice:\n${String(ws.brand_voice)}` : '',
    '',
    'Each item is a short clip the CAMERA flagged as visually strong (a demonstration or movement). You are given the visual reason and whatever was said during it (often sparse — that is expected).',
    'For each, write:',
    '- hook: a short, scroll-stopping title in the practice brand voice (≤120 chars). Lead with the visual/action; use the spoken words only if they help.',
    '- why_it_stands_alone: one sentence on why it works as a standalone clip.',
    'Educational framing, never diagnostic guarantees. Echo each item index. Output JSON only.',
  ].filter(Boolean).join('\n')
}

/**
 * Scan the source visually and return NEW proposed windows (already deduped
 * against the transcript picks, with an on-voice hook + overlapping excerpt).
 * Never throws — returns [] on any failure.
 *
 * @param {Object} p
 * @param {string} p.source            source blob URL
 * @param {Object} p.workspace
 * @param {number} p.durationSec       covered source duration
 * @param {Array<{start:number,end:number,text:string}>} p.cues  whole-source transcript cues
 * @param {Array<{start_sec:number,end_sec:number}>} p.transcriptWindows  already-chosen windows
 * @param {number} [p.maxNew]
 * @returns {Promise<Array<{start_sec,end_sec,hook,why_it_stands_alone,transcript_excerpt,visual_reason}>>}
 */
export async function nominateVisualWindows({ source, workspace, durationSec, cues = [], transcriptWindows = [], maxNew = DEFAULT_MAX_NEW }) {
  try {
    if (!source || !(durationSec > 0)) return []
    const covered = transcriptWindows.map((w) => ({ start: Number(w.start_sec), end: Number(w.end_sec) }))

    // 1. Scan frames across the whole source (bounded, concurrent).
    const frameCount = Math.min(MAX_SCAN_FRAMES, Math.max(6, Math.round(durationSec / 8)))
    const frames = await sampleFramesAcross(source, 0, durationSec, frameCount, { concurrency: 4 })
    if (frames.length < 3) return []

    // 2. Ask the video model for windows the transcript missed.
    const { object } = await generateObject({
      model: DEFAULT_VIDEO_MODEL,
      schema: nominateSchema,
      instructions: buildNominateInstructions(workspace, covered),
      messages: [{ role: 'user', content: buildNominateContent(frames, durationSec) }],
      temperature: 0.3,
      abortSignal: AbortSignal.timeout(90_000),
    })

    // 3. Clamp, dedup vs transcript windows + each other, cap.
    const kept = []
    for (const w of (object.windows || [])) {
      let s = Math.max(0, Number(w.start_sec) || 0)
      let e = Math.min(durationSec, Number(w.end_sec) || 0)
      if (e - s > MAX_CLIP_SECONDS) e = s + MAX_CLIP_SECONDS
      if (e - s < MIN_CLIP_SECONDS) continue
      const range = { start: s, end: e }
      if (covered.some((c) => overlapFraction(range, c) > OVERLAP_DROP)) continue
      if (kept.some((k) => overlapFraction(range, { start: k.start_sec, end: k.end_sec }) > OVERLAP_DROP)) continue
      kept.push({ start_sec: Math.round(s * 100) / 100, end_sec: Math.round(e * 100) / 100, visual_reason: String(w.visual_reason || '').trim().slice(0, 200) })
      if (kept.length >= maxNew) break
    }
    if (!kept.length) return []

    // 4. Attach the overlapping speech, then draft on-voice hooks in one call.
    kept.forEach((k) => { k.transcript_excerpt = excerptFor(cues, k.start_sec, k.end_sec) })
    let hooks = []
    try {
      const { object: h } = await generateObject({
        model: HOOK_MODEL,
        schema: hookSchema,
        instructions: buildHookInstructions(workspace),
        messages: [{ role: 'user', content: kept.map((k, i) =>
          `#${i}\nvisual: ${k.visual_reason}\nsaid: ${k.transcript_excerpt || '(little or no speech)'}`).join('\n\n') }],
        temperature: 0.4,
        abortSignal: AbortSignal.timeout(60_000),
      })
      hooks = h.hooks || []
    } catch (e) {
      console.error('[visualNominate] hook drafting failed, using visual_reason as fallback:', e?.message || e)
    }
    const hookByIdx = new Map(hooks.map((x) => [x.index, x]))

    return kept.map((k, i) => {
      const h = hookByIdx.get(i)
      return {
        start_sec: k.start_sec,
        end_sec: k.end_sec,
        hook: (h?.hook || k.visual_reason).slice(0, 120),
        why_it_stands_alone: (h?.why_it_stands_alone || k.visual_reason).slice(0, 300),
        transcript_excerpt: k.transcript_excerpt,
        visual_reason: k.visual_reason,
      }
    })
  } catch (e) {
    console.error('[visualNominate] visual nomination failed (non-fatal):', e?.message || e)
    return []
  }
}
