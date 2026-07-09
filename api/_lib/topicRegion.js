import { generateObject } from 'ai'
import { z } from 'zod'

// Body-region / theme taxonomy for the topic-balance engine.
//
// Every content piece inherits a PRIMARY `region` (one of these 12 buckets)
// from its source interview, plus an optional secondary `theme`. The balance
// engine enforces "no single region over-represents the feed" against the
// PRIMARY region; `theme` is advisory (lets a Running Seminar read as both
// events-seminars + running without double-counting the region cap).
//
// Slugs are stable identifiers — the column stores the slug, the UI shows the
// label. Add a bucket ONLY by appending; never renumber/rename an existing slug
// (stored rows reference it). `general` is the safe fallback for anything that
// doesn't fit — it is intentionally exempt from the region cap (see the balance
// engine), because it's a catch-all, not a real over-represented theme.

export const REGION_BUCKETS = [
  { slug: 'foot-ankle',          label: 'Foot / Ankle',        examples: 'plantar fasciitis, heel pain, barefoot vs orthotics, achilles, ankle sprain, bunions, flat feet' },
  { slug: 'knee',                label: 'Knee',                examples: 'knee pain, runner\'s knee, patellar issues, ACL/meniscus, IT band at the knee' },
  { slug: 'hip',                 label: 'Hip',                 examples: 'hip pain, hip mobility, glutes, hamstrings, hip flexors, hinge mechanics' },
  { slug: 'spine-low-back',      label: 'Spine / Low-back',    examples: 'low back pain, sciatica, disc herniation, SI joint, core/bracing for the spine' },
  { slug: 'neck',                label: 'Neck',                examples: 'neck pain, text neck, posture, headaches from the neck, upper-trap tension' },
  { slug: 'shoulder',            label: 'Shoulder',            examples: 'shoulder pain, rotator cuff, impingement, overhead mobility' },
  { slug: 'arm',                 label: 'Arm / Elbow / Wrist', examples: 'bicep tendinopathy, tennis/golfer\'s elbow, wrist pain, carpal tunnel, grip' },
  { slug: 'movement-philosophy', label: 'Movement philosophy', examples: 'relationship with movement/exercise, translating clinic to real life, mindset, why we do what we do — no single body part' },
  { slug: 'running',             label: 'Running',             examples: 'running form, training for a race, running mechanics, mileage — when running itself is the subject, not one joint' },
  { slug: 'training-principles', label: 'Training principles', examples: 'when to push vs rest, load management, progressive overload, recovery, programming — general training guidance' },
  { slug: 'events-seminars',     label: 'Events / seminars',   examples: 'a seminar, workshop, community event, "an hour can change your life", public talk' },
  { slug: 'general',             label: 'General',             examples: 'clinic news, brand/community, anything that fits no other bucket, or test/placeholder topics' },
]

export const REGION_SLUGS = REGION_BUCKETS.map((b) => b.slug)
const LABEL_BY_SLUG = Object.fromEntries(REGION_BUCKETS.map((b) => [b.slug, b.label]))

export function regionLabel(slug) {
  return LABEL_BY_SLUG[slug] || 'General'
}

// Model: reuse the AI-Gateway path already proven in tagAsset.js (plain
// provider/model string, AI_GATEWAY_API_KEY). A short-string classification is
// cheap; flash is plenty.
const MODEL = 'google/gemini-2.5-flash'

const schema = z.object({
  region: z.enum(REGION_SLUGS),
  theme: z.enum([...REGION_SLUGS, 'none']).describe('A secondary bucket if the topic clearly spans two (e.g. a running seminar = events-seminars + running). Use "none" if there is no distinct second bucket.'),
})

function buildPrompt() {
  const vocab = REGION_BUCKETS.map((b) => `- ${b.slug}: ${b.label} — ${b.examples}`).join('\n')
  return [
    'You classify a short content topic for a chiropractic / physical-therapy clinic into one PRIMARY body-region or theme bucket, plus an optional secondary theme.',
    '',
    'Buckets:',
    vocab,
    '',
    'Rules:',
    '- Pick the single best PRIMARY bucket. If a specific joint/body part is the subject, choose that body region over a theme (e.g. "knee pain with running" → region=knee, theme=running).',
    '- Use a theme bucket as PRIMARY only when no single body part is the subject (e.g. "when to push during training" → training-principles; "building a healthy relationship with movement" → movement-philosophy; "free knee seminar" → events-seminars because the piece is about the event).',
    '- theme = a distinct SECOND bucket the topic also spans, or "none". Never repeat the primary as the theme.',
    '- If nothing fits or it looks like a test/placeholder, use general.',
    'Return only the JSON object.',
  ].join('\n')
}

const SYSTEM_PROMPT = buildPrompt()

// Classify a free-text topic string into { region, theme|null }.
// Degrades safely: with no AI key (or on error), returns { region:'general',
// theme:null } rather than throwing — the caller treats a null region as
// "unclassified" and the balance engine simply doesn't cap general.
export async function classifyTopicRegion(topic) {
  const t = String(topic || '').trim()
  if (!t) return { region: 'general', theme: null }
  if (!process.env.AI_GATEWAY_API_KEY) return { region: 'general', theme: null }
  try {
    const { object } = await generateObject({
      model: MODEL,
      schema,
      instructions: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Topic: ${t}` }],
      temperature: 0,
    })
    const region = REGION_SLUGS.includes(object.region) ? object.region : 'general'
    let theme = object.theme && object.theme !== 'none' && REGION_SLUGS.includes(object.theme) ? object.theme : null
    if (theme === region) theme = null
    return { region, theme }
  } catch (e) {
    console.error('[topicRegion] classify failed:', e?.message)
    return { region: 'general', theme: null }
  }
}

// ---------------------------------------------------------------------------
// Persistence: classify an interview's topic and stamp region/theme onto the
// interview row + every content_item generated from it. Dispatched via
// waitUntil() on interview completion (see api/_routes/db/interviews.js) and
// reused by the backfill script. Best-effort — a failure logs and returns null
// rather than throwing (region is advisory; the balance engine treats null as
// exempt), so it can never break the interview-complete cascade.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...init.headers,
    },
  })
}

export async function classifyAndStoreInterviewRegion({ interviewId, workspaceId, topic }) {
  if (!interviewId || !workspaceId) return null
  try {
    const { region, theme } = await classifyTopicRegion(topic)
    const wsFilter = `workspace_id=eq.${workspaceId}`
    const body = JSON.stringify({ region, theme })
    // Stamp the interview (source of truth).
    await sb(`interviews?id=eq.${interviewId}&${wsFilter}`, { method: 'PATCH', body })
    // Stamp any content_items already generated from it that are still
    // unclassified — never clobber a region a later run/human already set.
    await sb(`content_items?interview_id=eq.${interviewId}&${wsFilter}&region=is.null`, { method: 'PATCH', body })
    return { region, theme }
  } catch (e) {
    console.error(`[topicRegion] store failed for interview=${interviewId}:`, e?.message)
    return null
  }
}
