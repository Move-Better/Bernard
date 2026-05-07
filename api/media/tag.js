import { generateObject } from 'ai'
import { z } from 'zod'
import { brand } from '../../src/lib/brand.js'

// AI auto-tagging for media_assets rows. Photos get vision-based tags;
// videos additionally get a transcription. Talks to the Vercel AI Gateway
// with a plain `provider/model` string (AI_GATEWAY_API_KEY in env).
//
// Runs on Node (Fluid Compute) — same constraint as the rest of the media
// routes, plus generateObject pulls in node-only bits.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Gemini Flash handles both image vision and video transcription cheaply
// and quickly. Swap the model string here if a better video model surfaces.
const MODEL = 'google/gemini-2.5-flash'

// Vision + transcription on a 60s clip can take ~30–60s. Default fluid
// compute timeout is plenty; we cap a little over the worst observed case.
export const config = { maxDuration: 120 }

function brandId() {
  return (process.env.BRAND || process.env.VITE_BRAND || 'people').toLowerCase()
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const err = (msg, status = 400)  => new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })

// Anatomy / scene vocab the model should prefer per paradigm. Brand-side
// tone modifiers and audience already live in brand.js; this is the chunk
// that's specifically about *what to look at* in clinical media.
const VOCAB = {
  people:  'human anatomy and movement: low-back, mid-back, neck, shoulder, hip, knee, ankle, glute, hamstring, hinge, brace, breathing, runner, lifter, climber, post-op, senior',
  equine:  'horse anatomy and gait: poll, withers, thoracic, lumbar, sacrum, hip, stifle, hock, fetlock, shoulder, neck, lead-refusal, posture, mobile-visit, dressage, jumping, trail',
  animals: 'companion-animal anatomy: hip, stifle, shoulder, neck, spine, tail, gait, senior-dog, working-dog, agility, hiking-companion, post-surgical, mobility, dog, cat',
}

function buildSystemPrompt(kind) {
  const id = brandId()
  const vocab = VOCAB[id] || VOCAB.people
  const lines = [
    `You are tagging clinical media for a ${brand.prompt.clinicContext}`,
    `Audience: ${brand.prompt.audienceShort}`,
    `Relevant context: ${brand.prompt.sportContext}.`,
    `Anatomy / scene vocabulary to prefer: ${vocab}.`,
    '',
    'Return 4–8 short, lowercase, kebab-case tags that describe what is visibly happening in this clip. Use single tokens or short phrases (e.g. "low-back", "post-op", "senior-dog", "lead-refusal"). Avoid filler tags like "video", "photo", "person", or generic camera/edit terms.',
  ]
  if (kind === 'video') {
    lines.push(
      '',
      'If the clip contains spoken word, also return a clean transcription with light punctuation. Skip filler, music notes, or onscreen text. If there is no speech, return an empty string.',
    )
  }
  return lines.join('\n')
}

const photoSchema = z.object({
  tags: z.array(z.string()).min(1).max(10),
})

const videoSchema = z.object({
  tags:          z.array(z.string()).min(1).max(10),
  transcription: z.string(),
})

function normalizeTag(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/['’"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeTags(tags, existingUserTags = []) {
  const lowerExisting = new Set((existingUserTags || []).map((t) => String(t).toLowerCase()))
  const seen = new Set()
  const out = []
  for (const t of tags || []) {
    const norm = normalizeTag(t)
    if (!norm) continue
    if (norm.length > 40) continue
    if (lowerExisting.has(norm) || seen.has(norm)) continue
    seen.add(norm)
    out.push(norm)
    if (out.length >= 8) break
  }
  return out
}

async function tagAsset(asset) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error('AI_GATEWAY_API_KEY is not set on this deployment')
  }
  if (!asset.blob_url) {
    throw new Error('Asset has no blob_url to analyze')
  }

  const isVideo = asset.kind === 'video'
  const userParts = [
    { type: 'text', text: isVideo
        ? 'Watch this clip and return tags + transcription as specified.'
        : 'Look at this image and return tags as specified.' },
    {
      type: 'file',
      data: asset.blob_url,
      mediaType: asset.mime_type || (isVideo ? 'video/mp4' : 'image/jpeg'),
    },
  ]

  const { object } = await generateObject({
    model: MODEL,
    schema: isVideo ? videoSchema : photoSchema,
    system: buildSystemPrompt(asset.kind),
    messages: [{ role: 'user', content: userParts }],
    // Flash is fast; keep temperature low so tags stay predictable.
    temperature: 0.2,
  })

  const ai_tags = normalizeTags(object.tags, asset.tags)
  const transcription = isVideo ? (object.transcription || '').trim() : null
  return { ai_tags, transcription }
}

export default async function handler(req) {
  if (req.method !== 'POST') return err('Method not allowed', 405)

  let body
  try { body = await req.json() } catch { return err('Invalid JSON body') }
  const id = body?.id
  if (!id) return err('Missing id')

  const where = `id=eq.${id}&brand=eq.${brandId()}`

  const lookup = await sb(`media_assets?${where}&select=id,brand,kind,status,blob_url,mime_type,tags,notes`)
  if (!lookup.ok) return err('Database error', 500)
  const rows = await lookup.json()
  const asset = rows[0]
  if (!asset) return err('Not found', 404)

  try {
    const { ai_tags, transcription } = await tagAsset(asset)

    const patch = { ai_tags, status: 'tagged' }
    if (asset.kind === 'video') patch.transcription = transcription

    const upd = await sb(`media_assets?${where}`, { method: 'PATCH', body: JSON.stringify(patch) })
    if (!upd.ok) {
      const text = await upd.text()
      return err(`Update failed: ${text}`, 500)
    }
    const data = await upd.json()
    return ok(data[0] ?? null)
  } catch (e) {
    // On failure, surface in `notes` and leave status untouched so the
    // operator can retry from MediaDetail. Don't clobber existing notes.
    const message = e?.message || 'Tagging failed'
    const stamp = new Date().toISOString()
    const noteLine = `[ai-tag ${stamp}] ${message}`
    const merged = asset.notes ? `${asset.notes}\n${noteLine}` : noteLine
    await sb(`media_assets?${where}`, { method: 'PATCH', body: JSON.stringify({ notes: merged }) }).catch(() => {})
    return err(message, 500)
  }
}
