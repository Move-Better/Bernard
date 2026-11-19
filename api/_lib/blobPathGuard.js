// Client-upload pathname check, shared by every handleUpload lane.
//
// The pathname in onBeforeGenerateToken is client-controlled, and each lane
// pinned it with a bare startsWith(prefix). That accepts traversal such as
// `music/<ws>/../<other ws>/x`, which a URL resolver normalises into another
// workspace's namespace (audit 2026-11-18, P2). A path is accepted only when it
// starts with one of the prefixes AND has no `.`/`..` segment, empty segment,
// backslash, percent-encoding or control character.
export function isPathInNamespace(pathname, prefixes) {
  if (typeof pathname !== 'string' || pathname.length === 0 || pathname.length > 1024) return false
  // eslint-disable-next-line no-control-regex
  if (/[\\%\u0000-\u001f\u007f]/.test(pathname)) return false
  const segments = pathname.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false
  const list = Array.isArray(prefixes) ? prefixes : [prefixes]
  return list.some((p) => typeof p === 'string' && p.endsWith('/') && pathname.startsWith(p))
}
