// Resolve a workspace's Google-Business fan-out targets for bundle.social.
//
// A GBP post fans out across each active location that has its own connected
// bundle Team (bundle allows one active GBP per Team, so each location connects
// through its OWN per-location Team — see memory/project-bundle-social.md).
// Returns { id: workspace_locations.id, label, teamId: bundle_team_id }[].
// Only active locations with a connected Team are targeted; optionally narrowed
// to an explicit locationIds set (validated UUIDs).
//
// Extracted from api/_routes/publish/social.js so the client publish path and
// the server-side approve→dispatch path (api/_lib/dispatchContentItem.js) share
// one source of truth for location resolution and can't drift.

import { isVideoEntry } from '../../../src/lib/mediaEntry.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function resolveBundleGbpTargets(workspaceId, locationIds) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !workspaceId) return []
  const params = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    status: 'eq.active',
    bundle_team_id: 'not.is.null',
    select: 'id,label,bundle_team_id',
  })
  if (Array.isArray(locationIds) && locationIds.length > 0) {
    // bare values inside in.() — quoted strings match zero rows (PostgREST gotcha)
    const ids = locationIds.filter((id) => UUID_RE.test(String(id)))
    if (ids.length === 0) return []
    params.set('id', `in.(${ids.join(',')})`)
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_locations?${params.toString()}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!r.ok) return []
  const rows = await r.json().catch(() => [])
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => typeof row.bundle_team_id === 'string' && row.bundle_team_id.trim())
    .map((row) => ({ id: row.id, label: row.label, teamId: row.bundle_team_id }))
}

// The media a Google Business post can carry: at most ONE image, no video.
// bundle.social's own limits table says GOOGLE_BUSINESS takes "0-1 image only
// (no video)" (https://info.bundle.social/api-reference/limits, checked
// 2026-11-19), so a multi-image post is outside what the API accepts. Every GBP
// dispatch path (runBundlePublish in publish/social.js, dispatchContentItem.js)
// sends exactly this, so the editor's Publish button and /week's Approve can't
// send different media for the same piece. Prefers the first image over a
// video, so a piece that carries both still posts its photo.
export function gbpMedia(mediaUrls) {
  const list = Array.isArray(mediaUrls) ? mediaUrls.filter(Boolean) : []
  const pick = list.find((m) => !isVideoEntry(m)) || list[0]
  return pick ? [pick] : []
}
