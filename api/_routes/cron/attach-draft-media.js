// GET /api/cron/attach-draft-media  (Vercel cron)
//
// Universal backstop for media auto-attach. The primary weekly compose path
// (content-plan/draft.js) attaches media inline at creation, but there are ~15
// other paths that insert a draft, and per CLAUDE.md's "grep every caller"
// lesson a per-path hook is fragile. This sweep covers ALL of them: it finds
// recent media-less drafts and runs the SAME autoAttachMedia helper the inline
// hook uses, so a draft born media-less anywhere gets its picture within one
// cron interval. It is also the one-time BACKFILL for the drafts that stalled
// before this shipped — hitting it once drains the existing backlog.
//
// It never attaches filler (autoAttachMedia's confidence bar / no-fake-data
// rule), so a no-match draft is simply retried on later runs until it either
// matches (library grew) or ages out via the weekly stale-draft sweep. The
// re-embed of a persistent no-match is cheap (text-embedding-3-small) and
// bounded by MAX_PER_RUN + the LOOKBACK window.
//
// Auth: Bearer CRON_SECRET (same as the other cron handlers).

export const config = { runtime: 'nodejs', maxDuration: 120 }

import { verifyCronSecret } from '../../_lib/auth.js'
import { autoAttachMedia } from '../../_lib/autoAttachMedia.js'
import { isTextOnlyPlatform } from '../../_lib/platformMedia.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Only look back this far: the weekly stale-draft sweep archives older drafts,
// so anything past this either shipped, got attached, or is aging out — no
// point re-embedding it forever.
const LOOKBACK_DAYS = 45
// Cap embedding calls per run so a large backfill can't blow the time budget;
// a big backlog drains over a few runs.
const MAX_PER_RUN = 40

// eslint-disable-next-line bernard/require-workspace-scope -- Cron sweep across all workspaces; autoAttachMedia scopes every query by the candidate row's workspace_id.
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(8_000),
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'unauthorized' })
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase env not configured' })

  // ?dry=1 — compute matches but write nothing. Lets us validate the confidence
  // bar against the real backlog before mutating live drafts (backfill safety).
  const dryRun = /^(1|true)$/i.test(new URL(req.url, 'http://localhost').searchParams.get('dry') || '')

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Fetch recent, non-archived drafts and filter media-emptiness in JS —
  // PostgREST jsonb empty-array matching is awkward and easy to get subtly
  // wrong. Over-fetch modestly, then process up to MAX_PER_RUN eligible ones.
  const candRes = await sb(
    `content_items?status=eq.draft&archived_at=is.null&created_at=gt.${cutoff}` +
      `&order=created_at.desc&limit=300` +
      `&select=id,workspace_id,topic,content,platform,media_urls,slides`,
  )
  if (!candRes.ok) {
    const detail = await candRes.text().catch(() => '')
    console.error(`[attach-draft-media] candidate fetch failed ${candRes.status}: ${detail.slice(0, 200)}`)
    return res.status(500).json({ error: 'candidate_fetch_failed' })
  }
  const rows = await candRes.json()

  const eligible = rows.filter((r) => {
    const media = Array.isArray(r.media_urls) ? r.media_urls : []
    if (media.length > 0) return false
    if (Array.isArray(r.slides) && r.slides.length > 1) return false // carousel path handled elsewhere
    // Skip only text-dominant platforms. NOT `!!mediaKindForDraft` — that
    // returns null for dual-kind social platforms (IG/FB/LinkedIn/GBP), which
    // would wrongly exclude exactly the drafts that stall. autoAttachMedia does
    // the real per-draft gating.
    return !isTextOnlyPlatform(r.platform)
  })

  const batch = eligible.slice(0, MAX_PER_RUN)
  const tally = { dryRun, scanned: rows.length, eligible: eligible.length, processed: batch.length, attached: 0, reasons: {} }
  const samples = []

  // Sequential: each autoAttachMedia does an embedding call + vector search;
  // running them serially keeps well inside the OpenAI/RPC rate envelope and
  // the 120s budget for a batch of 40.
  for (const r of batch) {
    const result = await autoAttachMedia({ ws: { id: r.workspace_id }, draft: r, dryRun })
    tally.reasons[result.reason] = (tally.reasons[result.reason] || 0) + 1
    if (result.attached) tally.attached += 1
    // In dry mode surface per-draft picks so a human can eyeball topic→match→score.
    if (dryRun) {
      samples.push({
        id: r.id,
        platform: r.platform,
        topic: r.topic,
        wouldAttach: result.reason === 'dry',
        score: result.score != null ? Number(result.score.toFixed(3)) : null,
        reason: result.reason,
      })
    }
  }

  console.info(`[attach-draft-media] ${JSON.stringify(tally)}`)
  return res.status(200).json({ ok: true, ...tally, ...(dryRun ? { samples } : {}) })
}
