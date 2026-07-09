// Inbound publish webhook for withbernard.ai's own blog.
//
// Mirrors the receive side of the Astro+GitHub publish contract that
// api/publish/website.js → publishToAstro() sends to. Lets a Studio
// workspace push approved blog posts straight into Move-Better/Bernard's
// src/content/blog/<slug>.md, which scripts/build-blog.mjs picks up at the
// next Vercel deploy.
//
// Auth: Bearer <BERNARD_PUBLISH_SECRET>. The shared secret is configured
// once in this project's env vars (Sensitive) and pasted into the calling
// workspace's astro_github credential.
//
// GitHub: commits via Contents API using GITHUB_TOKEN_BERNARD_PUBLISH
// (Sensitive, fine-grained PAT scoped to Move-Better/Bernard with
// `contents: read+write`). Never overwrites — duplicate slug → 409.
//
// Contract (response codes mirror what publishToAstro() expects):
//   200  { success: true, slug, commitUrl, postUrl }
//   400  { error: 'invalid_payload', message, issues[] }
//   401  { error: 'unauthorized', message }
//   409  { error: 'slug_taken', slug, message }
//   500  { error: 'misconfigured', message }          — env vars missing
//   502  { error: 'github_error', message, retriable } — transient upstream

export const config = { runtime: 'nodejs', maxDuration: 30 }

import { timingSafeEqual } from 'node:crypto'
import { enforceLimit } from '../_lib/ratelimit.js'
import { findSlugPrefixCollision, slugifyTitle, SLUG_MAX } from '../../src/lib/blogOutput.js'

const REPO_OWNER = 'Move-Better'
const REPO_NAME  = 'Bernard'
const REPO_BRANCH = 'main'
const CONTENT_PATH_PREFIX = 'src/content/blog'

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

function yamlQuote(s) {
  // Quote a string with double quotes for YAML, escaping backslashes and quotes.
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function buildMarkdownFile(data) {
  const fm = []
  fm.push(`title: ${yamlQuote(data.title)}`)
  // seoTitle — the ≤60-char <title>/og:title. `title` stays the on-page <h1>
  // (it may be longer). build-blog.mjs falls back to deriving one when absent.
  if (data.seoTitle) fm.push(`seoTitle: ${yamlQuote(data.seoTitle)}`)
  fm.push(`description: ${yamlQuote(data.description)}`)
  fm.push(`pubDate: ${data.pubDate}`)
  if (data.updatedDate)  fm.push(`updatedDate: ${data.updatedDate}`)
  if (data.author)       fm.push(`author: ${yamlQuote(data.author)}`)
  if (data.heroImage)    fm.push(`hero: ${yamlQuote(data.heroImage)}`)
  if (data.heroImageAlt) fm.push(`heroAlt: ${yamlQuote(data.heroImageAlt)}`)
  // heroVideo is emitted as a small inline-object so scripts/build-blog.mjs
  // can render <mux-player playback-id="…"> without parsing a nested YAML
  // block. Shape: { playbackId, type, policy, alt }.
  if (data.heroVideo && data.heroVideo.playbackId && data.heroVideo.type === 'mux') {
    const v = data.heroVideo
    const parts = [
      `playbackId: ${yamlQuote(v.playbackId)}`,
      `type: ${yamlQuote(v.type)}`,
    ]
    if (v.policy) parts.push(`policy: ${yamlQuote(v.policy)}`)
    if (v.alt)    parts.push(`alt: ${yamlQuote(v.alt)}`)
    fm.push(`heroVideo: { ${parts.join(', ')} }`)
  }
  if (Array.isArray(data.tags) && data.tags.length) {
    fm.push(`tags: [${data.tags.map(yamlQuote).join(', ')}]`)
  }
  if (typeof data.draft === 'boolean') fm.push(`draft: ${data.draft}`)
  if (data.topic) fm.push(`topic: ${yamlQuote(data.topic)}`)
  return `---\n${fm.join('\n')}\n---\n\n${String(data.markdown).trimEnd()}\n`
}

// Timing-safe secret comparison. Any mismatch (missing value, wrong length)
// returns false — never throws.
function secretsMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

const GH_HEADERS_BASE = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'bernard-publish-blog/1.0',
}

async function githubGet(token, path) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${encodeURIComponent(REPO_BRANCH)}`
  return fetch(url, { headers: { ...GH_HEADERS_BASE, Authorization: `Bearer ${token}` } })
}

// List the published blog slugs by reading the content directory. Returns an
// array of slugs (filenames minus the .md extension), or null if the directory
// can't be read (treated as "can't verify" — the caller skips the prefix guard
// rather than blocking a legitimate publish on a transient GitHub error).
async function githubListSlugs(token) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${CONTENT_PATH_PREFIX}?ref=${encodeURIComponent(REPO_BRANCH)}`
  let resp
  try {
    resp = await fetch(url, { headers: { ...GH_HEADERS_BASE, Authorization: `Bearer ${token}` } })
  } catch {
    return null
  }
  if (!resp.ok) return null
  let listing
  try { listing = await resp.json() } catch { return null }
  if (!Array.isArray(listing)) return null
  return listing
    .filter((e) => e?.type === 'file' && typeof e.name === 'string' && e.name.endsWith('.md'))
    .map((e) => e.name.replace(/\.md$/, ''))
}

