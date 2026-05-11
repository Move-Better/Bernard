// Every request carries a short-lived Clerk JWT in the Authorization header.
// requireRole() on the server-side endpoints verifies it and the matching
// workspaceScope() filter on every query keeps tenants isolated. window.Clerk
// is the official browser handle exposed by @clerk/clerk-react.
//
// Same pattern as src/lib/contentLib.js / mediaLib.js / collectionsLib.js — we
// don't depend on Clerk's hooks here so this wrapper stays usable from non-
// component code (e.g. background callers, tests).

async function getClerkToken() {
  if (typeof window === 'undefined') return null
  try {
    return await window.Clerk?.session?.getToken?.()
  } catch {
    return null
  }
}

async function apiFetch(path, init = {}) {
  const token   = await getClerkToken()
  const headers = { ...(init.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

// ── Clinicians ──────────────────────────────────────────────────────────────

export function fetchClinicians() {
  return apiFetch('/api/db/clinicians')
}

export function fetchClinician(id) {
  return apiFetch(`/api/db/clinicians?id=${encodeURIComponent(id)}`)
}

export function getOrCreateClinician({ name, createdById, createdByEmail }) {
  return apiFetch('/api/db/clinicians', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, createdById, createdByEmail }),
  })
}

export function deleteClinician(id, userId) {
  return apiFetch(`/api/db/clinicians?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-user-id': userId },
  })
}

// ── Interviews ───────────────────────────────────────────────────────────────

export function fetchInterview(id) {
  return apiFetch(`/api/db/interviews?id=${encodeURIComponent(id)}`)
}

export function fetchSimilarInterviews(topic, excludeId) {
  const params = new URLSearchParams({ topic, excludeId })
  return apiFetch(`/api/db/interviews?${params}`)
}

export function createInterview({ clinicianId, topic, ownerId, ownerEmail, tone, voiceMode, prototypeId, locationId }) {
  return apiFetch('/api/db/interviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clinicianId, topic, ownerId, ownerEmail, tone, voiceMode, prototypeId, locationId }),
  })
}

export function updateInterview(id, patch, userId) {
  return apiFetch(`/api/db/interviews?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify(patch),
  })
}

export function deleteInterview(id, userId) {
  return apiFetch(`/api/db/interviews?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-user-id': userId },
  })
}

// ── Campaign Settings ────────────────────────────────────────────────────────

export function fetchCampaign() {
  return apiFetch('/api/db/settings')
}

export function updateCampaign(patch, userId) {
  return apiFetch('/api/db/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify(patch),
  })
}
