export const config = { runtime: 'nodejs', maxDuration: 300 }

// Consolidated API (Phase 1b) — single Express function serving the light
// JSON routes. Heavy/streaming/raw-body/cron functions stay as their own
// files (they win in Vercel's filesystem phase, before this rewrite).
// See .claude/plan-function-consolidation.md.
//
// SPIKE NOTE (Phase 1a): the _echo routes below are temporary probes to
// validate (Q2) req.body parsing via express.json, (Q3) req.url preservation
// through the /api/(.*) rewrite, and precedence vs real functions. Removed
// once validated; replaced by the generated route manifest.

import express from 'express'

const app = express()

// Vercel does NOT pre-parse req.body when the default export is an Express app
// (proven in the 1a spike) — so we parse here. Light routes are all JSON.
app.use(express.json({ limit: '15mb' }))
app.use(express.urlencoded({ extended: true, limit: '15mb' }))

const echo = (req, res) =>
  res.status(200).json({
    ok: true,
    via: 'catch-all',
    method: req.method,
    url: req.url,
    originalUrl: req.originalUrl,
    query: req.query,
    params: req.params,
    bodyType: typeof req.body,
    body: req.body ?? null,
  })

app.all('/api/_echo', echo)
app.all('/api/_echo/:a/:b', echo)

app.use((req, res) =>
  res
    .status(404)
    .json({ error: 'not_found', via: 'catch-all', originalUrl: req.originalUrl, url: req.url }),
)

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[api/index] error:', err?.stack || err)
  res.status(500).json({ error: String(err?.message || err), via: 'catch-all' })
})

export default app
