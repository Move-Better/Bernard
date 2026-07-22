// T4 learning loop — per-lane (platform) trust metrics: reject-rate and
// edit-rate over a trailing window. "Instrument the metric now even if
// graduation ships later" (see .claude/social-adoption-strategy-2026-07-21.md,
// disease D4 / roadmap T4): this module only COMPUTES the numbers. Nothing
// reads cadence_policy.trust_metrics to actually graduate a lane from
// approve_all to lighter review yet — that's a future consumer, not built here.
//
// Two separate queries (rejected vs. approved-ish), not one combined filter —
// each status family has its own meaningful timestamp (rejected_at vs.
// approved_at), and content_items.updated_at also moves on unrelated writes
// (e.g. a buffer_metrics refresh), which would silently skew the window if
// used as the single filter column.

const DEFAULT_WINDOW_DAYS = 28

/**
 * @param {string} wsId
 * @param {Function} sb — Supabase REST helper: (path, init) => Promise<Response>
 * @param {number} [windowDays]
 * @returns {Promise<{ [platform: string]: { sampleCount: number, rejectRate: number|null, editRate: number|null } }>}
 */
export async function computeTrustMetrics(wsId, sb, windowDays = DEFAULT_WINDOW_DAYS) {
  if (!wsId) return {}
  const since = encodeURIComponent(new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString())

  let rejectedRows = [], decidedRows = []
  try {
    const [rejRes, decRes] = await Promise.all([
      sb(`content_items?workspace_id=eq.${wsId}&status=eq.rejected&rejected_at=gte.${since}&select=platform,edit_diff`),
      sb(`content_items?workspace_id=eq.${wsId}&status=in.(approved,scheduled,published)&approved_at=gte.${since}&select=platform,edit_diff`),
    ])
    rejectedRows = rejRes.ok ? await rejRes.json() : []
    decidedRows = decRes.ok ? await decRes.json() : []
  } catch {
    return {}
  }

  const byPlatform = {} // { platform: { rejected, approved, edited } }
  for (const row of rejectedRows) {
    if (!row.platform) continue
    ;(byPlatform[row.platform] ||= { rejected: 0, approved: 0, edited: 0 }).rejected += 1
  }
  for (const row of decidedRows) {
    if (!row.platform) continue
    const bucket = (byPlatform[row.platform] ||= { rejected: 0, approved: 0, edited: 0 })
    bucket.approved += 1
    if (row.edit_diff?.changed) bucket.edited += 1
  }

  const out = {}
  for (const [platform, b] of Object.entries(byPlatform)) {
    const decided = b.rejected + b.approved
    out[platform] = {
      sampleCount: decided,
      rejectRate: decided > 0 ? Math.round((b.rejected / decided) * 100) / 100 : null,
      editRate: b.approved > 0 ? Math.round((b.edited / b.approved) * 100) / 100 : null,
    }
  }
  return out
}
