// Content rules for blogs published to movebetter.co.
//
// Move Better ONLY: the caller gates on the workspace slug. Bernard is
// multi-tenant and none of this applies to another tenant's site.
//
// Why (website audit 2026-11-25): published posts linked to old-site
// movebetter.co paths that 404, used the photo's file name as alt text, and
// used full doctor names where the clinic writes "Dr. [first name]".
//
// What a person can edit in the draft is rejected with the fix. What they
// cannot (the byline comes from the staff record, the hero alt from the media
// entry's file name) is repaired.

export const MOVE_BETTER_WEBSITE_SLUG = 'movebetter'

// First path segment of every section the current site serves.
const SECTIONS = new Set([
  '', 'about', 'answers', 'benefitscheck', 'book', 'conditions', 'faq', 'go-deeper',
  'images', 'locations', 'method', 'privacy', 'team', 'videos',
])

const DOCTORS = [
  { first: 'Q', full: ['Michael', 'Q'], last: 'Quasney' },
  { first: 'Whitney', full: ['Whitney'], last: 'Phillips' },
  { first: 'Zach', full: ['Zachary', 'Zach'], last: 'Cullen' },
  { first: 'Sophie', full: ['Sophie'], last: 'Kaplan(?:-Mutch)?' },
  { first: 'Tyler', full: ['Tyler'], last: 'Hoang' },
]

const nameRe = (d) =>
  new RegExp(`(?:\\b(?:Dr\\.?|Doctor)\\s+)?\\b(?:${d.full.join('|')})(?:\\s+['"“‘]Q['"”’])?\\s+${d.last}\\b|\\b(?:Dr\\.?|Doctor)\\s+${d.last}\\b`)

const FILE_NAME_RE = /\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?)\s*$/i

export function isFileNameAlt(alt) {
  return FILE_NAME_RE.test(String(alt || ''))
}

export function websiteByline(author) {
  const doctor = DOCTORS.find((d) => nameRe(d).test(String(author || '')))
  return doctor ? `Dr. ${doctor.first}` : author
}

export function oldSiteLinks(markdown) {
  const text = String(markdown || '')
  const found = [
    ...[...text.matchAll(/https?:\/\/(?:www\.)?movebetter\.co(?![\w.-])([^\s)"'<>\]]*)/gi)].map((m) => ({ url: m[0], path: m[1] })),
    ...[...text.matchAll(/(?:\]\(|href=["'])(\/(?!\/)[^\s)"']*)/g)].map((m) => ({ url: m[1], path: m[1] })),
  ]
  return [...new Set(found
    .filter(({ path }) => !SECTIONS.has(path.split(/[?#]/)[0].split('/')[1]?.replace(/[.,;:]+$/, '') || ''))
    .map(({ url }) => url))]
}

export function fullDoctorNames(...texts) {
  const text = texts.filter(Boolean).join('\n')
  return DOCTORS.flatMap((d) => text.match(nameRe(d))?.[0] ?? [])
}

/**
 * Repairs `payload` in place and returns the problems the author has to fix.
 * `lookupAlt(fileName)` returns the media library's alt text for that file.
 */
export async function checkMoveBetterBlog(payload, { lookupAlt }) {
  if (payload.author) payload.author = websiteByline(payload.author)

  if (isFileNameAlt(payload.heroImageAlt)) {
    const alt = await lookupAlt(payload.heroImageAlt)
    if (alt && !isFileNameAlt(alt)) payload.heroImageAlt = alt
  }

  const issues = []
  const links = oldSiteLinks(payload.markdown)
  if (links.length) issues.push(`Links to pages movebetter.co no longer has: ${links.join(', ')}`)

  const names = fullDoctorNames(payload.title, payload.seoTitle, payload.headline, payload.description, payload.markdown)
  if (names.length) issues.push(`Write doctors as "Dr. [first name]", not ${names.join(', ')}`)

  if (isFileNameAlt(payload.heroImageAlt)) {
    issues.push(`The main photo has no description. Add alt text to ${payload.heroImageAlt} in the Media library`)
  }
  const inline = [...String(payload.markdown || '').matchAll(/!\[([^\]]*)\]\(/g)].map((m) => m[1]).filter(isFileNameAlt)
  if (inline.length) issues.push(`Replace the file name used as a picture description: ${inline.join(', ')}`)

  return issues
}
