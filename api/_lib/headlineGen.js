// api/_lib/headlineGen.js
//
// On-screen headline for a reel's hook card — a DIFFERENT piece of copy from
// the post caption, and the distinction is the whole point of this module.
//
// reelFactory used one string for both jobs: generateCaption's 1-2 sentence
// Instagram caption was written into content_items.content AND burned onto the
// frame. A post caption is 150-220 characters; the on-screen band fits ~102 and
// hard-truncates. So every auto-drafted reel shipped a headline cut mid-sentence
// ("…your body is using…") — a fragment that means nothing, sitting in the most
// prominent position on the frame.
//
// A reel headline wants ~6 words. It is a scroll-stopper, not a summary.
//
// GRACEFUL DEGRADE IS THE CONTRACT: this returns null rather than a headline
// that doesn't fit. reelFactory renders no card when it gets null, so the reel
// falls back to a clean captions-only frame. Truncating is never an option —
// that is the bug this module exists to close.

import { generateText } from 'ai'

export const HEADLINE_MAX_WORDS = 8
export const HEADLINE_MAX_CHARS = 52

/** Strip quotes/trailing punctuation a model likes to add around a headline. */
function tidy(s) {
  return String(s || '')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[.…]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function wordCount(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length
}

/**
 * Is this string usable as an on-screen headline?
 * Deliberately strict — a "close enough" headline is what truncation looked
 * like before it truncated.
 */
export function isUsableHeadline(s) {
  const t = tidy(s)
  if (!t) return false
  if (wordCount(t) > HEADLINE_MAX_WORDS) return false
  if (t.length > HEADLINE_MAX_CHARS) return false
  return true
}

/**
 * Generate a ≤8-word on-screen headline from a moment's hook + transcript.
 *
 * @param {Object} p
 * @param {string} p.hook              — the segment's hook (may be long)
 * @param {string} [p.clipTranscript]  — what is actually said in the clip
 * @param {Object} [p.workspace]       — workspace row, for brand voice
 * @returns {Promise<string|null>} a usable headline, or null to render no card
 */
export async function generateHeadline({ hook, clipTranscript = '', workspace = null }) {
  const source = String(hook || '').trim()
  const transcript = String(clipTranscript || '').trim()
  if (!source && !transcript) return null

  // A short hook is already a headline — no model call needed.
  if (isUsableHeadline(source)) return tidy(source)

  const brandVoice = workspace?.brand_voice ? String(workspace.brand_voice).slice(0, 600) : ''

  const systemLines = [
    'You write on-screen headlines for short vertical videos (Instagram Reels).',
    '',
    'The headline is a scroll-stopper that sits over the first seconds of the video.',
    'It is NOT a summary and NOT a caption. It earns the next two seconds of attention.',
    '',
    'Rules:',
    `- HARD LIMIT: at most ${HEADLINE_MAX_WORDS} words and ${HEADLINE_MAX_CHARS} characters.`,
    '- No trailing period. No quotation marks. No emoji. No hashtags.',
    '- Plain spoken language. No clinical jargon unless the speaker used it.',
    '- Concrete over clever. Name the specific claim, not the topic.',
    '- Never invent a fact that is not in the hook or transcript.',
    '',
    'Reply with the headline text only — nothing else.',
  ]
  if (brandVoice) systemLines.push('', `Brand voice: ${brandVoice}`)

  const userLines = []
  if (source) userLines.push(`Hook: ${source}`)
  if (transcript) userLines.push(`What is said in the clip: ${transcript.slice(0, 1200)}`)
  userLines.push('', `Write the headline (≤${HEADLINE_MAX_WORDS} words).`)

  const { text } = await generateText({
    model: 'anthropic/claude-sonnet-4-6',
    instructions: systemLines.join('\n'),
    messages: [{ role: 'user', content: userLines.join('\n') }],
    maxOutputTokens: 64,
  })

  const candidate = tidy(text)
  // No retry, no truncation. If the model overshot, the card is dropped and the
  // reel ships clean — a correct outcome, not a failure.
  return isUsableHeadline(candidate) ? candidate : null
}

/**
 * Generate a ≤8-word slide-1 overlay hook from a post caption.
 *
 * Same "scroll-stopper, never invent, no truncation" contract as
 * generateHeadline — a carousel's first slide earns the next swipe the way a
 * reel's hook card earns the next two seconds — but the SOURCE is the caption
 * the author already wrote, not a clip transcript, and the framing is a static
 * carousel slide rather than a video. Reuses tidy/wordCount/isUsableHeadline so
 * the two paths share one length contract.
 *
 * Returns a usable hook string, or null when the model can't produce one within
 * the limit. The caller (the "Generate slide hook" button) falls back to the
 * caption's first line on null, so the button always does something — but a
 * null here means "don't dress up an overshoot as a hook", same as headlines.
 *
 * @param {Object} p
 * @param {string} p.caption        — the post caption (source of the hook)
 * @param {string} [p.platform]     — platform key, for light framing
 * @param {Object} [p.workspace]    — workspace row, for brand voice
 * @returns {Promise<string|null>}
 */
export async function generateSlideHook({ caption, platform = '', workspace = null }) {
  const source = String(caption || '').trim()
  if (!source) return null

  // A caption that is already ≤8 words IS a hook — no model call needed.
  if (isUsableHeadline(source)) return tidy(source)

  const brandVoice = workspace?.brand_voice ? String(workspace.brand_voice).slice(0, 600) : ''

  const systemLines = [
    'You write the on-screen hook for the first slide of a social carousel.',
    '',
    'The hook sits over slide 1 and earns the next swipe. It is a scroll-stopper,',
    'NOT a summary and NOT the caption repeated. It draws attention to what the',
    'post is about and makes someone want to keep reading.',
    '',
    'Rules:',
    `- HARD LIMIT: at most ${HEADLINE_MAX_WORDS} words and ${HEADLINE_MAX_CHARS} characters.`,
    '- No trailing period. No quotation marks. No emoji. No hashtags.',
    '- Plain spoken language. No clinical jargon unless the caption used it.',
    '- Concrete over clever. Name the specific idea, not the topic.',
    '- Never invent a fact that is not in the caption below.',
    '',
    'Reply with the hook text only — nothing else.',
  ]
  if (brandVoice) systemLines.push('', `Brand voice: ${brandVoice}`)

  const userLines = []
  if (platform) userLines.push(`Platform: ${platform}`)
  userLines.push(`Caption:\n${source.slice(0, 4000)}`)
  userLines.push('', `Write the slide-1 hook (≤${HEADLINE_MAX_WORDS} words).`)

  const { text } = await generateText({
    model: 'anthropic/claude-sonnet-4-6',
    instructions: systemLines.join('\n'),
    messages: [{ role: 'user', content: userLines.join('\n') }],
    maxOutputTokens: 64,
  })

  const candidate = tidy(text)
  return isUsableHeadline(candidate) ? candidate : null
}

/**
 * How long the hook card stays on screen, in seconds.
 *
 * Hook-then-drop: the card is on at frame 0 and gone once the speaker is going.
 * Duration comes from reading time (~0.35s/word, floored at 1.8s so a short
 * headline is still readable, capped at 3s so it never overstays), and is then
 * capped again at a third of the clip so a 5-second reel isn't mostly text.
 */
export function headlineWindow(headline, clipDurationSec) {
  const words = wordCount(headline)
  const byReading = Math.min(3.0, Math.max(1.8, words * 0.35))
  const byClip = Math.max(0.8, (Number(clipDurationSec) || 0) * 0.35)
  return Math.min(byReading, byClip)
}
