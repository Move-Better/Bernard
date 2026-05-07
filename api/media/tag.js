import { tagById } from '../_lib/tagAsset.js'

// Manual AI auto-tagging endpoint. POST { id } → vision + transcription via
// the Vercel AI Gateway. The shared logic lives in _lib/tagAsset.js so
// upload.js can call it directly via waitUntil without an HTTP roundtrip.
//
// Runs on Node (Fluid Compute) — same constraint as the rest of the media
// routes. Uses the (req, res) handler shape; req.body is auto-parsed.

export const config = { maxDuration: 120 }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const id = req.body?.id
  if (!id) return res.status(400).json({ error: 'Missing id' })

  try {
    const row = await tagById(id)
    return res.status(200).json(row)
  } catch (e) {
    const msg = e?.message || 'Tagging failed'
    const status = msg === 'Not found' ? 404 : 500
    return res.status(status).json({ error: msg })
  }
}
