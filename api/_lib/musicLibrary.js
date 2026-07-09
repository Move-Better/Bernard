// Music library (WS3.3-P2) — DB-backed (public.music_tracks), tenant-manageable.
//
// Rows with workspace_id IS NULL are the SHARED library (curated royalty-free
// starter set every workspace gets). Rows with a workspace_id are that tenant's
// own uploads (managed in Settings → Music, admins only).
//
// SECURITY: resolveMusicTrack() only returns a track that is shared OR owned by
// the caller's workspace, so the render route can never mix in another tenant's
// uploaded track. The render route resolves a client-supplied trackId → trusted
// blob_url through here (never trusts a raw URL from the client).

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

export const MUSIC_MOODS = ['calm', 'upbeat', 'warm', 'cinematic']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!res.ok) {
    console.error('[musicLibrary] supabase error:', res.status, (await res.text()).slice(0, 200))
    return null
  }
  return res.json()
}

const SELECT = 'id,workspace_id,title,mood,blob_url,duration_sec'

// The shared library + this workspace's own tracks — shared first, then newest.
export async function listMusicTracks(workspaceId) {
  const ws = UUID_RE.test(String(workspaceId || '')) ? workspaceId : null
  const filter = ws
    ? `or=(workspace_id.is.null,workspace_id.eq.${ws})`
    : 'workspace_id.is.null'
  const rows = await sb(`music_tracks?select=${SELECT}&${filter}&order=workspace_id.asc.nullsfirst,created_at.desc`)
  if (!rows) return []
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    mood: r.mood,
    url: r.blob_url,
    durationSec: r.duration_sec,
    shared: r.workspace_id == null,
  }))
}

// Resolve a client-supplied track id to its trusted row — ONLY if it is shared
// or owned by the caller's workspace. Returns null otherwise (no cross-tenant use).
export async function resolveMusicTrack(id, workspaceId) {
  if (!UUID_RE.test(String(id || ''))) return null
  const ws = UUID_RE.test(String(workspaceId || '')) ? workspaceId : null
  const filter = ws
    ? `or=(workspace_id.is.null,workspace_id.eq.${ws})`
    : 'workspace_id.is.null'
  const rows = await sb(`music_tracks?select=${SELECT}&id=eq.${id}&${filter}&limit=1`)
  const r = rows?.[0]
  if (!r) return null
  return { id: r.id, title: r.title, mood: r.mood, url: r.blob_url, durationSec: r.duration_sec }
}
