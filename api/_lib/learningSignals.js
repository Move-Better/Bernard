// Per-dimension trust — the arithmetic behind "How Bernard is learning".
//
// Pure and standalone so it is genuinely testable. Three times this sprint a
// rule living inline behind a request handler turned out to be untestable, and
// each time the tests were quietly asserting a re-implementation rather than
// the shipped code (proved by surviving mutants). One function, both callers.
//
// Deliberately says LESS than the data allows. The panel's job is to let an
// owner know whether Bernard is being watched — a confidently wrong number is
// worse there than an admitted gap, because nobody re-checks a number that
// looks settled.

// Below this many observations a rate is not reported at all.
//
// 20 is a judgement, not a derivation, and is named rather than inlined so it
// can be argued with. The reasoning: at n=10 a single correction moves the rate
// 10 points, which would show a dimension swinging between "fine" and "shaky"
// on noise. This is the floor for SHOWING a number, not for collecting one.
export const MIN_SAMPLE = 20

// At or below this override rate a dimension has earned its autonomy.
// Chosen to sit clear of the 10% band where one correction in twenty flips the
// verdict; graduating at exactly the noise floor would make the state flap.
export const GRADUATION_RATE = 0.05

// Consecutive graduated windows before Bernard stops flagging. A single good
// window is not evidence — the whole failure mode this loop guards against is
// declaring success from a small sample.
export const GRADUATION_WINDOWS = 2

/**
 * @typedef {Object} DimensionTrust
 * @property {'untracked'|'no_data'|'too_few'|'checking'|'graduated'} state
 * @property {number|null} rate      override rate 0..1, or null when not reportable
 * @property {number} overrides
 * @property {number} observations
 */

/**
 * Trust for one dimension.
 *
 * @param {Object} p
 * @param {number} p.overrides     times a human changed Bernard's choice
 * @param {number} p.observations  times Bernard made a choice at all (the
 *                                 denominator — WITHOUT it a rate is
 *                                 meaningless, which is why autoAttachMedia and
 *                                 the draft paths stamp 'bernard' rather than
 *                                 only recording corrections)
 * @param {boolean} [p.instrumented=true] false when no signal exists yet — an
 *                                 honest 'untracked', never a flattering 0%
 * @param {number} [p.graduatedWindows=0]
 */
export function dimensionTrust({ overrides, observations, instrumented = true, graduatedWindows = 0 }) {
  if (!instrumented) return { state: 'untracked', rate: null, overrides: 0, observations: 0 }

  const obs = Math.max(0, Math.trunc(Number(observations) || 0))
  const ovr = Math.min(obs, Math.max(0, Math.trunc(Number(overrides) || 0)))

  if (obs === 0) return { state: 'no_data', rate: null, overrides: 0, observations: 0 }
  if (obs < MIN_SAMPLE) return { state: 'too_few', rate: null, overrides: ovr, observations: obs }

  const rate = ovr / obs
  const graduated = rate <= GRADUATION_RATE && graduatedWindows >= GRADUATION_WINDOWS
  return { state: graduated ? 'graduated' : 'checking', rate, overrides: ovr, observations: obs }
}

// Plain-language line for each state. Sentences, not scores: an owner should
// never have to interpret a number to know whether Bernard is being watched.
export function trustSentence(dimension, t) {
  const noun = { words: 'caption', format: 'format', media: 'photo' }[dimension] || 'choice'
  switch (t.state) {
    case 'untracked':
      return `Bernard can't see when you change the ${noun} yet.`
    case 'no_data':
      return `Started tracking. Nothing to report until Bernard has made a few ${noun} choices.`
    case 'too_few':
      return `You changed the ${noun} on ${t.overrides} of ${t.observations}. Too few to say — Bernard keeps showing you every one.`
    case 'graduated':
      return `Under ${Math.round(GRADUATION_RATE * 100)}% changed across the last ${t.observations}. Bernard stopped flagging the ${noun}.`
    default:
      return `You changed Bernard's ${noun} on ${t.overrides} of ${t.observations}.`
  }
}

// Does this dimension still get flagged for a human read?
// Anything not GRADUATED does — including untracked and no_data. Failing toward
// "show it" is the safe direction: the cost of an unnecessary flag is a glance,
// the cost of a missed one is unreviewed content going out.
export function stillFlags(t) {
  return t?.state !== 'graduated'
}