async function githubPut(token, path, content, message) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`
  return fetch(url, {
    method: 'PUT',
    headers: { ...GH_HEADERS_BASE, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: REPO_BRANCH,
    }),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'POST only' })
  }

  const expectedSecret = process.env.BERNARD_PUBLISH_SECRET
  const ghToken        = process.env.GITHUB_TOKEN_BERNARD_PUBLISH
  if (!expectedSecret || !ghToken) {
    console.error('[publish-blog] env missing:', { hasSecret: !!expectedSecret, hasToken: !!ghToken })
    return res.status(500).json({ error: 'misconfigured' })
  }

  const authHeader = req.headers['authorization'] || ''
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!secretsMatch(provided, expectedSecret)) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  if (!(await enforceLimit(req, res, 'publish-blog-inbound'))) return

  const payload = (typeof req.body === 'object' && req.body) ? req.body : null
  if (!payload) {
    return res.status(400).json({ error: 'invalid_payload', message: 'Request body must be JSON.', issues: ['body parse failed'] })
  }

  const issues = []
  const required = ['slug', 'title', 'description', 'pubDate', 'markdown']
  for (const k of required) {
    if (!payload[k] || (typeof payload[k] === 'string' && !payload[k].trim())) issues.push(`${k} required`)
  }
  if (payload.slug && !SLUG_RE.test(payload.slug)) {
    issues.push('slug must be lowercase alphanumeric + hyphens (matches /^[a-z0-9][a-z0-9-]*$/)')
  }
  // Auto-correct an over-length slug using the same word-boundary cap that the
  // Studio workspace should apply. This silences rejections when the title is
  // long — the slug is truncated here rather than surfaced as an error.
  if (payload.slug && payload.slug.length > SLUG_MAX) {
    payload.slug = slugifyTitle(payload.title)
  }
  if (issues.length) {
    return res.status(400).json({ error: 'invalid_payload', message: 'Validation failed.', issues })
  }

  const slug = payload.slug
  const filePath = `${CONTENT_PATH_PREFIX}/${slug}.md`
  const tag = `[publish-blog slug=${slug}]`

  // 1. Existence check — never overwrite.
  let existsResp
  try {
    existsResp = await githubGet(ghToken, filePath)
  } catch (e) {
    console.error(tag, 'github existence-check network error:', e?.message)
    return res.status(502).json({ error: 'github_error', retriable: true })
  }
  if (existsResp.ok) {
    console.error(tag, 'slug_taken:', slug, filePath)
    return res.status(409).json({ error: 'slug_taken', slug })
  }
  if (existsResp.status === 401 || existsResp.status === 403) {
    console.error(tag, `github auth ${existsResp.status} on existence check`)
    return res.status(500).json({
      error: 'misconfigured',
      message: 'The GitHub token lacks contents access on Move-Better/Bernard. Regenerate the PAT with `Contents: read+write` and re-paste in Vercel env.',
    })
  }
  if (existsResp.status !== 404) {
    const body = await existsResp.text().catch(() => '')
    console.error(tag, `github existence-check ${existsResp.status}:`, body.slice(0, 500))
    return res.status(502).json({ error: 'github_error', retriable: true })
  }

  // 1b. Prefix-collision guard — halt for human review when this slug is a
  // truncation-prefix of (or extends) an already-published slug. This is the
  // shape of the live duplicate the 2026-06 audit found: two URLs for one
  // article (`…-your-only` and `…-your-only-option`) from run-to-run slug
  // truncation drift. A transient list failure returns null → guard skipped
  // (we never block a publish on an unreadable directory).
  const existingSlugs = await githubListSlugs(ghToken)
  if (existingSlugs) {
    const collision = findSlugPrefixCollision(slug, existingSlugs)
    if (collision) {
      console.error(tag, `slug_prefix_collision with "${collision}"`)
      return res.status(409).json({ error: 'slug_prefix_collision', slug, collidesWith: collision })
    }
  }

  // 2. Build the markdown file content.
  const fileContent = buildMarkdownFile(payload)
  const commitMessage = `feat(blog): publish ${slug}\n\nPushed via the publish webhook from a Bernard Studio workspace.`

  // 3. Commit via Contents API.
  let putResp
  try {
    putResp = await githubPut(ghToken, filePath, fileContent, commitMessage)
  } catch (e) {
    console.error(tag, 'github PUT network error:', e?.message)
    return res.status(502).json({ error: 'github_error', retriable: true })
  }

  let putData = {}
  try { putData = await putResp.json() } catch { /* empty */ }

  if (!putResp.ok) {
    console.error(tag, `github PUT ${putResp.status}:`, JSON.stringify(putData).slice(0, 500))
    if (putResp.status === 401 || putResp.status === 403) {
      return res.status(500).json({ error: 'misconfigured', message: 'The GitHub token lacks contents:write. Update PAT permissions and re-paste.' })
    }
    if (putResp.status === 422) {
      return res.status(409).json({ error: 'slug_taken', slug, message: 'GitHub rejected the file — likely a race condition with another publish. Try again.' })
    }
    return res.status(502).json({ error: 'github_error', retriable: true })
  }

  return res.status(200).json({
    success:   true,
    slug,
    commitUrl: putData?.commit?.html_url || null,
    postUrl:   `https://withbernard.ai/blog/${slug}`,
  })
}
