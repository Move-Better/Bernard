// GET /api/producer/learning
//
// The owner-facing "How Bernard is learning" panel (Phase 4, mockup-approved).
// Reports, per dimension, how often a human changed Bernard's choice — and,
// just as importantly, how often they didn't.
//
// Every rate here is a real count over real rows. Where a signal doesn't exist
// or the sample is too small, the endpoint says so rather than emitting a
// flattering number: see dimensionTrust(), which distinguishes untracked /
// no_data / too_few from a reportable rate. A confidently wrong number in this
// panel is worse than an admitted gap, because nobody re-checks a figure that
// looks settled.
//
// Response 200:
//   { dimensions: { words|format|media: { state, rate, overrides, observations, say, flags } },
//     window: { days }, generatedAt }

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { dimensionTrust, trustSentence, stillFlags } from '../../_lib/learningSignals.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Trailing window. Long enough that a low-volume clinic reaches MIN_SAMPLE at
// all (movebetter approves ~28 posts/30d), short enough that a preference the
// owner changed months ago stops counting against Bernard.
const WINDOW_DAYS = 90

// Exact count without pulling rows — same Range/Content-Range trick
// checkpoints.js uses, and cheap at this project's scale.
async function exactCount(path) {
  const sep = path.includes('?') ? '&' : '?'
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}${sep}select=id`, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  })
  if (!r.ok) return null
  const cr = r.headers.get('content-range') || ''
  const total = cr.split('/')[1]
  return total === '*' || total == null ? null : Number(total)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'read', ws.id))) return

  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString()
  const scope = `content_items?workspace_id=eq.${ws.id}&created_at=gte.${since}`

  try {
    const [
      // WORDS — edit_diff is written when an approver's text differs from the
      // draft. The denominator is everything that reached approval, because a
      // post approved WITHOUT an edit is Bernard being right about the words.
      wordsObserved, wordsOverridden,
      // FORMAT — format_source, stamped 'bernard' by the planner/draft paths
      // and re-stamped 'human' when a producer changes the picker.
      formatObserved, formatOverridden,
      // MEDIA — media_source, stamped 'bernard' by auto-attach and 'human' by
      // a swap that replaces existing media (migration 196).
      mediaObserved, mediaOverridden,
    ] = await Promise.all([
      exactCount(`${scope}&status=in.(approved,scheduled,published)`),
      exactCount(`${scope}&status=in.(approved,scheduled,published)&edit_diff=not.is.null`),
      exactCount(`${scope}&format_source=not.is.null`),
      exactCount(`${scope}&format_source=eq.human`),
      exactCount(`${scope}&media_source=not.is.null`),
      exactCount(`${scope}&media_source=eq.human`),
    ])

    // A failed count is NOT zero. Zero would read as "nothing to report,
    // everything's fine"; null routes to no_data, which says so honestly.
    const build = (dimension, observed, overridden) => {
      const t = dimensionTrust({
        observations: observed ?? 0,
        overrides: overridden ?? 0,
        // graduatedWindows is not yet tracked — no dimension can graduate on
        // this endpoint alone, which is the safe direction: everything keeps
        // being flagged until the window history exists.
        graduatedWindows: 0,
      })
      return { ...t, say: trustSentence(dimension, t), flags: stillFlags(t) }
    }

    return res.status(200).json({
      dimensions: {
        words:  build('words',  wordsObserved,  wordsOverridden),
        format: build('format', formatObserved, formatOverridden),
        media:  build('media',  mediaObserved,  mediaOverridden),
      },
      window: { days: WINDOW_DAYS },
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[producer/learning] failed:', e?.stack || e?.message)
    return res.status(500).json({ error: 'learning_read_failed' })
  }
}
