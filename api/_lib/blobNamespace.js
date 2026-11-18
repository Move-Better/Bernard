// Is this URL a Vercel Blob object inside the given workspace's namespace?
//
// Every Bernard blob key carries the workspace id as one path segment
// (media/thumbs/<ws>/…, media/raw/<ws>/…, voice/pre-visit/<ws>/…). The Blob
// store is shared by every tenant, so any client-supplied URL that can later
// reach del() must pass this first (audit 2026-11-18: PATCH /api/media/:id
// stored thumbnailUrl / renderedUrl unchecked, and both are deleted later).
// Encoded dots and slashes are refused outright rather than decoded, so
// `<ws>/%2e%2e/<other>/` cannot climb out of the namespace.
export function isWorkspaceBlobUrl(url, workspaceId) {
  if (!workspaceId || typeof url !== 'string') return false
  let u
  try { u = new URL(url) } catch { return false }
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.blob.vercel-storage.com')) return false
  const path = u.pathname
  if (/%2e|%2f|%5c|\\/i.test(path) || path.includes('//')) return false
  const segments = path.split('/').filter(Boolean)
  if (segments.some((s) => s === '.' || s === '..')) return false
  return segments.slice(0, -1).includes(workspaceId)
}
