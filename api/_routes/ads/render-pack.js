// POST /api/ads/render-pack
//
// Ad-creative export (Phase 1). Re-renders a source photo into a set of ad
// aspect ratios (1:1 / 4:5 / 9:16 / 16:9) and returns the uploaded JPEG URLs so
// the client can download the pack. Read-only against the source asset: unlike
// /api/editorial/compose-photo, this NEVER writes back to content_items — the
// ad export is derived output, the source piece is untouched.
//
// Body:
//   { sourceUrl: string,                       // public blob URL of the photo
//     aspects?: string[],                       // subset of 1:1,4:5,9:16,16:9
//     treatment?: { headline, accentText, grade, ... },  // optional editorial bake
//     templateId?: string }                     // 'editorial' | WHOOP id
//
// When a treatment with a headline (or a WHOOP templateId) is supplied, the full
// editorial/WHOOP overlay is baked; otherwise the photo is a plain subject-aware
// crop + brand grade (the common Library-export case).
//
// Auth: Clerk JWT + workspace org-id check + EDITOR_ROLES.
// Response 200: { files: [{ aspect, url, width, height }] }

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { randomUUID } from 'node:crypto'
import { put as blobPut } from '@vercel/blob'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { renderAdPhoto, renderEditorialPhoto } from '../../_lib/brandRender.js'
import { renderWhoopPhoto, WHOOP_TEMPLATE_IDS } from '../../_lib/whoopTemplates.js'

const ALLOWED_ASPECTS = ['1:1', '4:5', '9:16', '16:9']

// SSRF guard: the renderer fetches sourceUrl server-side, so only allow our own
// Vercel Blob host. Blocks a client from pointing the export at an internal URL.
function isAllowedSource(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname.endsWith('.blob.vercel-storage.com')
  } catch {
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  const body = req.body || {}
  const sourceUrl = String(body.sourceUrl || '').trim()
  if (!sourceUrl) return res.status(400).json({ error: 'sourceUrl_required' })
  if (!isAllowedSource(sourceUrl)) return res.status(400).json({ error: 'invalid_source' })

  // Validate the requested aspects against the allowlist; default to all four.
  const requested = Array.isArray(body.aspects) && body.aspects.length
    ? body.aspects.filter((a) => ALLOWED_ASPECTS.includes(a))
    : ALLOWED_ASPECTS
  if (!requested.length) return res.status(400).json({ error: 'no_valid_aspects' })

  const treatment = (body.treatment && typeof body.treatment === 'object') ? body.treatment : {}
  const templateId = String(body.templateId || 'editorial')
  const isWhoop = WHOOP_TEMPLATE_IDS.includes(templateId)
  // Bake the editorial/WHOOP overlay only when there's real content to bake;
  // a bare Library photo exports as a clean crop with no furniture.
  const hasTreatment = isWhoop || !!String(treatment.headline || '').trim()

  const files = []
  try {
    for (const aspect of requested) {
      const fullTreatment = { ...treatment, aspect, sourceUrl }
      let render
      if (hasTreatment) {
        render = isWhoop
          ? await renderWhoopPhoto({ photoUrl: sourceUrl, treatment: fullTreatment, workspace: ws, staffName: '' })
          : await renderEditorialPhoto({ photoUrl: sourceUrl, treatment: fullTreatment, workspace: ws, staffName: '' })
      } else {
        render = await renderAdPhoto({ photoUrl: sourceUrl, aspect, grade: treatment.grade })
      }

      const slug = aspect.replace(':', 'x')
      const pathname = `media/ads/${ws.id}/${randomUUID()}-${slug}.jpg`
      const blob = await blobPut(pathname, render.buffer, {
        access: 'public',
        contentType: 'image/jpeg',
        addRandomSuffix: false,
        allowOverwrite: true,
      })
      files.push({ aspect, url: blob.url, width: render.width, height: render.height })
    }
  } catch (e) {
    console.error('[ads/render-pack] render failed:', e?.stack || e?.message || e)
    return res.status(500).json({ error: 'render_failed', message: e?.message || 'unknown' })
  }

  return res.status(200).json({ files })
}
