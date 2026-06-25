// SEO Opportunities feed — the read behind /seo.
//
// Pulls the workspace's Search Console queries (live, 28d) and turns them into:
//   opportunities      — ranked content opportunities (striking-distance,
//                        demand-no-content) via the seoOpportunities engine.
//   websiteSuggestions — ADVISORY on-site technical fixes (schema/meta/title,
//                        plus a GSC-derived click-through suggestion). No
//                        action path — Bernard spots, the tenant fixes.
//   locked             — decay + cannibalization placeholders, unlocked once
//                        the weekly snapshot cron has accrued enough history.
//
// Returns { connected: false } when Search Console isn't configured.
// Node runtime + Express-style (req, res).
export const config = { runtime: 'nodejs' }

import { workspaceContext }   from '../../_lib/workspaceContext.js'
import { requireRole }        from '../../_lib/auth.js'
import { enforceLimit }       from '../../_lib/ratelimit.js'
import { decryptSecret }      from '../../_lib/credentialCrypto.js'
import { fetchSearchQueries } from '../../_lib/searchConsole.js'
import { classifyOpportunities, gscClickThroughSuggestion } from '../../_lib/seoOpportunities.js'
import { fetchAndAuditHomepage } from '../../_lib/onPageAudit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Two distinct snapshot weeks unlock week-over-week decay/cannibalization.
const MIN_SNAPSHOT_WEEKS = 2

// A static best-practice the on-page fetch can't infer: internal linking.
const INTERNAL_LINK_SUGGESTION = {
  sev:    'low',
  source: 'Internal links',
  title:  'Link new blog posts to your booking & services pages',
  why:    'Posts that link to “book an appointment” and key service pages pass authority to the pages that convert — and give readers an obvious next step.',
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'seo-opportunities'))) return

  if (!ws.gsc_site_url) return res.status(200).json({ connected: false })

  // Search Console credential.
  const credRes = await sb(
    `workspace_credentials?workspace_id=eq.${ws.id}&service=eq.searchconsole&status=eq.active` +
    `&select=secret_ciphertext,config&limit=1`
  )
  if (!credRes.ok) return res.status(200).json({ connected: false, error: 'credential_fetch_failed' })
  const credRows = await credRes.json().catch(() => [])
  const credRow  = credRows?.[0]
  if (!credRow?.secret_ciphertext) return res.status(200).json({ connected: false })

  let secret
  try { secret = decryptSecret(credRow.secret_ciphertext) }
  catch { return res.status(200).json({ connected: false, error: 'credential_decrypt_failed' }) }
  const credential = { secret, config: credRow.config || {} }

  // Published topics (for hasPost matching) + dismissed queries + snapshot-week
  // count, in parallel — none depend on the GSC fetch.
  const [topicRows, dismissRows, snapWeeks] = await Promise.all([
    sb(`content_items?workspace_id=eq.${ws.id}&status=eq.published&topic=not.is.null&select=topic&limit=200`)
      .then((r) => (r.ok ? r.json().catch(() => []) : [])),
    sb(`seo_opportunity_dismissals?workspace_id=eq.${ws.id}&select=query`)
      .then((r) => (r.ok ? r.json().catch(() => []) : [])),
    sb(`gsc_query_snapshots?workspace_id=eq.${ws.id}&select=captured_at&order=captured_at.desc&limit=400`)
      .then((r) => (r.ok ? r.json().catch(() => []) : [])),
  ])
  const topics    = (topicRows || []).map((r) => r.topic).filter(Boolean)
  const dismissed = new Set((dismissRows || []).map((r) => r.query).filter(Boolean))
  const distinctWeeks = new Set(
    (snapWeeks || []).map((r) => String(r.captured_at || '').slice(0, 10))
  ).size

  // Live GSC queries.
  let queries
  try {
    queries = await fetchSearchQueries({ credential, siteUrl: ws.gsc_site_url, rowLimit: 200 })
  } catch (e) {
    console.error('[seo/opportunities]', e?.message)
    return res.status(200).json({ connected: true, error: 'gsc_fetch_failed' })
  }

  const opportunities = classifyOpportunities(queries, { topics, dismissed, limit: 12 })

  // Website suggestions: GSC click-through + on-page homepage audit + the static
  // internal-link nudge. The homepage fetch is best-effort and never blocks the
  // content opportunities.
  const websiteSuggestions = []
  const ctSuggestion = gscClickThroughSuggestion(queries)
  if (ctSuggestion) websiteSuggestions.push(ctSuggestion)
  try {
    const audit = await fetchAndAuditHomepage(ws.gsc_site_url)
    if (audit.suggestions?.length) websiteSuggestions.push(...audit.suggestions)
  } catch (e) {
    console.error('[seo/opportunities] on-page audit failed:', e?.message)
  }
  websiteSuggestions.push(INTERNAL_LINK_SUGGESTION)

  // Severity-ordered (high → low) so the most worthwhile lands first.
  const sevRank = { high: 0, med: 1, low: 2 }
  websiteSuggestions.sort((a, b) => (sevRank[a.sev] ?? 3) - (sevRank[b.sev] ?? 3))

  const summary = {
    open:          opportunities.length,
    strikingDistance: opportunities.filter((o) => o.type === 'striking_distance').length,
    demandNoContent:  opportunities.filter((o) => o.type === 'demand_no_content').length,
  }

  const historyReady = distinctWeeks >= MIN_SNAPSHOT_WEEKS

  return res.status(200).json({
    connected: true,
    opportunities,
    summary,
    websiteSuggestions,
    snapshotWeeks: distinctWeeks,
    locked: {
      // Decay + cannibalization need week-over-week history. Surfaced as locked
      // placeholders until the weekly snapshot cron has accrued enough weeks.
      decay:           { ready: historyReady },
      cannibalization: { ready: historyReady },
    },
  })
}
