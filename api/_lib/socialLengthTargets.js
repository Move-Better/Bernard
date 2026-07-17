// Single source of truth for the target LENGTH of generated social posts.
// Consumed by BOTH generation paths — atomPrompts.js (interview → atoms) and
// briefPrompts.js (write-once brief → channels) — so length can never drift
// between them again (the pre-2026-07 GBP inconsistency: atoms ~200 words vs
// brief 150–300 chars). See .claude/social-length-strategy-spec.md.
//
// Design:
//   • Length follows the MESSAGE, not the platform ceiling. Each (platform,
//     angle) has a length "lane": short (brevity IS the job — hooks, CTAs,
//     teasers), medium (the everyday), or long (the deliberate deep-dive — the
//     differentiator we protect).
//   • A workspace `social_length_lean` dial (punchy | balanced | indepth) shifts
//     targets. It scales the LONG lane aggressively and leaves short/medium
//     ~unchanged — the dial decides how DEEP the deep posts go, not how long
//     everything gets. (A hook stays a hook even for an in-depth clinic.)
//   • Units: 'words' for caption-style platforms, 'chars' for the terse ones
//     (X/Threads/Bluesky/Mastodon) and GBP (Google truncates on characters).

export const LEANS = ['punchy', 'balanced', 'indepth']
export const DEFAULT_LEAN = 'balanced'

// lane → per-lean scale factor applied to the balanced [lo,hi] range.
// short/medium barely move; long scales hard (the whole point of the dial).
const LANE_SCALE = {
  short:  { punchy: 0.85, balanced: 1, indepth: 1.05 },
  medium: { punchy: 0.8,  balanced: 1, indepth: 1.15 },
  long:   { punchy: 0.7,  balanced: 1, indepth: 1.55 },
}

// Balanced baseline per (platform, angle). `cap` = the platform's hard ceiling
// (guardrail only, never the target). frontLoad = the visible-before-"…more"
// surface needs the first sentence to stand on its own.
export const SOCIAL_LENGTH = {
  instagram: {
    hook:             { lane: 'short',  unit: 'words', lo: 25,  hi: 50,  cap: 2200, frontLoad: true, shape: 'a punchy scroll-stopper — the carousel carries the depth, so the caption is one sharp thought, not a mini-essay' },
    quick_win:        { lane: 'medium', unit: 'words', lo: 55,  hi: 95,  cap: 2200, frontLoad: true, shape: 'one useful tip with a line of why' },
    clinical_insight: { lane: 'long',   unit: 'words', lo: 150, hi: 220, cap: 2200, frontLoad: true, shape: 'the deep-dive — give the clinical reasoning real room' },
    cta:              { lane: 'short',  unit: 'words', lo: 30,  hi: 60,  cap: 2200, frontLoad: true, shape: 'a short, direct invitation' },
  },
  linkedin: {
    clinical_perspective: { lane: 'long',   unit: 'words', lo: 220, hi: 310, cap: 3000, frontLoad: true, shape: 'a substantive clinical point of view — LinkedIn rewards depth' },
    referring_provider:   { lane: 'medium', unit: 'words', lo: 120, hi: 170, cap: 3000, frontLoad: true, shape: 'a focused note to referring peers' },
    movement_principle:   { lane: 'medium', unit: 'words', lo: 140, hi: 190, cap: 3000, frontLoad: true, shape: 'one principle, explained for non-specialists' },
  },
  facebook: {
    community:   { lane: 'short',  unit: 'words', lo: 25, hi: 50, frontLoad: true, shape: 'warm and neighborly — a couple of sentences, ends on a question' },
    educational: { lane: 'medium', unit: 'words', lo: 50, hi: 90, frontLoad: true, shape: 'one myth-bust with substance, plainly explained' },
  },
  gbp: {
    local_authority: { lane: 'medium', unit: 'chars', lo: 300, hi: 550, cap: 1500, frontLoad: true, shape: 'lead with the hook in the first ~100 characters (all Google shows), then a short authority body' },
    patient_outcome: { lane: 'medium', unit: 'chars', lo: 450, hi: 780, cap: 1500, frontLoad: true, shape: 'lead with the hook in the first ~100 characters, then the recovery/outcome narrative' },
  },
  tiktok: {
    myth_buster: { lane: 'medium', unit: 'words', lo: 110, hi: 150, shape: 'a 45–60 second spoken script' },
    process:     { lane: 'medium', unit: 'words', lo: 110, hi: 150, shape: 'a 45–60 second spoken script' },
  },
  twitter:  { hook:           { lane: 'short',  unit: 'chars', lo: 100, hi: 210, cap: 280, shape: 'a quotable one-liner with room to be shared — vary the length, do not fill to the max' } },
  threads:  { community_take: { lane: 'medium', unit: 'chars', lo: 140, hi: 320, cap: 500, shape: 'conversational, opens a question' } },
  bluesky:  { clinical_share: { lane: 'medium', unit: 'chars', lo: 130, hi: 255, cap: 300, shape: 'precise and technical' } },
  mastodon: { educational:    { lane: 'medium', unit: 'chars', lo: 160, hi: 340, cap: 500, shape: 'plain-language community register' } },
  instagram_story: { story_teaser: { lane: 'short', unit: 'words', lo: 5, hi: 8, shape: 'a billboard line — 5–8 words, ALL CAPS' } },
}

