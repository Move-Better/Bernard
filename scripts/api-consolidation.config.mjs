// Single source of truth for the Vercel function consolidation.
// (.claude/plan-function-consolidation.md)
//
// Files NOT listed here are migrated into api/_routes/ and served by the single
// Express app at api/index.js (via the /api/(.*) rewrite in vercel.json).
//
// Files listed here stay as their own Vercel function because they need a
// resource profile the shared app can't provide, or a request shape the shared
// express.json() body parser would break:
//   - ffmpeg binary (includeFiles) + high memory
//   - streaming responses
//   - raw request body (webhook signature verification)
//   - large uploads streamed to disk
//   - heavy long-running AI (Phase-2 fold candidates)
//   - crons (own invocation model; static paths win in the filesystem phase)
//
// All KEEP paths are relative to api/ and use posix separators.

// Whole directories kept (every *.js inside stays a separate function).
export const KEEP_DIRS = [
  'cron', // 11 scheduled jobs; static paths, win in filesystem phase
  'media/[id]', // nested-dynamic (consent/edit/purge/thumbnail); excluded via the rewrite lookahead
]

// Individual files kept.
export const KEEP_FILES = [
  // ffmpeg / heavy render (includeFiles in vercel.json)
  'media/upload.js',
  'media/tag.js',
  'media/backfill-thumbnails.js',
  'editorial/render-longform.js',
  'editorial/render-longform-worker.js',
  'editorial/render-clip.js',
  'editorial/render-segments.js',
  'editorial/repurpose-video.js',
  'editorial/rerender-package.js',
  // streaming responses
  'stream.js',
  'realtime-session.js',
  'tts.js',
  'voice-preview.js',
  'voice-memo.js',
  // raw body (signature verification)
  'billing/webhook.js',
  'webhooks/mux.js',
  // large upload / stream-to-disk
  'capture/upload.js',
  'voice-clone/create.js',
  'integrations/drive/import.js',
  'publish/website.js',
  'interviews/detect-video-offset.js',
  'handout/create.js',
  // heavy long-running AI (Phase-2 fold candidates)
  'generate.js',
  'editorial/find-clips.js',
  'editorial/generate-package.js',
  'book/regenerate.js',
  'onboarding/synthesize.js',
  'content-items/split-into-series.js',
  'interviews/cleanup-transcript.js',
  'seminar/transcribe-worker.js',
]

// The Express app itself — never migrated, never registered as a route.
export const APP_ENTRY = 'index.js'

/** Is this api-relative path kept as its own Vercel function? */
export function isKept(relPath) {
  const p = relPath.replace(/\\/g, '/')
  if (p === APP_ENTRY) return true
  if (KEEP_FILES.includes(p)) return true
  if (KEEP_DIRS.some((d) => p === d || p.startsWith(d + '/'))) return true
  return false
}

/**
 * Map an api/_routes-relative file path to its Express route path.
 *   db/foo.js              -> /api/db/foo
 *   carousel-themes/index.js -> /api/carousel-themes
 *   content-pieces/[id].js -> /api/content-pieces/:id
 *   brand-kit/roles/[role].js -> /api/brand-kit/roles/:role
 */
export function routePathFor(relPath) {
  let rel = relPath.replace(/\\/g, '/').replace(/\.js$/, '')
  if (rel.endsWith('/index')) rel = rel.slice(0, -'/index'.length)
  if (rel === 'index') rel = ''
  const segs = rel
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/^\[\.\.\.(.+)\]$/, '*$1').replace(/^\[(.+)\]$/, ':$1'))
  return '/api' + (segs.length ? '/' + segs.join('/') : '')
}
