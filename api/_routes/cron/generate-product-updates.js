// GET/POST /api/cron/generate-product-updates
//
// Nightly: writes plain-language, role-tagged product_updates entries from
// merged PRs on Move-Better/Bernard (P3 of ProducerHome — see
// .claude/decisions.md 2026-07-29 and api/_lib/producer/productUpdatesGenerator.js
// for the actual logic). Replaces the hand-maintained public/release-notes.json
// for role-targeted announcements — that file + the deploy-reload
// UpdateAvailableModal mechanism are unrelated and unaffected.
//
// Auth: Bearer CRON_SECRET. `?dryRun=1` computes and returns the candidate
// entries without inserting — safe to hit manually to check the output.
export const config = { runtime: 'nodejs', maxDuration: 120 }

import { withSentry } from '../../_lib/sentry.js'
import { verifyCronSecret } from '../../_lib/auth.js'
import { generateProductUpdates } from '../../_lib/producer/productUpdatesGenerator.js'

async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'unauthorized' })

  const dryRun = req.query?.dryRun === '1'

  try {
    const result = await generateProductUpdates({ dryRun })
    return res.status(200).json({ ok: true, dryRun, ...result })
  } catch (e) {
    console.error('[cron/generate-product-updates] failed:', e?.message)
    return res.status(500).json({ error: 'generation_failed' })
  }
}

export default withSentry(handler)
