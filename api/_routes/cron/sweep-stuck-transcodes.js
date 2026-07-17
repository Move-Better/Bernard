// GET /api/cron/sweep-stuck-transcodes  (Vercel cron, every 15 minutes)
//
// Safety-net for the Mux transcode lane. The happy path is entirely webhook-
// driven: video.asset.ready / video.asset.errored flips media_assets.
// transcode_status via api/_routes/webhooks/mux.js. Unlike the render/
// transcription sweeps, there's no in-process worker whose SIGKILL can strand
// a row — the risk here is Mux's webhook never landing at all (wrong/stale
// endpoint URL in the Mux dashboard, a signing-secret mismatch, or a sustained
// outage that outlasts Mux's retry window). Found exactly this on 2026-07-03:
// the registered webhook endpoint pointed at the retired narraterx.ai domain,
// so every video.asset.ready event since 2026-05-20 went nowhere and 123
// videos sat at transcode_status='processing' indefinitely with Mux itself
// long finished.
//
// Rather than guess a terminal state on timeout (the render/seminar sweeps can
// do that because their only source of truth IS the row), this sweep asks Mux
// directly for the asset's real status and applies the same patch the webhook
// would have — so it only ever writes ground truth, never a fabricated
// failure for an asset that's actually fine.
//
// The write is guarded on transcode_status=eq.processing (the cooperative-
// cancel pattern): a row the webhook resolves between the scan and this
// cron's PATCH no longer matches, so we never clobber a webhook's own write.
//
// Auth: Bearer CRON_SECRET (same as the other cron handlers).

export const config = { runtime: 'nodejs' }
import { verifyCronSecret } from '../../_lib/auth.js'
import { getAsset, buildReadyPatchFromMuxAsset } from '../../_lib/muxClient.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Mux's smart-tier encoding finishes well within this even for large 4K
// source — 30 min is generous headroom before we consider a row "stuck"
// enough to be worth an extra Mux API round-trip.
const STUCK_THRESHOLD_MS = 30 * 60 * 1000

// Cap the number of Mux lookups per invocation so a large backlog (or a
// renewed outage) can't blow the function's time budget — the cron re-runs
// every 15 min, so a big backlog drains down over a few runs instead of one.
const MAX_PER_RUN = 50

// eslint-disable-next-line bernard/require-workspace-scope -- Cron — iterates all workspaces; each DB query is scoped by workspace_id from the candidate row
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
  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase env not configured' })
  }

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString()

  const candRes = await sb(
    `media_assets?kind=eq.video&mux_asset_id=not.is.null&transcode_status=eq.processing&updated_at=lt.${cutoff}&select=id,workspace_id,mux_asset_id&limit=${MAX_PER_RUN}`,
  )
  if (!candRes.ok) {
    console.error('[sweep-stuck-transcodes] candidate fetch failed:', candRes.status)
    return res.status(500).json({ error: 'candidate_fetch_failed' })
  }
  const candidates = await candRes.json().catch(() => [])
  if (!candidates.length) return res.status(200).json({ checked: 0, ready: 0, errored: 0, still_processing: 0, mux_errors: 0 })

  const summary = { checked: 0, ready: 0, errored: 0, still_processing: 0, mux_errors: 0 }

  for (const row of candidates) {
    summary.checked++
    let asset
    try {
      asset = await getAsset(row.mux_asset_id)
    } catch (e) {
      console.error(`[sweep-stuck-transcodes] Mux lookup failed for ${row.id}:`, e?.message)
      summary.mux_errors++
      continue
    }

    // Guard every write on transcode_status=eq.processing so a row the
    // webhook resolves between our scan and this write is never clobbered.
    const guardedWhere = `id=eq.${row.id}&workspace_id=eq.${row.workspace_id}&transcode_status=eq.processing`

    if (asset.status === 'ready') {
      const patch = buildReadyPatchFromMuxAsset(asset)
      const r = await sb(`media_assets?${guardedWhere}`, { method: 'PATCH', body: JSON.stringify(patch) })
      if (!r.ok) console.error(`[sweep-stuck-transcodes] patch failed for ${row.id}:`, r.status, await r.text().catch(() => ''))
      else summary.ready++
    } else if (asset.status === 'errored') {
      const r = await sb(`media_assets?${guardedWhere}`, { method: 'PATCH', body: JSON.stringify({ transcode_status: 'errored' }) })
      if (!r.ok) console.error(`[sweep-stuck-transcodes] patch failed for ${row.id}:`, r.status, await r.text().catch(() => ''))
      else summary.errored++
    } else {
      // Genuinely still encoding (or Mux is in some other transient state) —
      // leave it. Mux is the source of truth; we only ever apply what it says.
      summary.still_processing++
    }
  }

  if (summary.ready || summary.errored) {
    console.warn(`[sweep-stuck-transcodes] recovered ${summary.ready} ready + ${summary.errored} errored stuck transcode(s)`)
  }

  return res.status(200).json(summary)
}
