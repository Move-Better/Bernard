// GET /api/content-items/verbatim-quotes?id=<contentItemId>
// Returns the verbatim source lines behind a carousel post — hydrated from the
// piece's provenance blocks against the interview transcript. These are the
// actual words the clinician said that grounded this post, not paraphrases.
// Returns [] gracefully when the piece has no interview source.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

const ok  = (res, data) => res.status(200).json(data)
const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405)
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const id = new URL(req.url, 'http://localhost').searchParams.get('id')
  if (!id || !UUID_RE.test(id)) return err(res, 'Missing or invalid id')

  // 1. Fetch the content item (provenance + interview_id)
  const itemRes = await sb(
    `content_items?id=eq.${id}&workspace_id=eq.${ws.id}&select=id,interview_id,provenance`
  )
  if (!itemRes.ok) return err(res, 'Database error', 500)
  const items = await itemRes.json()
  const item = items[0]
  if (!item) return err(res, 'Content item not found', 404)

  // 2. No interview source — nothing to return
  if (!item.interview_id) return ok(res, { quotes: [] })

  // 3. Fetch interview (we need messages to hydrate spans, + pull_quote_candidates if pre-computed)
  const ivRes = await sb(
    `interviews?id=eq.${item.interview_id}&workspace_id=eq.${ws.id}&select=id,topic,messages,pull_quote_candidates`
  )
  if (!ivRes.ok) return err(res, 'Database error', 500)
  const ivRows = await ivRes.json()
  const iv = ivRows[0]
  if (!iv) return ok(res, { quotes: [] })

  // 4. If the interview already has validated pull_quote_candidates, prefer those —
  //    they were vetted by the pull-quotes endpoint and are ready to use.
  if (Array.isArray(iv.pull_quote_candidates) && iv.pull_quote_candidates.length > 0) {
    return ok(res, { quotes: iv.pull_quote_candidates.slice(0, 6), source: 'pull_quotes' })
  }

  // 5. Hydrate verbatim spans from provenance blocks.
  //    provenance.blocks: [{ source_type, source_msg_index, source_span: [start,end], confidence }]
  const provenance = item.provenance
  if (!provenance?.blocks?.length) return ok(res, { quotes: [] })

  const messages = (iv.messages || []).filter((m) => m.role === 'user')
  const seen = new Set()
  const quotes = []

  for (const block of provenance.blocks) {
    if (block.source_type !== 'verbatim') continue
    if (block.source_msg_index == null || !Array.isArray(block.source_span)) continue

    const msg = messages[block.source_msg_index]
    if (!msg?.content) continue

    const [start, end] = block.source_span
    if (typeof start !== 'number' || typeof end !== 'number' || end <= start) continue

    const text = msg.content.slice(start, end).trim()
    if (text.length < 20 || text.length > 400) continue
    if (seen.has(text)) continue
    seen.add(text)

    quotes.push({
      id: `${block.source_msg_index}-${start}`,
      quote: text,
      confidence: block.confidence ?? null,
      start_offset: start,
      end_offset: end,
    })

    if (quotes.length >= 6) break
  }

  return ok(res, { quotes, source: 'provenance' })
}
