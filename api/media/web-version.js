import { withSentry } from '../_lib/sentry.js'
import { workspaceScope } from '../_lib/workspaceScope.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { supabaseRest } from '../_lib/supabaseRest.js'
import { keyMatches, CATALOGUE_WORKSPACES } from '../_routes/media/catalogue.js'
import { makeWebVideo, webVideoStatus, MAX_WEB_VIDEO_SECONDS } from '../_lib/webVideo.js'

// POST /api/media/web-version { id } — make (or return) the web MP4 + poster
// for one catalogue video, for the movebetter.co website session
// (docs/media-library-plan.md, phase 4). Same key and host allowlist as
// /api/media/catalogue. Synchronous: the caller waits (up to ~5 min) and gets
// the URLs back; a second call for a ready video returns at once.

export const config = { runtime: 'nodejs', maxDuration: 300 }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const scope = await workspaceScope(req)
  if (!scope) return res.status(404).json({ error: 'no_workspace' })
  if (!CATALOGUE_WORKSPACES.has(scope.workspace?.slug)) return res.status(404).json({ error: 'not_found' })
  if (!keyMatches(req.headers?.authorization, process.env.MEDIA_CATALOGUE_KEY)) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!(await enforceLimit(req, res, 'media', scope.id))) return

  const id = req.body?.id
  if (typeof id !== 'string' || !UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

  try {
    const r = await supabaseRest(`media_assets?id=eq.${id}&${scope.column}=eq.${scope.id}&archived_at=is.null&consent_status=in.(obtained,not_required)&select=id,kind,blob_url,web_blob_url,web_width,web_height,thumbnail_url,duration_s`)
    if (!r.ok) {
      console.error('[media/web-version] lookup failed:', r.status)
      return res.status(500).json({ error: 'lookup_failed' })
    }
    const asset = (await r.json())[0]
    if (!asset) return res.status(404).json({ error: 'not_found' })

    const status = webVideoStatus(asset)
    if (status === 'not_video') return res.status(422).json({ error: 'not_video' })
    if (status === 'too_long') return res.status(422).json({ error: 'too_long', max_seconds: MAX_WEB_VIDEO_SECONDS })
    if (status === 'ready') {
      return res.status(200).json({ id, status: 'ready', url: asset.web_blob_url, width: asset.web_width, height: asset.web_height, poster_url: asset.thumbnail_url })
    }

    const out = await makeWebVideo({ asset, ws: scope.workspace })
    return res.status(200).json({ id, status: 'created', url: out.web_blob_url, width: out.web_width, height: out.web_height, poster_url: asset.thumbnail_url || out.poster_url, size_bytes: out.size_bytes })
  } catch (e) {
    console.error('[media/web-version] failed:', e?.stack || e?.message)
    return res.status(500).json({ error: 'encode_failed' })
  }
}

export default withSentry(handler)
