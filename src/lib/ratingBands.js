// One vocabulary for everything Bernard auto-rates — ONE source for the band
// thresholds, labels, tones, and tooltips. Generalises the pattern proven by
// voiceFidelity.js (one pure lib, several components, so they can't drift).
//
// Why this exists: the quote badge's tone rule had already been copy-pasted
// into two files (OnHandTab.jsx and MomentsPanel.jsx) with a third bare
// "scored NN" in MomentProvenance.jsx — the mirror-pair drift this repo keeps
// getting bitten by. Kept free of react/lucide imports so it stays a pure lib.
//
// ── Two families of signal, and only one of them belongs here ──────────────
// MATERIAL STRENGTH (quote, camera): a low score does NOT mean something is
//   broken — it means the raw material is weaker, which is evidence toward
//   retiring it. The reviewer still decides. That is why `weak` is AMBER
//   (--action, "look at this") and never --destructive: a red badge on a card
//   whose whole job is asking for a verdict would pre-judge the answer.
// TRUST (voice fidelity): a low score DOES mean Bernard produced something
//   wrong, so it keeps its own four-tier scale ending in red. See
//   voiceFidelity.js — deliberately NOT folded into this system.
//
// ── Why thresholds are per-signal ─────────────────────────────────────────
// Every scorer emits 0-100 on the wire, but they occupy genuinely different
// ranges in practice (measured 2026-07-31 against live prod):
//   quote  — 206 banked, actual range 60-90, quartiles p25=70  p75=82
//   camera — 165 segments, actual range 12-92, quartiles p25=52 p75=74
// A single shared cut would put a segment's "Strong" (74) inside a quote's
// "Typical" band. Same three words, same component, different cut points.
//
// ── Accepted drift ────────────────────────────────────────────────────────
// These are FIXED numbers cut at the quartiles as they stood on 2026-07-31,
// so they will drift as each bank grows. That is the deliberate trade:
// recalculating percentiles at read time would silently change one item's
// badge when OTHER items are added, which is worse than a threshold that
// needs re-cutting on a schedule. Logged in .claude/decisions.md with a
// revisit date.

/**
 * Band presentation. `tone` names the semantic token set (see the CLAUDE.md
 * brand-color checklist — shared tokens only, never raw hex).
 *
 * Strong is --success rather than --primary because Blue Spruce at a low tint
 * reads as chrome and disappeared against the card (Q, 2026-07-31). It carries
 * a border and a stronger tint so it holds its own next to the quote.
 */
const BAND_STYLE = {
  strong: {
    key: 'strong',
    label: 'Strong',
    text: 'text-success',
    bg: 'bg-success/15',
    border: 'border-success/40',
  },
  typical: {
    key: 'typical',
    label: 'Typical',
    text: 'text-muted-foreground',
    bg: 'bg-muted',
    border: 'border-transparent',
  },
  weak: {
    key: 'weak',
    label: 'Weak',
    text: 'text-action',
    bg: 'bg-action/12',
    border: 'border-action/35',
  },
}

/**
 * Per-signal calibration. `strong`/`typical` are inclusive lower bounds;
 * anything below `typical` is weak.
 *
 * `tips` are keyed by band and phrased as CONSEQUENCES, not definitions — a
 * band means something to someone who has never seen the scale only when it
 * says what Bernard DOES about it. Deliberately free of live counts ("57 of
 * your 206"), which would rot the moment the bank grows.
 */
export const RATING_SIGNALS = {
  quote: {
    noun: 'Quote strength',
    thresholds: { strong: 82, typical: 70 },
    tips: {
      strong:  'Top quarter of your bank. Bernard reaches for these first when it plans your week.',
      typical: 'The middle of your bank. Bernard uses these regularly to fill the week.',
      weak:    'Bottom quarter. Bernard rarely picks these — a good candidate to retire, though it stays usable until you say otherwise.',
    },
  },
  camera: {
    noun: 'On-camera strength',
    thresholds: { strong: 74, typical: 52 },
    tips: {
      strong:  'Films well — energy, eye contact, framing. Bernard puts these near the top of the video feed.',
      typical: 'Films acceptably. Bernard will use these when a stronger clip is not on hand.',
      weak:    'Films poorly — low energy, awkward framing, or little to look at. Bernard rarely reaches for these.',
    },
  },
}

/**
 * Resolve a raw 0-100 score to its band for a given signal.
 *
 * A null/undefined/non-numeric score is NOT coerced to 0 — that would paint an
 * unscored item as "Weak", which is a claim we have not earned. Callers get
 * `null` and render the em-dash placeholder instead.
 *
 * @param {number|null|undefined} score
 * @param {keyof RATING_SIGNALS} [signalKey]
 * @returns {{key:string,label:string,text:string,bg:string,border:string,tip:string,score:number}|null}
 */
export function ratingBand(score, signalKey = 'quote') {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  const signal = RATING_SIGNALS[signalKey] || RATING_SIGNALS.quote
  const key =
    score >= signal.thresholds.strong ? 'strong'
      : score >= signal.thresholds.typical ? 'typical'
        : 'weak'
  return { ...BAND_STYLE[key], tip: signal.tips[key], score }
}

/**
 * Full hover text: the consequence, then the raw number for anyone who wants
 * it. Kept here so every surface explains the badge identically.
 */
export function ratingTooltip(score, signalKey = 'quote') {
  const band = ratingBand(score, signalKey)
  const signal = RATING_SIGNALS[signalKey] || RATING_SIGNALS.quote
  if (!band) return `${signal.noun}: not scored yet.`
  return `${signal.noun} ${band.score}/100 · ${band.label}. ${band.tip}`
}
