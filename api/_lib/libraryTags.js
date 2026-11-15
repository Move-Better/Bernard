// Library tags: a small, FIXED vocabulary the movebetter.co website searches by
// (docs/media-library-plan.md, section 6). Free-form ai_tags stay as they are;
// these are added on top so the website can rely on exact spellings.
//
// Conditions mirror the website's condition pages
// (Move-Better/Movebetterco src/content/conditions/*.md). Add a slug here when
// the website adds a condition page. Which clinic a facility shot shows can't
// be seen in a photo, so `clinic-space` is generic; a person adds
// `portland-facility` / `vancouver-facility` by hand in the media detail screen.

import { generateObject } from 'ai'
import { z } from 'zod'

export const LIBRARY_TAGS = [
  // pillars
  'breathe', 'brace', 'hinge',
  // website condition slugs
  'concussion-whiplash', 'foot-ankle', 'headaches-migraines', 'knee-pain',
  'low-back-pain', 'prenatal-postpartum', 'shoulder-pain',
  // what kind of picture it is
  'treatment', 'exercise', 'assessment', 'headshot', 'team', 'clinic-space', 'outdoors',
]

// Only the human-clinic workspace feeds the website today.
export const LIBRARY_TAG_WORKSPACES = new Set(['movebetter'])

const MODEL = 'google/gemini-3.8-flash' // same model as tagAsset.js

const schema = z.object({ library_tags: z.array(z.enum(LIBRARY_TAGS)).max(6) })

const INSTRUCTIONS = [
  'You label photos for a movement-focused chiropractic and physical-therapy clinic website.',
  'Pick every tag from the list that clearly applies to what is visible; pick none rather than guess.',
  'Pillars: breathe = breathing or diaphragm work; brace = core bracing, trunk stability, carries, planks;',
  'hinge = hip hinge patterns such as deadlifts, kettlebell swings, good mornings.',
  'Conditions: only when the treated or demonstrated body area clearly matches (e.g. knee-pain for knee work,',
  'low-back-pain for lumbar work, shoulder-pain for shoulder work, foot-ankle for foot or ankle work,',
  'headaches-migraines or concussion-whiplash for head/upper-neck work, prenatal-postpartum for a visibly pregnant patient or newborn care).',
  'treatment = hands-on care; exercise = a person moving or training; assessment = testing or measuring;',
  'headshot = posed portrait of one person; team = posed group of staff; clinic-space = the facility with no activity as the subject;',
  'outdoors = taken outside.',
].join(' ')

// Which image to send: web variant, else the original photo, else a video's poster.
export function libraryTagImage(asset) {
  if (asset.kind === 'video') return asset.thumbnail_url || null
  return asset.web_blob_url || asset.blob_url || null
}

export function imageMediaType(url, fallback) {
  const ext = String(url).split('?')[0].split('.').pop().toLowerCase()
  return { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', heic: 'image/heic', avif: 'image/avif' }[ext]
    || fallback || 'image/jpeg'
}

export function mergeLibraryTags(aiTags, libraryTags) {
  const out = [...(aiTags || [])]
  for (const t of libraryTags || []) if (!out.includes(t)) out.push(t)
  return out
}

// Returns the library tags for one asset, or [] when there is nothing to look at.
export async function classifyLibraryTags(asset) {
  const url = libraryTagImage(asset)
  if (!url) return []
  const mediaType = imageMediaType(url, asset.kind === 'video' ? null : asset.mime_type)
  const { object } = await generateObject({
    model: MODEL,
    schema,
    instructions: INSTRUCTIONS,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Return the library tags that apply to this image.' },
      { type: 'file', data: url, mediaType },
    ] }],
    temperature: 0,
  })
  return [...new Set(object.library_tags)]
}
