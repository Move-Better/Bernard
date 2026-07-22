// Insights — website page-health check (no GA4 required).
//
// Fetches each of this workspace's published website/blog posts (by their stored
// resolved_url) and reports any that don't load. A "published" post that returns
// a 4xx/5xx or won't connect is a real, unambiguous problem readers hit — worth
// surfacing in the Insights "Tune up the website" section.
//
// Deliberately conservative: it ONLY flags genuine load failures. It does NOT
// guess at softer issues (missing CTA, meta quality) — on real, well-built sites
// those checks cry wolf (the booking CTA lives in site nav on every page, etc.).
// The substantive "is the page landing/converting well?" reads need GA4 and light
// up there. No fabricated findings: if every page loads, we say so.
//
// Node runtime + Express-style (req,res) — a Web-style handler hangs on Vercel's
// Node runtime. Mirrors api/db/workspace-recap.js.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const MAX_PAGES = 15      // bound the fan-out of outbound fetches per request
const FETCH_TIMEOUT = 7000

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

// Fetch one page and classify it. Returns { ok, status, reason }.
// `ok` true = the page loads for a reader; false = a real problem to surface.
async function checkPage(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Bernard-InsightsBot/1.0 (+https://withbernard.ai)' },
    })
    // Drain/ignore the body — we only need the status. Cancel to free the socket.
    try { await r.body?.cancel() } catch { /* noop */ }
    if (r.status >= 400) return { ok: false, status: r.status, reason: 'http_error' }
    return { ok: true, status: r.status, reason: null }
  } catch (e) {
    const reason = e?.name === 'AbortError' ? 'timeout' : 'unreachable'
    return { ok: false, status: 0, reason }
  } finally {
    clearTimeout(timer)
  }
}

// Human-readable issue copy for a failed page.
function describe(reason, status) {
  if (reason === 'timeout') return 'This published post took too long to load — readers may give up before it opens.'
  if (reason === 'unreachable') return "This published post wouldn't load at all — the link may be broken or the page was removed."
  if (reason === 'http_error') return `This published post returns an error (HTTP ${status}) — readers can't see it. Check the link or re-publish.`
  return 'This published post did not load correctly.'
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'insights-website-health', ws.id))) return

  // Published website/blog posts for THIS workspace that have a live URL.
  // platform=eq.blog is load-bearing, not decoration: resolved_url now also
  // holds the Instagram/Facebook permalink of a published social post (the
  // publish receipt), and without this filter every social post would be
  // fetched and reported on as if it were a page on the clinic's website.
  const sel =
    `content_items?workspace_id=eq.${ws.id}&platform=eq.blog` +
    `&status=eq.published&resolved_url=not.is.null` +
    `&select=id,topic,platform,resolved_url,published_at` +
    `&order=published_at.desc.nullslast&limit=${MAX_PAGES}`
  const r = await sb(sel)
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    console.error(`[insights/website-health] supabase ${r.status}: ${body.slice(0, 400)}`)
    return res.status(500).json({ error: 'Database error' })
  }
  const rows = await r.json()

  // Only http(s) URLs (defensive — resolved_url comes from our own publish path).
  const pages = (rows || []).filter((row) => /^https?:\/\//i.test(row.resolved_url || ''))

  const results = await Promise.all(
    pages.map(async (row) => {
      const verdict = await checkPage(row.resolved_url)
      return { row, verdict }
    }),
  )

  const issues = results
    .filter((x) => !x.verdict.ok)
    .map((x) => ({
      contentItemId: x.row.id,
      topic: x.row.topic || 'Untitled',
      url: x.row.resolved_url,
      status: x.verdict.status,
      reason: x.verdict.reason,
      issue: describe(x.verdict.reason, x.verdict.status),
    }))

  return res.status(200).json({
    checked: pages.length,
    healthy: pages.length - issues.length,
    issues,
    checkedAt: new Date().toISOString(),
  })
}
