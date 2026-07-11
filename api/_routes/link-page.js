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

  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  return res.status(200).json({
    displayName: ws.display_name,
    logo:        ws.logo || null,
    bookingUrl:  ws.booking_url || ws.website || null,
    website:     ws.website || null,
    posts,
  })
}

export default handler
