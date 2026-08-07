// Sensor for a channel that has gone quiet: published before, is enabled
// with a weekly target, hasn't shipped in SILENCE_THRESHOLD_DAYS+, and has
// finished work (draft/approved) sitting ready. Distinct from two existing
// signals that both measure PLANNING, not PUBLISHING:
//
//  - /week's pace-amber (YourWeek.jsx cadenceChips) measures slots FILLED in
//    the plan this week — a channel fully scheduled reads as healthy even if
//    nothing has actually gone out (.claude/decisions.md 2026-07-22, "known
//    limit, accepted... the latter is a different metric and a different
//    chip" — this is that chip).
//  - approval-escalation.js's findOverdueApprovals measures slots whose
//    SCHEDULED time has passed while still unapproved. It can only see a
//    channel if some atom still exists for it this window — a channel that
//    stopped being planned at all produces no atoms and stays invisible.
//
// This reads published_at directly, so a channel that quietly stops shipping
// is visible even when the plan/atom side looks fine. (2026-08-07 outcome
// review: movebetter's LinkedIn went 9 days silent with 4 ready drafts
// sitting in the queue and nothing flagged it.)
//
// PURE-ish: findSilentChannels takes plain data; fetchSilenceInputs takes an
// `sb` fetcher from the caller (same posture as approvalEscalation.js /
// trustMetrics.js) so each cron/route owns its own credentials and this
// stays unit-testable without a live DB.

export const SILENCE_THRESHOLD_DAYS = 7

/**
 * Which enabled, targeted channels have gone quiet.
 *
 * All four conditions must hold, so a channel that has:
 *  - never launched (no lastPublishedAt)  → never flags, it can't "go quiet"
 *  - nothing ready                        → nothing to act on, not flagged
 *  - published inside the window          → healthy, not flagged
 *  - no target / disabled                 → not a channel we track cadence for
 *
 * @param {{
 *   channels: Record<string, {enabled?: boolean, target_per_week?: number}>,
 *   lastPublishedAt: Record<string, string|null>,   // platform -> ISO or null
 *   readyCounts: Record<string, number>,             // platform -> draft+approved count
 *   now?: Date,
 * }} input
 * @returns {Array<{platform: string, target: number, daysSilent: number, readyCount: number}>}
 *   most-silent first
 */
export function findSilentChannels({ channels, lastPublishedAt, readyCounts, now = new Date() }) {
  const nowMs = now.getTime()
  const out = []
  for (const [platform, cfg] of Object.entries(channels || {})) {
    if (!cfg?.enabled) continue
    const target = cfg.target_per_week || 0
    if (target <= 0) continue
    const lastIso = lastPublishedAt?.[platform]
    if (!lastIso) continue
    const readyCount = readyCounts?.[platform] || 0
    if (readyCount <= 0) continue
    const daysSilent = (nowMs - Date.parse(lastIso)) / 86_400_000
    if (daysSilent < SILENCE_THRESHOLD_DAYS) continue
    out.push({ platform, target, daysSilent: Math.round(daysSilent * 10) / 10, readyCount })
  }
  return out.sort((a, b) => b.daysSilent - a.daysSilent)
}

/**
 * Fetches the two raw ingredients findSilentChannels needs, scoped to only
 * the enabled/targeted platforms (never queries a platform nobody tracks
 * cadence for). Fails soft to empty maps on any read error — a broken sensor
 * must never block /week or the escalation cron from rendering everything
 * else.
 *
 * lastPublishedAt is resolved per-platform (not a single ordered+deduped
 * query) so it stays correct regardless of how many published rows a
 * prolific platform has accumulated — a shared `limit` could otherwise
 * truncate before ever reaching a later platform's group.
 *
 * @param {{ workspaceId: string, sb: Function, channels: Record<string, any> }} input
 * @returns {Promise<{lastPublishedAt: Record<string,string|null>, readyCounts: Record<string,number>}>}
 */
export async function fetchSilenceInputs({ workspaceId, sb, channels }) {
  const platforms = Object.entries(channels || {})
    .filter(([, c]) => c?.enabled && (c.target_per_week || 0) > 0)
    .map(([p]) => p)
  if (!platforms.length) return { lastPublishedAt: {}, readyCounts: {} }

  const [pubEntries, readyRes] = await Promise.all([
    Promise.all(platforms.map(async (p) => {
      const r = await sb(
        `content_items?workspace_id=eq.${workspaceId}&status=eq.published&platform=eq.${encodeURIComponent(p)}` +
        `&select=published_at&order=published_at.desc&limit=1`,
      )
      if (!r.ok) {
        console.error('[publishSilence] published-at fetch failed for', p, ':', r.status)
        return [p, null]
      }
      const rows = await r.json().catch(() => [])
      return [p, rows[0]?.published_at || null]
    })),
    sb(
      `content_items?workspace_id=eq.${workspaceId}&status=in.(draft,approved)` +
      `&platform=in.(${platforms.join(',')})&select=platform&limit=2000`,
    ),
  ])

  const lastPublishedAt = Object.fromEntries(pubEntries)

  const readyCounts = {}
  if (readyRes.ok) {
    for (const row of (await readyRes.json().catch(() => [])) || []) {
      if (row.platform) readyCounts[row.platform] = (readyCounts[row.platform] || 0) + 1
    }
  } else {
    console.error('[publishSilence] ready-count fetch failed:', readyRes.status)
  }

  return { lastPublishedAt, readyCounts }
}

/** Convenience wrapper: fetch + compute in one call for a single workspace. */
export async function computeChannelSilence({ workspaceId, sb, channels, now = new Date() }) {
  const { lastPublishedAt, readyCounts } = await fetchSilenceInputs({ workspaceId, sb, channels })
  return findSilentChannels({ channels, lastPublishedAt, readyCounts, now })
}
