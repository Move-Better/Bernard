// Client-side helpers for content_pieces (a.k.a. "edit briefs"). Each piece
// is a draft post candidate surfaced from a source media row by the AI
// segmenter, OR created manually by an editor as a backdoor override.
//
// Every request carries a short-lived Clerk JWT in the Authorization header.
// requireRole() on the server-side endpoints verifies it and enforces
// per-method role rules. window.Clerk is the official browser handle exposed
// by @clerk/clerk-react.

async function getClerkToken() {
  if (typeof window === 'undefined') return null
  try {
    return await window.Clerk?.session?.getToken?.()
  } catch {
    return null
  }
}

async function api(path, init = {}) {
  const token   = await getClerkToken()
  const headers = { ...(init.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  const res  = await fetch(path, { ...init, headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`)
  return json
}

export function listContentPieces({ status, platform, sourceId, assignedTo, limit, offset } = {}) {
  const params = new URLSearchParams()
  if (status)     params.set('status', status)
  if (platform)   params.set('platform', platform)
  if (sourceId)   params.set('sourceId', sourceId)
  if (assignedTo) params.set('assignedTo', assignedTo)
  if (limit)      params.set('limit', String(limit))
  if (offset)     params.set('offset', String(offset))
  const qs = params.toString()
  return api(`/api/content-pieces/list${qs ? `?${qs}` : ''}`)
}

export function getContentPiece(id) {
  return api(`/api/content-pieces/${encodeURIComponent(id)}`)
}

export function updateContentPiece(id, patch) {
  return api(`/api/content-pieces/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteContentPiece(id) {
  return api(`/api/content-pieces/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function createContentPiece(payload) {
  return api(`/api/content-pieces/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

// Trigger the AI segmenter manually for an existing tagged source asset.
export function segmentMediaAsset(id) {
  return api(`/api/media/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

// Source-clip handoff for the editor: signed URL + trim timestamps + AI
// reasoning so they can scrub to the moment in CapCut/Opus Clip.
export function getContentPieceClip(id) {
  return api(`/api/content-pieces/${encodeURIComponent(id)}/download-clip`)
}

// Publish dispatcher.
//
// Two response shapes: JSON for API publishes (gbp / newsletter), and a
// streaming ZIP for download-bundle targets (reels / feed / story / shorts /
// tiktok). The caller passes the target_platform via the brief itself; we
// inspect the response Content-Type to decide whether to parse JSON or
// trigger a browser download.
//
// Consent gate: if the source involves a patient (patient_pseudonym set or
// speaker_role='patient_guest'), the server returns 400 with
// { error: 'consent-required', requiresConsentConfirmation: true }. The
// caller then shows a dialog and re-invokes with { consentConfirmed: true }.
export async function publishContentPiece(id, { consentConfirmed = false } = {}) {
  const token = await getClerkToken()
  const res = await fetch(`/api/content-pieces/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ consentConfirmed }),
  })

  const ct = res.headers.get('content-type') || ''

  if (ct.includes('application/zip')) {
    if (!res.ok) {
      // Servers should never send 4xx with a ZIP body, but be defensive.
      throw new Error(`Publish failed: ${res.status}`)
    }
    const blob = await res.blob()
    const filename = filenameFromDisposition(res.headers.get('content-disposition'))
                    || `narraterx-bundle-${Date.now()}.zip`
    triggerDownload(blob, filename)
    return { kind: 'bundle', filename, ok: true }
  }

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = new Error(json.error || json.message || `Publish failed: ${res.status}`)
    e.code = json.error
    e.requiresConsentConfirmation = !!json.requiresConsentConfirmation
    e.details = json
    throw e
  }
  return { kind: 'api', ok: true, ...json }
}

function filenameFromDisposition(header) {
  if (!header) return null
  // Prefer RFC 5987 filename* if present; fall back to filename=.
  const star = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
  if (star) {
    try { return decodeURIComponent(star[1].replace(/^"|"$/g, '')) } catch {}
  }
  const plain = header.match(/filename="?([^"]+)"?/i)
  return plain ? plain[1] : null
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Slight delay before revoke — Safari sometimes drops the download if the
  // URL is revoked too aggressively.
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
