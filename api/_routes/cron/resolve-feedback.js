// POST /api/cron/resolve-feedback
//
// System trigger to mark a feedback row fixed + email the reporter, callable
// from a headless/background session with no browser and no Clerk sign-in.
// Runs in Vercel where RESEND_API_KEY already lives, so the send needs no
// local secret handling. Shares all logic with the Clerk endpoint
// (PATCH /api/feedback/resolve) via _lib/resolveFeedback.js.
//
// Not on a Vercel cron schedule (it isn't in vercel.json crons) — it lives
// under api/_routes/cron/ only to reuse the Bearer CRON_SECRET auth convention.
// Resolves by the (unguessable) feedback id across any workspace, the same way
// backup-db and the other system crons legitimately operate cross-workspace.
//
// Auth: Bearer CRON_SECRET.
// Body (JSON):
//   id     string  required — feedback row id (uuid)
//   note   string  required — what was fixed, in plain language, shown verbatim
//                             to the reporter in the email and the Home banner.

import { verifyCronSecret }   from '../../_lib/auth.js'
import { resolveFeedbackRow } from '../../_lib/resolveFeedback.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'unauthorized' })

  const { id, note } = req.body ?? {}
  if (!UUID_RE.test(id || '')) return res.status(400).json({ error: 'invalid_id' })

  const r = await resolveFeedbackRow({ id, note })
  if (r.status === 'note_required') return res.status(400).json({ error: 'note_required' })
  if (r.status === 'not_found') return res.status(404).json({ error: 'not_found' })
  if (r.status === 'lookup_failed' || r.status === 'update_failed') return res.status(500).json({ error: r.status })

  return res.status(200).json({ ok: true, id: r.id, notified: !!r.notified, alreadyResolved: !!r.alreadyResolved })
}

export const config = { runtime: 'nodejs' }
