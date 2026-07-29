// GET/POST /api/cron/generate-coaching-note
//
// Weekly (Monday mornings): writes one cached "Bernard's note for this week"
// per workspace (P4 of ProducerHome — see .claude/decisions.md 2026-07-29
// and api/_lib/producer/coachingNoteGenerator.js for the actual logic).
//
// Auth: Bearer CRON_SECRET. `?dryRun=1` computes and returns the drafted
// notes without writing them. `?slug=<slug>` restricts to one workspace —
// useful to rehearse the copy for a single tenant before a full run.
export const config = { runtime: 'nodejs', maxDuration: 120 }

import { withSentry } from '../../_lib/sentry.js'
import { verifyCronSecret } from '../../_lib/auth.js'
import { generateCoachingNotes } from '../../_lib/producer/coachingNoteGenerator.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'unauthorized' })

  const dryRun = req.query?.dryRun === '1'
  const rawSlug = req.query?.slug || null
  const onlySlug = rawSlug && SLUG_RE.test(rawSlug) ? rawSlug : null

  try {
    const result = await generateCoachingNotes({ dryRun, onlySlug })
    return res.status(200).json({ ok: true, dryRun, ...result })
  } catch (e) {
    console.error('[cron/generate-coaching-note] failed:', e?.message)
    return res.status(500).json({ error: 'generation_failed' })
  }
}

export default withSentry(handler)
