export const config = { runtime: 'nodejs', maxDuration: 300 }

// Consolidated API — a single Vercel Function (Express app) serving the ~127
// light JSON routes. Heavy / streaming / raw-body / cron handlers stay as their
// own files in api/ (they win Vercel's filesystem phase before the /api/(.*)
// rewrite in vercel.json). See .claude/plan-function-consolidation.md.
//
// Routes come from a generated manifest (scripts/build-api-manifest.mjs, run in
// prebuild). Each handler keeps its original (req, res) shape and its own method
// gating; we mount with app.all and a thin shim so handlers need no changes.

import express from 'express'
import { routes } from './_routes/_manifest.generated.js'

const app = express()
app.disable('x-powered-by')

// Vercel does NOT pre-parse req.body under an Express-app export (1a spike), and
// every migrated route is JSON in/out (stream/raw-body handlers stay separate).
app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ extended: true, limit: '20mb' }))

// Adapt an existing Vercel (req, res) handler to an Express route:
//   - merge Express :params into req.query so handlers reading req.query.id work
//     (defineProperty: Express 5 makes req.query a getter; plain assignment is a
//     no-op/throws in ESM strict mode);
//   - restore the full original path on req.url so handlers that parse
//     url.pathname.split('/').pop() resolve the id;
//   - forward async rejections to the Express error handler.
function wrap(handler) {
  return (req, res, next) => {
    try {
      req.url = req.originalUrl
      const merged = { ...(req.query || {}), ...(req.params || {}) }
      Object.defineProperty(req, 'query', {
        value: merged,
        writable: true,
        configurable: true,
        enumerable: true,
      })
      return Promise.resolve(handler(req, res)).catch(next)
    } catch (err) {
      return next(err)
    }
  }
}

for (const { path, handler } of routes) {
  app.all(path, wrap(handler))
}

// Unmatched /api path that fell through the rewrite — should be rare.
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.originalUrl })
})

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[api/index] handler error:', err?.stack || err)
  if (res.headersSent) return
  res.status(500).json({ error: 'internal_error' })
})

export default app