// Brief-broadcast has no angle concept (a brief is one announcement fanned to
// channels), so map each brief platform to a representative angle's targets.
const BRIEF_ANGLE = {
  instagram: 'quick_win',
  facebook: 'educational',
  linkedin: 'referring_provider',
  gbp: 'local_authority',
  twitter: 'hook',
  threads: 'community_take',
  instagram_story: 'story_teaser',
}

function normalizeLean(lean) {
  return LEANS.includes(lean) ? lean : DEFAULT_LEAN
}

/**
 * Resolve the concrete target range for a (platform, angle) at a given lean.
 * Returns null for unknown combos (caller falls back to its own default line).
 */
export function resolveRange(platform, angle, lean = DEFAULT_LEAN) {
  const spec = SOCIAL_LENGTH[platform]?.[angle]
  if (!spec) return null
  const k = LANE_SCALE[spec.lane][normalizeLean(lean)]
  let lo = Math.round(spec.lo * k)
  let hi = Math.round(spec.hi * k)
  if (spec.cap) hi = Math.min(hi, spec.cap) // never target above the hard ceiling
  if (lo > hi) lo = hi
  return { lo, hi, unit: spec.unit, cap: spec.cap ?? null, frontLoad: !!spec.frontLoad, shape: spec.shape || '', lane: spec.lane }
}

/**
 * Render the LENGTH instruction line injected into a per-platform prompt.
 * Bakes in the target range + shape + the don't-pad discipline + the hard-cap
 * guardrail + the front-load rule, so callers just drop this one line in place
 * of a hardcoded "(~N words)".
 */
export function lengthLine(platform, angle, lean = DEFAULT_LEAN) {
  const r = resolveRange(platform, angle, lean)
  if (!r) return ''
  const unitWord = r.unit === 'chars' ? 'characters' : 'words'
  let line = `LENGTH: aim for ~${r.lo}–${r.hi} ${unitWord}${r.shape ? ` — ${r.shape}` : ''}. Match the length to the substance of the point; do NOT pad to reach the top of that range — a sharp point in fewer ${unitWord} beats a padded one.`
  // cap is always the platform's hard CHARACTER ceiling, regardless of the
  // target unit — never render it as "words".
  if (r.cap) line += ` Never exceed ${r.cap} characters total.`
  if (r.frontLoad) {
    const foldNote = r.unit === 'chars' && platform === 'gbp'
      ? `Google's ~100-character preview`
      : `any "…more" fold`
    line += ` Front-load it: the first sentence must deliver the whole point on its own, before ${foldNote} cuts it off.`
  }
  return line
}

/** Brief-path variant — resolves the platform's representative angle. */
export function briefLengthLine(platform, lean = DEFAULT_LEAN) {
  const angle = BRIEF_ANGLE[platform]
  return angle ? lengthLine(platform, angle, lean) : ''
}

/** Read the dial off a workspace row, defaulting safely. */
export function leanOf(workspace) {
  return normalizeLean(workspace?.social_length_lean)
}

/**
 * The hard CHARACTER ceiling for a platform (the max `cap` across its angles —
 * a platform's cap is its API limit, the same for every angle). Returns null for
 * platforms we don't cap (facebook, tiktok, instagram_story). This is the
 * guardrail ceiling, NOT the target range — see resolveRange for targets.
 */
export function platformCap(platform) {
  const angles = SOCIAL_LENGTH[platform]
  if (!angles) return null
  let cap = null
  for (const a of Object.values(angles)) {
    if (a.cap) cap = cap === null ? a.cap : Math.max(cap, a.cap)
  }
  return cap
}

/**
 * Clamp text to a hard character cap WITHOUT cutting mid-sentence. Prefers the
 * last sentence terminator (. ! ?) at/under the cap; falls back to the last word
 * boundary; last resort a hard slice. No ellipsis is added — the cap is a
 * character budget (GBP counts every char), so an added "…" would itself risk
 * re-crossing the ceiling. Returns text unchanged when it already fits (or when
 * cap/text is falsy). The 50%-of-cap floor stops an unusually-early period from
 * throwing away half the caption; below it we prefer a near-cap word boundary.
 */
export function clampToCap(text, cap) {
  if (!cap || typeof text !== 'string' || text.length <= cap) return text
  const window = text.slice(0, cap)
  const floor = Math.floor(cap * 0.5)
  // Last sentence-ending punctuation, optionally trailed by a closing quote/paren.
  const sentence = window.match(/[\s\S]*[.!?]["')\]]?(?=\s|$)/)
  if (sentence && sentence[0].trim().length >= floor) return sentence[0].trim()
  // No good sentence boundary — don't cut a word in half.
  const lastSpace = window.lastIndexOf(' ')
  if (lastSpace >= floor) return window.slice(0, lastSpace).trim()
  // Last resort: hard slice (a single token longer than the cap).
  return window.trim()
}
