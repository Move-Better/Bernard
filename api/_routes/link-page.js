// Public "link in bio" page data — GET /api/link-page, resolved by subdomain
// (movebetter.withbernard.ai/link → this workspace). No auth: this is the
// endpoint an Instagram/TikTok visitor's browser hits after tapping the bio
// link, same trust level as the sign-in branding endpoint.
//
// Exists so "link in bio" CTAs in atom captions (atomPrompts.js) are true
// claims rather than fabricated ones — see hasPublishedBlogArticle() in
// blogLinkStatus.js, which gates whether a caption is allowed to say it at
// all. This endpoint is the other half: what the link actually resolves to.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const MAX_POSTS = 10
const FALLBACK_ACCENT = '#0a7f3f'

// Same contrast heuristic as src/lib/textCard.js hexLuminance() — kept as a
// small server-side copy rather than importing client code into an API
// handler. Decides whether the accent color needs light or dark text on top.
function hexLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return 0
  const n = parseInt(m[1], 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no-workspace-context' })

  if (!(await enforceLimit(req, res, 'link-page', ws.id))) return

  const r = await sb(
    `content_items?workspace_id=eq.${ws.id}&platform=eq.blog&status=eq.published` +
    `&resolved_url=not.is.null&select=id,topic,resolved_url,published_at` +
    `&order=published_at.desc.nullslast&limit=${MAX_POSTS}`,
  )
  if (!r.ok) {
    console.error('[link-page] content_items fetch failed:', r.status)
    return res.status(500).json({ error: 'database_error' })
  }
  const rows = await r.json().catch(() => [])
  const posts = (Array.isArray(rows) ? rows : []).map((row) => ({
    title:       row.topic || 'Read the full article',
    url:         row.resolved_url,
    publishedAt: row.published_at,
  }))

  // Real Brand Kit logo (a blob URL), not workspaces.logo — that column holds
  // relative paths (e.g. "/logo.svg") left over from the pre-multitenant
  // filesystem-overlay era and doesn't resolve to anything on a public page.
  // Same lookup as api/_routes/workspace/me.js.
  let logo = null
  try {
    const lr = await sb(
      `brand_kit_roles?workspace_id=eq.${ws.id}&role=eq.primary_logo&select=brand_assets(blob_url)&limit=1`
    )
    if (lr.ok) {
      const lrows = await lr.json().catch(() => [])
      logo = lrows?.[0]?.brand_assets?.blob_url || null
    }
  } catch (e) {
    console.error('[link-page] primary_logo fetch failed:', e?.message)
  }

  // Tenant brand color, not Bernard's own app color — the page is what the
  // clinic's own audience lands on from their Instagram/TikTok bio, so it
  // must look like the clinic's brand, not Bernard's. Same field + fallback
  // convention as api/_lib/brandRender.js / src/lib/overlayTemplates.js.
  const accentColor = ws.brand_style?.accent_color || FALLBACK_ACCENT
  const accentIsLight = hexLuminance(accentColor) > 0.62

  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  return res.status(200).json({
    displayName: ws.display_name,
    logo,
    accentColor,
    accentIsLight,
    bookingUrl:  ws.booking_url || ws.website || null,
    website:     ws.website || null,
    posts,
  })
}

export default handler
