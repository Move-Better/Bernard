// Shared client+server resolution of which workspace_locations a GBP
// content_items row should publish to. Imported directly by api/_lib and
// api/_routes handlers (the established api/ → src/lib one-way import
// pattern — see api/_routes/publish-blog.js) so the client publish path and
// every server-side dispatch path (approve→dispatch, editor Publish, manual
// Retry) resolve the exact same target set and can't drift.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Priority: an explicit human selection (content_items.target_locations, set
// via the location picker in NewBrief/the editor) wins over everything else.
// Next, the Producer's per-location copy (location_overrides) implies its own
// key set was the intended target when drafted. Otherwise return undefined,
// meaning "fan out to every active connected location" — the existing
// resolveBundleGbpTargets/resolveGbpChannelIds default.
export function resolveGbpLocationIds(item) {
  if (Array.isArray(item?.target_locations)) {
    const ids = item.target_locations.filter((id) => UUID_RE.test(String(id)))
    if (ids.length > 0) return ids
  }
  if (item?.location_overrides && typeof item.location_overrides === 'object') {
    const keys = Object.keys(item.location_overrides)
    if (keys.length > 0) return keys
  }
  return undefined
}
