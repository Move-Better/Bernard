// Client-side atom definitions — mirrors api/_lib/atomPlan.js.
// Used for UI rendering (labels, descriptions, icons, slot badges).
// Keep in sync with the server-side file when adding new platforms/angles.

import { PLATFORM_META } from './contentMeta.js'

export const ATOM_DEFINITIONS = {
  instagram: [
    { slot: 1, angle: 'hook',             label: 'The Hook',             description: 'Scroll-stopping myth-buster or bold claim — impossible to scroll past' },
    { slot: 2, angle: 'quick_win',        label: 'Quick Win',            description: 'One actionable tip or self-test viewers can try right now — no patient specifics' },
    { slot: 3, angle: 'clinical_insight', label: 'Clinical Insight',     description: 'The one thing most people get wrong about this condition' },
    { slot: 4, angle: 'cta',              label: 'Call to Action',       description: 'Book-now post with a condition-specific hook' },
  ],
  linkedin: [
    { slot: 1, angle: 'clinical_perspective', label: 'Clinical Perspective',    description: 'What this clinic approaches differently — for clinicians and referrers' },
    { slot: 2, angle: 'referring_provider',   label: 'For Referring Providers', description: 'What other clinicians should know before referring this condition' },
    { slot: 3, angle: 'movement_principle',   label: 'Movement Principle',      description: 'The underlying science or approach that sets this clinic apart' },
  ],
  facebook: [
    { slot: 1, angle: 'community',   label: 'Community Story',  description: 'Local + personal angle for the clinic community' },
    { slot: 2, angle: 'educational', label: 'Educational Post', description: 'Myth-buster or FAQ format for patients and families' },
  ],
  gbp: [
    { slot: 1, angle: 'local_authority', label: 'Local Authority',  description: 'Local keywords, what makes us different, strong book CTA' },
    { slot: 2, angle: 'patient_outcome', label: 'Patient Outcome',  description: 'What recovery looks like — condition-specific results framing' },
  ],
  tiktok: [
    { slot: 1, angle: 'myth_buster', label: 'Myth-Buster Script', description: '45–60 second script leading with a counterintuitive claim' },
    { slot: 2, angle: 'process',     label: 'The Process Script', description: '45–60 second script showing what treatment or recovery looks like' },
  ],
  twitter: [
    { slot: 1, angle: 'hook',           label: 'The Hook (Tweet)',  description: 'Single 280-char zinger from the blog’s sharpest claim — built to be quoted and shared' },
  ],
  threads: [
    { slot: 1, angle: 'community_take', label: 'Community Take',    description: 'Conversational 500-char post that opens a question and invites replies' },
  ],
  bluesky: [
    { slot: 1, angle: 'clinical_share', label: 'Clinical Share',    description: 'Considered clinician-to-clinician share for the Bluesky audience — no hashtags' },
  ],
  mastodon: [
    { slot: 1, angle: 'educational',    label: 'Educational Toot',  description: 'Plain-language educational post with an optional content warning, inclusive of the federated community' },
  ],
  // instagram_story is its own atom platform (not grouped under `instagram`):
  // 5–8 words of overlay text for a 9:16 frame + a link sticker, not a caption.
  instagram_story: [
    { slot: 1, angle: 'story_teaser',   label: 'Story',             description: '5–8 word overlay text teaser for a 9:16 Instagram Story with a link sticker' },
  ],
}

// Derived view of the canonical PLATFORM_META registry (contentMeta.js),
// restricted to the atom platforms the Strategist plans against. Keyed off
// ATOM_DEFINITIONS so a new atom platform only needs (a) its atom slots here
// and (b) one PLATFORM_META entry — no third hand-copied registry to drift.
export const PLATFORM_UI = Object.fromEntries(
  Object.keys(ATOM_DEFINITIONS).map((id) => [id, PLATFORM_META[id]])
)

export const SLOT_LABELS = ['Week 1', 'Week 2', 'Week 3', 'Week 4']

// Suggested publish date: interview created_at + (slot - 1) weeks
export function suggestedDate(interviewCreatedAt, slot) {
  const d = new Date(interviewCreatedAt)
  d.setDate(d.getDate() + (slot - 1) * 7)
  return d
}

export function formatSlotDate(interviewCreatedAt, slot) {
  const d = suggestedDate(interviewCreatedAt, slot)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
