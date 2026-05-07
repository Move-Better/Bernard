import { del as blobDel } from '@vercel/blob'

// Runs on Node (Fluid Compute) — @vercel/blob's server bits aren't edge-safe.
// Uses the (req, res) handler shape; req is IncomingMessage with auto-parsed
// req.body for JSON requests.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function brandId() {
  return (process.env.BRAND || process.env.VITE_BRAND || 'people').toLowerCase()
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

const SELECT = 'id,brand,kind,status,source,blob_url,blob_pathname,rendered_url,drive_id,filename,mime_type,size_bytes,duration_s,aspect_ratio,width,height,thumbnail_url,patient_pseudonym,condition,captured_at,tags,ai_tags,transcription,notes,content_item_ids,created_at,updated_at,created_by'

export default async function handler(req, res) {
  // req.url is a relative path on Node runtime; the base lets URL parse it.
  const url = new URL(req.url, 'http://localhost')
  const id  = url.pathname.split('/').pop()
  if (!id) return res.status(400).json({ error: 'Missing id' })

  // Brand-scope every read & write.
  const where = `id=eq.${id}&brand=eq.${brandId()}`

  if (req.method === 'GET') {
    const r = await sb(`media_assets?${where}&select=${SELECT}`)
    if (!r.ok) return res.status(500).json({ error: 'Database error' })
    const data = await r.json()
    return res.status(200).json(data[0] ?? null)
  }

  if (req.method === 'PATCH') {
    const patch = req.body || {}
    const allowed = {
      status:            patch.status,
      tags:              patch.tags,
      ai_tags:           patch.aiTags,
      notes:             patch.notes,
      patient_pseudonym: patch.patientPseudonym,
      condition:         patch.condition,
      captured_at:       patch.capturedAt,
      transcription:     patch.transcription,
      duration_s:        patch.durationS,
      aspect_ratio:      patch.aspectRatio,
      width:             patch.width,
      height:            patch.height,
      thumbnail_url:     patch.thumbnailUrl,
      rendered_url:      patch.renderedUrl,
      content_item_ids:  patch.contentItemIds,
    }
    const body = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))

    const r = await sb(`media_assets?${where}`, { method: 'PATCH', body: JSON.stringify(body) })
    if (!r.ok) return res.status(500).json({ error: 'Update failed' })
    const data = await r.json()
    return res.status(200).json(data[0] ?? null)
  }

  if (req.method === 'DELETE') {
    // Look up first to get blob_pathname, then delete from Blob, then DB.
    const lookup = await sb(`media_assets?${where}&select=blob_pathname,blob_url`)
    if (!lookup.ok) return res.status(500).json({ error: 'Database error' })
    const rows = await lookup.json()
    const row  = rows[0]
    if (!row) return res.status(404).json({ error: 'Not found' })

    if (row.blob_url) {
      try { await blobDel(row.blob_url) }
      catch (e) { console.error('Blob delete failed:', e.message) }
    }

    const r = await sb(`media_assets?${where}`, { method: 'DELETE' })
    if (!r.ok) return res.status(500).json({ error: 'Delete failed' })
    return res.status(200).json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
