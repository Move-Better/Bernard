// POST /api/content-items/slide-hook  { caption, platform? }  →  { hook }
//
// Generates a short (≤8-word) attention-drawing overlay hook for slide 1 of a
// carousel, from the caption the author is looking at. Replaces the old
// "Use as slide hook" button's verbatim first-line copy — the button now asks
// this endpoint for a real hook and only falls back to the first line if the
// model can't produce one within the limit (hook === null).
//
// The caption is sent from the client rather than loaded by id so the hook
// reflects UNSAVED edits in the caption box. Stateless: no DB write, so no
// cache to invalidate and nothing to reset.

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { generateSlideHook } from '../../_lib/headlineGen.js'

const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  const { caption, platform } = req.body || {}
  if (typeof caption !== 'string' || !caption.trim()) return err(res, 'Missing caption')

  try {
    const hook = await generateSlideHook({
      caption,
      platform: typeof platform === 'string' ? platform : '',
      workspace: ws,
    })
    return res.status(200).json({ hook: hook ?? null })
  } catch (e) {
    console.error('[content-items/slide-hook]', e?.message || e)
    return err(res, 'Hook generation failed', 500)
  }
}
