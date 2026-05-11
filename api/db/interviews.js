// Interviews CRUD endpoint.
//
// Phase 1A security lockdown (2026-05-11): every request requires a verified
// Clerk JWT (Authorization: Bearer …) and every Supabase query is filtered by
// the workspace resolved from the Host header. The legacy `x-user-id` header
// is no longer trusted — userId comes from the verified JWT (req.clerk.userId).

import { requireRole } from '../_lib/auth.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

const SELECT_FIELDS = 'id,clinician_id,topic,status,messages,outputs,owner_id,owner_email,tone,voice_mode,prototype_id,location_id,created_at,updated_at'

export default async function handler(req, res) {
  const auth = await requireRole(req)
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  const userId = auth.userId

  let scope
  try {
    scope = await workspaceScope(req)
  } catch {
    return res.status(404).json({ error: 'workspace-unresolved' })
  }
  const wsFilter = `${scope.column}=eq.${scope.id}`

  const { searchParams } = new URL(req.url, 'http://localhost')
  const id = searchParams.get('id')

  if (req.method === 'GET') {
    if (id) {
      const r = await sb(`interviews?id=eq.${id}&${wsFilter}&select=${SELECT_FIELDS}`)
      if (!r.ok) return res.status(500).json({ error: 'Database error' })
      const data = await r.json()
      return res.status(200).json(data[0] ?? null)
    }

    // Topic search across past completed interviews — workspace-scoped.
    const topic = searchParams.get('topic')
    const excludeId = searchParams.get('excludeId')
    if (!topic) return res.status(400).json({ error: 'Missing id or topic' })

    let qs = `interviews?topic=ilike.${encodeURIComponent(topic)}&status=eq.completed&${wsFilter}`
    qs += `&select=id,topic,messages,created_at,clinicians(name)`
    if (excludeId) qs += `&id=neq.${excludeId}`
    qs += `&order=created_at.desc&limit=3`

    const r = await sb(qs)
    if (!r.ok) return res.status(500).json({ error: 'Database error' })
    return res.status(200).json(await r.json())
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    const { clinicianId, topic, ownerEmail, tone, voiceMode, prototypeId, locationId } = body
    if (!clinicianId) return res.status(400).json({ error: 'Missing clinicianId' })
    if (!topic?.trim()) return res.status(400).json({ error: 'Topic required' })

    // Verify the clinician belongs to this workspace before binding the
    // interview to it. Prevents a caller from creating an interview keyed to
    // another tenant's clinician_id.
    const clinChk = await sb(`clinicians?id=eq.${clinicianId}&${wsFilter}&select=id`)
    if (!clinChk.ok) return res.status(500).json({ error: 'Database error' })
    const clinRows = await clinChk.json()
    if (!clinRows.length) return res.status(404).json({ error: 'Clinician not found' })

    const r = await sb('interviews', {
      method: 'POST',
      body: JSON.stringify({
        [scope.column]: scope.id,
        clinician_id: clinicianId,
        topic: topic.trim(),
        owner_id: userId,
        owner_email: ownerEmail || null,
        status: 'in_progress',
        messages: [],
        tone: tone || 'smart',
        voice_mode: voiceMode === 'personal' ? 'personal' : 'practice',
        prototype_id: prototypeId || null,
        location_id: locationId || null,
      }),
    })
    if (!r.ok) return res.status(500).json({ error: 'Create failed' })
    const data = await r.json()
    return res.status(201).json(data[0])
  }

  if (req.method === 'PATCH') {
    if (!id) return res.status(400).json({ error: 'Missing id' })

    const chk = await sb(`interviews?id=eq.${id}&${wsFilter}&select=owner_id,clinician_id,topic,location_id`)
    if (!chk.ok) return res.status(500).json({ error: 'Database error' })
    const rows = await chk.json()
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    if (rows[0].owner_id !== userId) return res.status(403).json({ error: 'Forbidden' })

    const body = req.body || {}
    const patch = { updated_at: new Date().toISOString() }
    if (body.messages !== undefined) patch.messages = body.messages
    if (body.outputs !== undefined) patch.outputs = body.outputs
    if (body.status !== undefined) patch.status = body.status
    if (body.locationId !== undefined) patch.location_id = body.locationId || null

    const r = await sb(`interviews?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (!r.ok) return res.status(500).json({ error: 'Update failed' })
    const data = await r.json()

    // Auto-create content_items when outputs are saved for the first time.
    if (body.outputs && body.status === 'completed') {
      try {
        const { clinician_id, topic, location_id } = rows[0]

        let clinicianName = ''
        const clinRes = await sb(`clinicians?id=eq.${clinician_id}&${wsFilter}&select=name`)
        if (clinRes.ok) {
          const clinRows = await clinRes.json()
          clinicianName = clinRows[0]?.name ?? ''
        }

        const existsRes = await sb(`content_items?interview_id=eq.${id}&${wsFilter}&select=id&limit=1`)
        const existsRows = existsRes.ok ? await existsRes.json() : []

        if (existsRows.length === 0) {
          const platformMap = [
            { key: 'blogPost',        platform: 'blog' },
            { key: 'instagram',       platform: 'instagram' },
            { key: 'facebook',        platform: 'facebook' },
            { key: 'linkedin',        platform: 'linkedin' },
            { key: 'gbpPost',         platform: 'gbp' },
            { key: 'googleAds',       platform: 'google_ads' },
            { key: 'landingPage',     platform: 'landing_page' },
            { key: 'youtubeScript',   platform: 'youtube' },
            { key: 'tiktokScript',    platform: 'tiktok' },
            { key: 'emailNewsletter', platform: 'email' },
          ]

          const o = body.outputs
          const items = platformMap
            .filter(({ key }) => o[key]?.trim())
            .map(({ key, platform }) => ({
              [scope.column]:  scope.id,
              interview_id:    id,
              clinician_id,
              clinician_name:  clinicianName,
              topic:           topic ?? '',
              platform,
              content:         o[key],
              status:          'draft',
              media_urls:      [],
              location_id:     location_id ?? null,
            }))

          if (items.length > 0) {
            await sb('content_items', {
              method: 'POST',
              body: JSON.stringify(items),
              headers: { Prefer: 'return=minimal' },
            })
          }
        }
      } catch {
        // Non-fatal — interview update already succeeded.
      }
    }

    return res.status(200).json(data[0])
  }

  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'Missing id' })

    const chk = await sb(`interviews?id=eq.${id}&${wsFilter}&select=owner_id`)
    if (!chk.ok) return res.status(500).json({ error: 'Database error' })
    const rows = await chk.json()
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    if (rows[0].owner_id !== userId) return res.status(403).json({ error: 'Forbidden' })

    const pubChk = await sb(`content_items?interview_id=eq.${id}&${wsFilter}&status=eq.published&select=id&limit=1`)
    if (pubChk.ok) {
      const published = await pubChk.json()
      if (published.length > 0) {
        return res.status(409).json({ error: 'This interview has published content and cannot be deleted. Archive the published posts first.' })
      }
    }

    const r = await sb(`interviews?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!r.ok) return res.status(500).json({ error: 'Delete failed' })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
