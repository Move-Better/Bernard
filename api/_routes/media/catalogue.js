import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }

// GET /api/media/catalogue — read-only media list for the movebetter.co
// website build (docs/media-library-plan.md, section 3).
//
// Auth: `Authorization: Bearer <MEDIA_CATALOGUE_KEY>` (Sensitive), compared in
// constant time. No Clerk session: the caller is a Claude session / GitHub
// Action in the Movebetterco repo, not a signed-in user.
//
// Tenant wall: the key only works on the hosts listed in CATALOGUE_WORKSPACES,
// so a leaked key can never read another tenant's media. The workspace still
// comes from workspaceScope(req) and every query filters by workspace_id.
// ponytail: the allowlist is hard-coded to Move Better; if a second tenant
// wants a catalogue, move key + allowlist onto workspace_credentials.
//
// Returns non-archived, top-level (parent_id is null) items whose consent is
// not revoked/pending. Patient names are never returned; people = staff only.

import { timingSafeEqual } from 'node:crypto'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'
import { supabaseRest } from '../../_lib/supabaseRest.js'
import { imageMediaType } from '../../_lib/libraryTags.js'

export const CATALOGUE_WORKSPACES = new Set(['movebetter'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const SELECT = 'id,kind,blob_url,web_blob_url,web_width,web_height,width,height,mime_type,size_bytes,duration_s,thumbnail_url,rendered_url,display_title,alt_text,captured_at,tags,ai_tags,staff_id,consent_status,asset_purpose,updated_at'

export function keyMatches(header, secret) {
  if (typeof secret !== 'string' || secret.length < 24) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const provided = Buffer.from(typeof header === 'string' ? header : '')
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

// Shape one media_assets row (+ staff name lookup) into a catalogue item.
export function shapeItem(row, staffById = new Map()) {
  const isVideo = row.kind === 'video'
  const tags = [...new Set([...(row.tags || []), ...(row.ai_tags || [])])]
  const staff = row.staff_id ? staffById.get(row.staff_id) : null
  const useWeb = !isVideo && row.web_blob_url
  return {
    id: row.id,
    kind: row.kind,
    url: isVideo ? (row.rendered_url || row.blob_url) : (row.web_blob_url || row.blob_url),
    original_url: row.blob_url,
    width: useWeb ? row.web_width : row.width,
    height: useWeb ? row.web_height : row.height,
    original_width: row.width,
    original_height: row.height,
    mime: useWeb ? imageMediaType(row.web_blob_url, row.mime_type) : row.mime_type,
    size_bytes: useWeb ? null : row.size_bytes,
    duration_s: isVideo ? row.duration_s : undefined,
    poster_url: isVideo ? (row.thumbnail_url || null) : undefined,
    title: row.display_title || null,
    alt: row.alt_text || null,
    people: staff ? [{ id: staff.id, name: staff.name }] : [],
    taken: row.captured_at ? String(row.captured_at).slice(0, 10) : null,
    purpose: row.asset_purpose || null,
    tags,
    consent: row.consent_status,
    updated_at: row.updated_at,
  }
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const scope = await workspaceScope(req)
  if (!scope) return res.status(404).json({ error: 'no_workspace' })
  if (!CATALOGUE_WORKSPACES.has(scope.workspace?.slug)) return res.status(404).json({ error: 'not_found' })
  if (!keyMatches(req.headers?.authorization, process.env.MEDIA_CATALOGUE_KEY)) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!(await enforceLimit(req, res, 'generic', scope.id))) return

  const sp = new URL(req.url, 'http://localhost').searchParams
  const filters = [
    `${scope.column}=eq.${scope.id}`,
    'archived_at=is.null',
    'parent_id=is.null',
    'consent_status=in.(obtained,not_required)',
    'blob_url=not.is.null',
  ]
  const kind = sp.get('kind')
  if (kind) {
    if (kind !== 'photo' && kind !== 'video') return res.status(400).json({ error: 'invalid_kind' })
    filters.push(`kind=eq.${kind}`)
  }
  for (const t of sp.getAll('tag')) {
    if (!TAG_RE.test(t)) return res.status(400).json({ error: 'invalid_tag' })
    filters.push(`or=(tags.cs.{${t}},ai_tags.cs.{${t}})`)
  }
  const staff = sp.get('staff')
  if (staff) {
    if (!UUID_RE.test(staff)) return res.status(400).json({ error: 'invalid_staff' })
    filters.push(`staff_id=eq.${staff}`)
  }
  const since = sp.get('since')
  if (since) {
    if (!DATE_RE.test(since)) return res.status(400).json({ error: 'invalid_since' })
    filters.push(`updated_at=gte.${since}`)
  }
  const ids = sp.get('ids')
  if (ids) {
    const list = ids.split(',')
    if (list.length > 200 || !list.every((x) => UUID_RE.test(x))) return res.status(400).json({ error: 'invalid_ids' })
    filters.push(`id=in.(${list.join(',')})`)
  }
  const q = sp.get('q')
  if (q) {
    const term = q.replace(/[^a-zA-Z0-9 -]/g, '').trim().slice(0, 60)
    if (term) filters.push(`or=(display_title.ilike.*${term}*,alt_text.ilike.*${term}*)`)
  }
  const limit = Math.min(Math.max(parseInt(sp.get('limit') || '200', 10) || 200, 1), 1000)
  const offset = Math.max(parseInt(sp.get('offset') || '0', 10) || 0, 0)

  try {
    // PostgREST only accepts one `or=` per query string, so combine them.
    const ors = filters.filter((f) => f.startsWith('or=')).map((f) => f.slice(4, -1))
    const ands = filters.filter((f) => !f.startsWith('or='))
    if (ors.length === 1) ands.push(`or=(${ors[0]})`)
    else if (ors.length > 1) ands.push(`and=(${ors.map((o) => `or(${o})`).join(',')})`)

    const r = await supabaseRest(
      `media_assets?select=${SELECT}&${ands.join('&')}&order=captured_at.desc.nullslast,id&limit=${limit}&offset=${offset}`,
    )
    if (!r.ok) {
      console.error('[media/catalogue] list failed:', r.status, await r.text())
      return res.status(500).json({ error: 'list_failed' })
    }
    const rows = await r.json()

    const staffIds = [...new Set(rows.map((x) => x.staff_id).filter(Boolean))]
    const staffById = new Map()
    if (staffIds.length) {
      const s = await supabaseRest(`staff?select=id,name&${scope.column}=eq.${scope.id}&id=in.(${staffIds.join(',')})`)
      if (s.ok) for (const st of await s.json()) staffById.set(st.id, st)
      else console.error('[media/catalogue] staff lookup failed:', s.status)
    }

    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).json({
      generated_at: new Date().toISOString(),
      workspace: scope.workspace.slug,
      count: rows.length,
      limit, offset,
      items: rows.map((row) => shapeItem(row, staffById)),
    })
  } catch (e) {
    console.error('[media/catalogue] failed:', e?.stack || e?.message)
    return res.status(500).json({ error: 'catalogue_failed' })
  }
}

export default withSentry(handler)
