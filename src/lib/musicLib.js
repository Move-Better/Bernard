// Client helpers for the workspace music library (WS3.3-P2). The picker + the
// Settings → Music panel both read the list; the panel uploads/edits/deletes a
// workspace's OWN tracks (admins only, enforced server-side).

import { upload } from '@vercel/blob/client'
import { apiFetch } from '@/lib/api'

async function getClerkToken() {
  if (typeof window === 'undefined') return null
  try { return await window.Clerk?.session?.getToken?.() } catch { return null }
}

// Shared library + this workspace's own tracks → { tracks:[{id,title,mood,url,durationSec,shared}], moods:[] }
export function getMusicTracks() {
  return apiFetch('/api/editorial/music-tracks')
}

// Probe an audio file's duration (seconds) in the browser before upload.
function probeDuration(file) {
  return new Promise((resolve) => {
    const a = document.createElement('audio')
    a.preload = 'metadata'
    a.onloadedmetadata = () => { URL.revokeObjectURL(a.src); resolve(Number.isFinite(a.duration) ? Math.round(a.duration) : null) }
    a.onerror = () => { URL.revokeObjectURL(a.src); resolve(null) }
    a.src = URL.createObjectURL(file)
  })
}

// Two-phase Vercel Blob client upload → /api/music/upload (inserts the row on
// completion). The pathname is workspace-scoped to match the server's
// allowedPathPrefixes (music/<wsId>/). Returns the @vercel/blob Blob.
export async function uploadMusicTrack(file, { workspaceId, title, mood, uploadedBy, onProgress } = {}) {
  if (!workspaceId) throw new Error('workspaceId required')
  const durationSec = await probeDuration(file)
  const token = await getClerkToken()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const base = (title || file.name.replace(/\.[^.]+$/, '')).replace(/[^a-z0-9-_]+/gi, '-').toLowerCase().slice(0, 40) || 'track'
  const pathname = `music/${workspaceId}/${stamp}-${base}.mp3`
  return await upload(pathname, file, {
    access: 'public',
    handleUploadUrl: '/api/music/upload',
    contentType: 'audio/mpeg',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    onUploadProgress: typeof onProgress === 'function' ? (e) => onProgress(e) : undefined,
    clientPayload: JSON.stringify({ title: title || file.name, mood, durationSec, uploadedBy: uploadedBy || null }),
  })
}

export function updateMusicTrack(id, patch) {
  return apiFetch(`/api/music/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  })
}

export function deleteMusicTrack(id) {
  return apiFetch(`/api/music/${id}`, { method: 'DELETE' })
}
