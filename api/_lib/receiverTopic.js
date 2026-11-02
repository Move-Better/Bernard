// Maps a story's freeform topic onto the receiving site's fixed topic enum.
//
// The enum is the workspace's own `publish_topics` (migration 070 keeps it in
// step with movebetter.co's z.enum). It used to be a hardcoded table keyed on
// the workspace SLUG 'movebetter-people'; the workspace is now 'movebetter', so
// the lookup found no rules and every freeform topic went to the receiver raw,
// where `.catch('general')` quietly turned it into "general" while the raw slug
// sat in frontmatter. Reading the list off the workspace row removes the slug
// dependence: whatever the workspace is called, its enum is its enum.
//
// Result shapes:
//   { status: 'passthrough' }                  workspace has no enforced list
//   { status: 'mapped', topic, via }           topic is in the list (exact / alias / phrase / keyword)
//   { status: 'unmapped', slug, allowed }      topic cannot be mapped; caller must NOT publish it

// Whole-slug aliases (a freeform slug we have seen, mapped to an enum slug).
// An alias only applies when its target is in the workspace's list.
const SLUG_ALIASES = {
  'knee-pain-with-running': 'knee-pain',
  'running-knee-pain': 'knee-pain',
  'knee-injury': 'knee-pain',
  'lower-back-pain': 'low-back-pain',
  'lower-back': 'low-back-pain',
  'low-back': 'low-back-pain',
  'back-pain': 'low-back-pain',
  'neck': 'neck-pain',
  'pelvic-floor': 'postpartum',
  'postnatal': 'postpartum',
  'rehab': 'injury-recovery',
  'rehabilitation': 'injury-recovery',
  'recovery-rehab': 'recovery',
  'movement': 'movement-mechanics',
  'mechanics': 'movement-mechanics',
  'strength': 'strength-training',
  'training': 'strength-training',
  'run': 'running',
  'jogging': 'running',
  'mental-health': 'mindset',
  'healthcare': 'healthcare-system',
  'insurance': 'healthcare-system',
}

// Single words that, when they appear as a whole token inside a longer topic,
// point at exactly one enum slug. Deliberately tiny: 'training' is NOT here
// because "when should I stop training if I am injured" is about the injury,
// not strength training. If a topic hits keywords for two different slugs it
// is ambiguous and goes unmapped rather than guessing.
const TOKEN_KEYWORDS = {
  injured: 'injury-recovery',
  injury: 'injury-recovery',
  injuries: 'injury-recovery',
}

export function slugifyTopic(raw) {
  if (typeof raw !== 'string') return ''
  return raw.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Index of the first place `needle` occurs as a contiguous run inside `hay`.
function runIndex(hay, needle) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/**
 * @param {unknown} rawTopic     piece topic, already slugified or not
 * @param {unknown} allowedList  workspace.publish_topics
 */
export function resolveReceiverTopic(rawTopic, allowedList) {
  const allowed = Array.isArray(allowedList)
    ? allowedList.filter((t) => typeof t === 'string' && t.trim())
    : []
  if (allowed.length === 0) return { status: 'passthrough' }
  const enumSet = new Set(allowed)

  const slug = slugifyTopic(rawTopic)
  if (!slug) return { status: 'passthrough' } // no topic at all: nothing to map

  if (enumSet.has(slug)) return { status: 'mapped', topic: slug, via: 'exact' }

  const alias = SLUG_ALIASES[slug]
  if (alias && enumSet.has(alias)) return { status: 'mapped', topic: alias, via: 'alias' }

  // An enum slug appearing as a whole-token run: "knee-pain-differential-
  // diagnostics" contains "knee-pain". Longest enum slug wins; two different
  // slugs of the same length are ambiguous. 'general' is the receiver's
  // fallback, not a topic a phrase can claim.
  const tokens = slug.split('-')
  let best = []
  let bestLen = 0
  for (const cand of allowed) {
    if (cand === 'general') continue
    const ct = cand.split('-')
    if (runIndex(tokens, ct) < 0) continue
    if (ct.length > bestLen) { best = [cand]; bestLen = ct.length }
    else if (ct.length === bestLen) best.push(cand)
  }
  if (best.length === 1) return { status: 'mapped', topic: best[0], via: 'phrase' }

  if (best.length === 0) {
    const hits = new Set(
      tokens.map((t) => TOKEN_KEYWORDS[t]).filter((t) => t && enumSet.has(t)),
    )
    if (hits.size === 1) return { status: 'mapped', topic: [...hits][0], via: 'keyword' }
  }

  return { status: 'unmapped', slug, allowed }
}
